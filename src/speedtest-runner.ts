import { spawn as nodeSpawn } from "child_process";
import * as fs from "fs";
import * as path from "path";
import { LiveState, SpeedtestResult } from "./types";

export interface ChildLike {
  exitCode: number | null;
  killed?: boolean;
  kill(signal?: string): boolean;
  on(event: "exit", listener: (code: number | null) => void): ChildLike;
  on(event: "error", listener: (error: Error) => void): ChildLike;
}

export interface RunnerDependencies {
  fs: Pick<typeof fs, "mkdirSync" | "writeFileSync" | "readFileSync" | "rmSync" | "existsSync">;
  path: Pick<typeof path, "join">;
  spawn: (command: string, args: string[]) => ChildLike;
  setInterval: typeof setInterval;
  clearInterval: typeof clearInterval;
  setTimeout: typeof setTimeout;
  clearTimeout: typeof clearTimeout;
  queueMicrotask: typeof queueMicrotask;
  now: () => number;
  random: () => number;
}

export interface RunOptions {
  cliPath: string;
  supportPath: string;
  pollIntervalMs?: number;
  timeoutMs?: number;
  onState: (state: LiveState) => void;
}

export interface SpeedtestRun {
  cancel(): void;
  readonly outputPath: string;
  readonly errorPath: string;
}

const defaultDependencies: RunnerDependencies = {
  fs,
  path,
  spawn: (command, args) => nodeSpawn(command, args) as unknown as ChildLike,
  setInterval,
  clearInterval,
  setTimeout,
  clearTimeout,
  queueMicrotask,
  now: Date.now,
  random: Math.random,
};

const emptyResult = (): SpeedtestResult => ({ download: {}, upload: {}, ping: {} });

function phaseFor(event: Record<string, unknown>): LiveState["phase"] | undefined {
  if (event.type === "ping") return "ping";
  if (event.type === "download") return "download";
  if (event.type === "upload") return "upload";
  if (event.type === "result") return "done";
  return undefined;
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : undefined;
}

function messageForExit(stderr: string, code: number | null): string {
  const firstUsefulLine = stderr
    .split(/\r?\n/)
    .map((line) => line.replace(/^\[[^\]]+\]\s*\[error\]\s*/, "").trim())
    .find(Boolean);
  return firstUsefulLine
    ? `Speedtest failed: ${firstUsefulLine}`
    : `Speedtest exited with code ${code ?? "unknown"}.`;
}

/**
 * Runs the CLI through /bin/sh only to perform redirection. Every variable path is passed as a
 * positional argument, so a configured path containing spaces or shell punctuation is not parsed.
 */
