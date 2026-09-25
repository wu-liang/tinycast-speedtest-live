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

function harness(fetchResponse: RunnerDependencies["fetch"] = async () => ({ ok: false } as Response)) {
  const files = new Map<string, string>();
  const children: FakeChild[] = [];
  const calls: { command: string; args: string[] }[] = [];
  const intervals: (() => void)[] = [];
  const timeouts: (() => void)[] = [];
  const microtasks: (() => void)[] = [];
  const removed: string[] = [];
  const lookupCalls: { url: string; signal: AbortSignal | undefined }[] = [];
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
    fetch: (url, init) => {
      lookupCalls.push({ url: String(url), signal: init?.signal ?? undefined });
      return fetchResponse(url, init);
    },
  };
  return {
    run: createSpeedtestRunner(dependencies), files, children, calls, intervals, timeouts, removed, lookupCalls,
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
  assert.deepEqual(states.at(-1)?.history.download.samples, [8]);
  assert.deepEqual(states.at(-1)?.history.upload.samples, [16]);
});

test("retains sampled history and peak when the final result arrives", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"download","download":{"bandwidth":1000000}}',
    '{"type":"download","download":{"bandwidth":4000000}}',
    '{"type":"result","download":{"bandwidth":2000000},"upload":{"bandwidth":3000000}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  h.children[0].exit(0);
  assert.equal(states.at(-1)?.phase, "done");
  assert.deepEqual(states.at(-1)?.history.download, { samples: [8, 32], count: 2, peak: 32 });
  assert.deepEqual(states.at(-1)?.history.upload, { samples: [], count: 0, peak: 0 });
});

test("a sparse progress event does not duplicate the previously cached sample", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"download","download":{"bandwidth":1000000}}',
    '{"type":"download","download":{"progress":0.5}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  assert.deepEqual(states.at(-1)?.history.download, { samples: [8], count: 1, peak: 8 });
});

test("keeps zero, rejects invalid bandwidth, and caps retained samples without losing count or peak", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  const records = Array.from({ length: 603 }, (_, index) => JSON.stringify({
    type: "download", download: { bandwidth: index === 1 ? -1 : index === 2 ? "bad" : index * 1_000_000 },
  }));
  h.files.set(run.outputPath, `${records.join("\n")}\n`);
  h.intervals[0]();
  const history = states.at(-1)?.history.download;
  assert.equal(history?.count, 601);
  assert.equal(history?.samples.length, 600);
  assert.equal(history?.samples[0], 24);
  assert.equal(history?.peak, 4_816);
  assert.equal(history?.samples.at(-1), 4_816);
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

test("preserves test-start network metadata when the final payload omits it", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"testStart","isp":"Start ISP","interface":{"internalIp":"10.0.0.8","externalIp":"198.51.100.8"}}',
    '{"type":"result","download":{"bandwidth":1000000},"upload":{"bandwidth":2000000}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  h.children[0].exit(0);
  assert.equal(states.at(-1)?.result.isp, "Start ISP");
  assert.deepEqual(states.at(-1)?.result.interface, { internalIp: "10.0.0.8", externalIp: "198.51.100.8" });
});

test("retains valid server name and city from test start across a sparse final result", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"testStart","server":{"name":"Test Server","location":"Amsterdam"}}',
    '{"type":"result","server":{"name":42,"location":null}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  h.children[0].exit(0);
  assert.deepEqual(states.at(-1)?.result.server, { name: "Test Server", location: "Amsterdam" });
});

test("accepts final network metadata and merges only valid partial interface fields", () => {
  const h = harness();
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"testStart","isp":"Start ISP","interface":{"internalIp":"10.0.0.8"}}',
    '{"type":"result","isp":42,"interface":"malformed"}',
    '{"type":"result","isp":42,"interface":{"internalIp":false,"externalIp":"2001:db8::8"}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  assert.equal(states.at(-1)?.result.isp, "Start ISP");
  assert.deepEqual(states.at(-1)?.result.interface, { internalIp: "10.0.0.8", externalIp: "2001:db8::8" });

  const finalOnly = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(finalOnly.outputPath, '{"type":"result","isp":"Final ISP","interface":{"internalIp":"192.0.2.9","externalIp":"2001:db8::9"}}\n');
  h.intervals[1]();
  assert.equal(states.at(-1)?.result.isp, "Final ISP");
  assert.deepEqual(states.at(-1)?.result.interface, { internalIp: "192.0.2.9", externalIp: "2001:db8::9" });
});

