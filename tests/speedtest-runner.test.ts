import assert from "node:assert/strict";
import test from "node:test";
import { ChildLike, createSpeedtestRunner, RunnerDependencies } from "../src/speedtest-runner";
import { LiveState } from "../src/types";

class FakeChild implements ChildLike {
  exitCode: number | null = null;
  killed = false;
  private exitListener?: (code: number | null) => void;
  private errorListener?: (error: Error) => void;

  on(event: "exit" | "error", listener: ((code: number | null) => void) | ((error: Error) => void)): this {
    if (event === "exit") this.exitListener = listener as (code: number | null) => void;
    else this.errorListener = listener as (error: Error) => void;
    return this;
  }

  kill(): boolean { this.killed = true; return true; }
  exit(code: number): void { this.exitCode = code; this.exitListener?.(code); }
  error(message: string): void { this.errorListener?.(new Error(message)); }
}

function harness() {
  const files = new Map<string, string>();
  const children: FakeChild[] = [];
  const calls: { command: string; args: string[] }[] = [];
  const intervals: (() => void)[] = [];
  const timeouts: (() => void)[] = [];
  const microtasks: (() => void)[] = [];
  const removed: string[] = [];
  let random = 0;

  const dependencies: Partial<RunnerDependencies> = {
    fs: {
      mkdirSync: () => undefined,
      writeFileSync: (file: unknown, value: unknown) => { files.set(String(file), String(value)); },
      readFileSync: (file: unknown) => {
        const value = files.get(String(file));
        if (value === undefined) throw new Error(`ENOENT ${String(file)}`);
        return value;
      },
      rmSync: (file: unknown) => { removed.push(String(file)); files.delete(String(file)); },
      existsSync: (file: unknown) => files.has(String(file)),
    } as unknown as RunnerDependencies["fs"],
    path: { join: (...parts: string[]) => parts.join("/") },
    spawn: (command, args) => {
      calls.push({ command, args });
      const child = new FakeChild();
      children.push(child);
      return child;
    },
    setInterval: ((handler: () => void) => { intervals.push(handler); return intervals.length; }) as unknown as typeof setInterval,
    clearInterval: (() => undefined) as unknown as typeof clearInterval,
    setTimeout: ((handler: () => void) => { timeouts.push(handler); return timeouts.length; }) as unknown as typeof setTimeout,
    clearTimeout: (() => undefined) as unknown as typeof clearTimeout,
    queueMicrotask: (handler) => { microtasks.push(handler); },
    now: () => 1234,
    random: () => ++random / 10,
  };
  return {
    run: createSpeedtestRunner(dependencies), files, children, calls, intervals, timeouts, removed,
    flushMicrotasks: () => { while (microtasks.length) microtasks.shift()?.(); },
  };
}

test("consumes split JSONL records and preserves the final result", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, '{"type":"download","download":{"bandwidth":12500000,"progress":0.5}}');
  h.intervals[0]();
  assert.equal(states.at(-1)?.phase, "starting", "partial line must not be parsed early");
  h.files.set(run.outputPath, `${h.files.get(run.outputPath)}\n{"type":"result","download":{"bandwidth":18000000},"upload":{"bandwidth":5000000},"ping":{"latency":8},"result":{"url":"https://example.test"}}`);
  h.intervals[0]();
  h.children[0].exit(0);
  assert.equal(states.at(-1)?.phase, "done");
  assert.equal(states.at(-1)?.result.download?.bandwidth, 18_000_000);
  assert.equal(states.at(-1)?.result.result?.url, "https://example.test");
});

test("reports a nonzero CLI exit with stderr", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.errorPath, "fixture deliberately failed\n");
  h.children[0].exit(7);
  assert.equal(states.at(-1)?.phase, "error");
  assert.match(states.at(-1)?.message ?? "", /fixture deliberately failed/);
});

test("cancellation kills the child and removes only its files", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  const stateCount = states.length;
  run.cancel();
  assert.equal(h.children[0].killed, true);
  assert.equal(h.files.has(run.outputPath), false);
  assert.equal(h.files.has(run.errorPath), false);
  assert.deepEqual(h.removed.sort(), [run.errorPath, run.outputPath].sort());
  h.children[0].exit(0);
  assert.equal(states.length, stateCount, "a cancelled run cannot publish after exit");
});

test("events from a cancelled run cannot mix into its replacement", () => {
  const h = harness();
  const first: LiveState[] = [];
  const second: LiveState[] = [];
  const runOne = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => first.push(state) });
  h.flushMicrotasks();
  runOne.cancel();
  const runTwo = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => second.push(state) });
  h.flushMicrotasks();
  h.files.set(runTwo.outputPath, '{"type":"upload","upload":{"bandwidth":3000000,"progress":1}}\n');
  h.intervals[1]();
  h.children[0].exit(0);
  assert.equal(first.at(-1)?.phase, "starting");
  assert.equal(second.at(-1)?.phase, "upload");
});

test("uses positional shell arguments for paths containing spaces", () => {
  const h = harness();
  h.run({ cliPath: "/cli path/with spaces/speedtest", supportPath: "/support path/live", onState: () => undefined });
  h.flushMicrotasks();
  const call = h.calls[0];
  assert.equal(call.command, "/bin/sh");
  assert.equal(call.args[2], "speedtest-live");
  assert.equal(call.args[3], "/cli path/with spaces/speedtest");
  assert.match(call.args[1], /\$1/);
  assert.doesNotMatch(call.args[1], /cli path/);
});

test("publishes one merged state for all complete JSONL records in a poll", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"download","download":{"bandwidth":1000000,"progress":0.5}}',
    '{"type":"upload","upload":{"bandwidth":2000000,"progress":0.5}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  assert.equal(states.length, 2, "starting plus one merged poll state");
  assert.equal(states.at(-1)?.phase, "upload");
  assert.equal(states.at(-1)?.result.download?.bandwidth, 1_000_000);
  assert.equal(states.at(-1)?.result.upload?.bandwidth, 2_000_000);
});

test("malformed data is terminal and stops the child", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, "not json\n");
  h.intervals[0]();
  assert.equal(states.at(-1)?.phase, "error");
  assert.equal(h.children[0].killed, true);
  assert.equal(h.files.has(run.outputPath), false);
});

test("a progress-file read error is terminal and stops the child", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.delete(run.outputPath);
  h.intervals[0]();
  assert.equal(states.at(-1)?.phase, "error");
  assert.match(states.at(-1)?.message ?? "", /Unable to read Speedtest progress/);
  assert.equal(h.children[0].killed, true);
});

test("a sparse final result retains empty measurement objects", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, '{"type":"result","result":{"url":"https://example.test"}}\n');
  h.intervals[0]();
  assert.deepEqual(states.at(-1)?.result.download, {});
  assert.deepEqual(states.at(-1)?.result.upload, {});
  assert.deepEqual(states.at(-1)?.result.ping, {});
});

test("an immediate cancellation skips the queued spawn entirely", () => {
  const h = harness();
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: () => undefined });
  run.cancel();
  h.flushMicrotasks();
  assert.equal(h.children.length, 0);
  assert.equal(h.files.has(run.outputPath), false);
  assert.equal(h.files.has(run.errorPath), false);
});