export function createSpeedtestRunner(overrides: Partial<RunnerDependencies> = {}) {
  const deps: RunnerDependencies = { ...defaultDependencies, ...overrides };

  return function runSpeedtest(options: RunOptions): SpeedtestRun {
    const progressDirectory = deps.path.join(options.supportPath, "progress");
    deps.fs.mkdirSync(progressDirectory, { recursive: true });
    const runId = `${deps.now()}-${Math.floor(deps.random() * 1_000_000_000)}`;
    const outputPath = deps.path.join(progressDirectory, `${runId}.jsonl`);
    const errorPath = deps.path.join(progressDirectory, `${runId}.err`);
    deps.fs.writeFileSync(outputPath, "");
    deps.fs.writeFileSync(errorPath, "");

    let result = emptyResult();
    let phase: LiveState["phase"] = "starting";
    let offset = 0;
    let partialLine = "";
    let cancelled = false;
    let completed = false;
    let publishedResult = false;
    let batchPhase: LiveState["phase"] = "starting";
    let batchChanged = false;
    let child: ChildLike | undefined;
    let interval: ReturnType<typeof setInterval> | undefined;
    let timeout: ReturnType<typeof setTimeout> | undefined;

    const publish = (nextPhase = phase, message?: string) => {
      if (cancelled || completed) return;
      phase = nextPhase;
      options.onState({ phase, result: { ...result }, message });
    };

    const queueState = (nextPhase: LiveState["phase"]) => {
      batchPhase = nextPhase;
      batchChanged = true;
    };

    const publishBatch = () => {
      if (!batchChanged) return;
      batchChanged = false;
      publish(batchPhase);
    };

    const cleanup = () => {
      if (interval !== undefined) deps.clearInterval(interval);
      if (timeout !== undefined) deps.clearTimeout(timeout);
      try { deps.fs.rmSync(outputPath, { force: true }); } catch { /* cleanup is best effort */ }
      try { deps.fs.rmSync(errorPath, { force: true }); } catch { /* cleanup is best effort */ }
    };

    const endWithError = (message: string, stopChild = true) => {
      if (cancelled || completed) return;
      completed = true;
      if (stopChild && child?.exitCode === null && !child.killed) child.kill("SIGTERM");
      cleanup();
      options.onState({ phase: "error", result: { ...result }, message });
    };

    const consume = (line: string): boolean => {
      if (!line.trim()) return true;
      let event: Record<string, unknown> | undefined;
      try {
        event = asObject(JSON.parse(line));
      } catch {
        // Fall through to the same terminal error used for non-object JSON values.
      }
      if (!event) {
        endWithError("Speedtest produced malformed progress data.");
        return false;
      }

      if (event.type === "testStart") {
        result = {
          ...result,
          isp: typeof event.isp === "string" ? event.isp : result.isp,
          server: asObject(event.server) as SpeedtestResult["server"],
        };
        queueState("starting");
        return true;
      }
      const nextPhase = phaseFor(event);
      if (!nextPhase) return true;
      if (event.type === "ping") result = { ...result, ping: (asObject(event.ping) as SpeedtestResult["ping"]) ?? result.ping ?? {} };
      if (event.type === "download") result = { ...result, download: (asObject(event.download) as SpeedtestResult["download"]) ?? result.download ?? {} };
      if (event.type === "upload") result = { ...result, upload: (asObject(event.upload) as SpeedtestResult["upload"]) ?? result.upload ?? {} };
      if (event.type === "result") {
        result = {
          ping: (asObject(event.ping) as SpeedtestResult["ping"]) ?? result.ping ?? {},
          download: (asObject(event.download) as SpeedtestResult["download"]) ?? result.download ?? {},
          upload: (asObject(event.upload) as SpeedtestResult["upload"]) ?? result.upload ?? {},
          result: asObject(event.result) as SpeedtestResult["result"],
          server: asObject(event.server) as SpeedtestResult["server"],
          isp: typeof event.isp === "string" ? event.isp : result.isp,
        };
        publishedResult = true;
      }
      queueState(nextPhase);
      return true;
    };

    const poll = (publishAfter = true) => {
      if (cancelled || completed) return;
      let contents: string;
      try {
        contents = deps.fs.readFileSync(outputPath, "utf8") as string;
      } catch (error) {
        endWithError(`Unable to read Speedtest progress: ${error instanceof Error ? error.message : String(error)}`);
        return;
      }
      if (contents.length < offset) {
        offset = 0;
        partialLine = "";
      }
      partialLine += contents.slice(offset);
      offset = contents.length;
      const lines = partialLine.split(/\r?\n/);
      partialLine = lines.pop() ?? "";
      for (const line of lines) if (!consume(line)) return;
      if (publishAfter) publishBatch();
    };

    const finish = (code: number | null) => {
      if (cancelled || completed) return;
      poll(false);
      if (completed) return;
      if (partialLine.trim()) consume(partialLine);
      partialLine = "";
      if (completed) return;
      publishBatch();
      let stderr = "";
      if (code !== 0) {
        try { stderr = deps.fs.readFileSync(errorPath, "utf8") as string; } catch { /* report exit code */ }
      }
      completed = true;
      cleanup();
      if (code !== 0) {
        options.onState({ phase: "error", result: { ...result }, message: messageForExit(stderr, code) });
      } else if (!publishedResult) {
        options.onState({ phase: "error", result: { ...result }, message: "Speedtest finished without a result." });
      }
    };

    interval = deps.setInterval(poll, options.pollIntervalMs ?? 200);
    timeout = deps.setTimeout(() => {
      if (cancelled || completed) return;
      endWithError("Speedtest timed out.");
    }, options.timeoutMs ?? 120_000);

    // Tinycast starts BufferedChildProcess in a microtask. Deferring our spawn means an immediate
    // React unmount cancels before any child exists, rather than trying to signal pid 0.
    deps.queueMicrotask(() => {
      if (cancelled || completed) return;
      try {
        child = deps.spawn("/bin/sh", [
        "-c",
        'exec "$1" --format=json --progress --accept-license --accept-gdpr > "$2" 2> "$3"',
        "speedtest-live",
        options.cliPath,
        outputPath,
        errorPath,
        ]);
        child.on("error", (error) => endWithError(`Could not start Speedtest: ${error.message}`, false));
        child.on("exit", finish);
      } catch (error) {
        endWithError(`Could not start Speedtest: ${error instanceof Error ? error.message : String(error)}`);
      }
    });
    publish("starting");

    return {
      outputPath,
      errorPath,
      cancel() {
        if (cancelled || completed) return;
        cancelled = true;
        if (child?.exitCode === null && !child.killed) child.kill("SIGTERM");
        cleanup();
      },
    };
  };
}

export const runSpeedtest = createSpeedtestRunner();