test("looks up client city once per external IP without delaying the CLI result", async () => {
  let resolveLookup!: (response: Response) => void;
  const h = harness(() => new Promise<Response>((resolve) => { resolveLookup = resolve; }));
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, [
    '{"type":"testStart","isp":"Client ISP","interface":{"externalIp":"198.51.100.8"},"server":{"name":"Test Server","location":"Amsterdam"}}',
    '{"type":"result","isp":"Client ISP","interface":{"externalIp":"198.51.100.8"},"server":{"name":"Test Server","location":"Amsterdam"}}',
    "",
  ].join("\n"));
  h.intervals[0]();
  h.children[0].exit(0);
  assert.equal(states.at(-1)?.phase, "done");
  assert.equal(states.at(-1)?.clientLocation, undefined);
  assert.equal(h.lookupCalls.length, 1);
  assert.equal(h.lookupCalls[0].url, "https://ipwho.is/198.51.100.8?fields=success,city,country_code");
  resolveLookup({ ok: true, json: async () => ({ success: true, city: "Utrecht", country_code: "NL" }) } as Response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.deepEqual(states.at(-1)?.clientLocation, { city: "Utrecht", countryCode: "NL" });
  assert.equal(states.at(-1)?.phase, "done");
});

test("skips a malformed external IP when looking up client city", () => {
  const h = harness();
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: () => undefined });
  h.flushMicrotasks();
  h.files.set(run.outputPath, '{"type":"testStart","interface":{"externalIp":"not-an-ip"}}\n');
  h.intervals[0]();
  assert.equal(h.lookupCalls.length, 0);
});

test("failed city lookup leaves the speed test usable", async () => {
  const h = harness(async () => ({ ok: true, json: async () => ({ success: false }) } as Response));
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, '{"type":"testStart","interface":{"externalIp":"203.0.113.4"}}\n');
  h.intervals[0]();
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1)?.clientLocation, undefined);
  assert.equal(states.at(-1)?.phase, "starting");
  assert.equal(h.lookupCalls.length, 1);
  h.files.set(run.outputPath, `${h.files.get(run.outputPath)}{"type":"result"}\n`);
  h.intervals[0]();
  h.children[0].exit(0);
  assert.equal(states.at(-1)?.phase, "done");
});

test("city lookup timeout ignores a late response", async () => {
  let resolveLookup!: (response: Response) => void;
  const h = harness(() => new Promise<Response>((resolve) => { resolveLookup = resolve; }));
  const states: LiveState[] = [];
  const run = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => states.push(state) });
  h.flushMicrotasks();
  h.files.set(run.outputPath, '{"type":"testStart","interface":{"externalIp":"203.0.113.4"}}\n');
  h.intervals[0]();
  h.timeouts[1]();
  assert.equal(h.lookupCalls[0].signal?.aborted, true);
  resolveLookup({ ok: true, json: async () => ({ success: true, city: "Too late", country_code: "NL" }) } as Response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(states.at(-1)?.clientLocation, undefined);
  h.files.set(run.outputPath, `${h.files.get(run.outputPath)}{"type":"result"}\n`);
  h.intervals[0]();
  h.children[0].exit(0);
  assert.equal(states.at(-1)?.phase, "done");
});

test("cancelling a completed run suppresses its late city response", async () => {
  let resolveLookup!: (response: Response) => void;
  const h = harness(() => new Promise<Response>((resolve) => { resolveLookup = resolve; }));
  const first: LiveState[] = [];
  const second: LiveState[] = [];
  const oldRun = h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => first.push(state) });
  h.flushMicrotasks();
  h.files.set(oldRun.outputPath, '{"type":"result","interface":{"externalIp":"198.51.100.8"}}\n');
  h.intervals[0]();
  h.children[0].exit(0);
  oldRun.cancel();
  assert.equal(h.lookupCalls[0].signal?.aborted, true);
  const firstCount = first.length;
  h.run({ cliPath: "/cli", supportPath: "/support", onState: (state) => second.push(state) });
  resolveLookup({ ok: true, json: async () => ({ success: true, city: "Stale", country_code: "NL" }) } as Response);
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(first.length, firstCount);
  assert.equal(second.at(-1)?.clientLocation, undefined);
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
