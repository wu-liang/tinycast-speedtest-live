import assert from "node:assert/strict";
import test from "node:test";
import { dashboardDataUri, speedFraction, statusText } from "../src/gauge";
import { LiveState } from "../src/types";

const emptyHistory = { download: { samples: [], count: 0, peak: 0 }, upload: { samples: [], count: 0, peak: 0 } };

test("speed scale follows Mbps independently of test completion", () => {
  assert.equal(speedFraction(0), 0);
  assert.equal(speedFraction(1000), 1);
  assert.equal(speedFraction(2000), 1);
  assert.ok(speedFraction(20) < speedFraction(100));
  const state: LiveState = { phase: "download", result: { download: { bandwidth: 12_500_000, progress: 0.1 } }, history: emptyHistory };
  const first = decodeURIComponent(dashboardDataUri(state, "dark"));
  const later = decodeURIComponent(dashboardDataUri({ ...state, result: { download: { ...state.result.download, progress: 0.9 } } }, "dark"));
  const speedPaths = (svg: string) => svg.match(/<path[^>]+/g)?.filter((path) => !path.includes("data-progress"));
  assert.deepEqual(speedPaths(first), speedPaths(later));
  assert.notEqual(first.match(/<path data-progress[^>]+/)?.[0], later.match(/<path data-progress[^>]+/)?.[0]);
  assert.match(later, />Download<\/text>/);
  assert.doesNotMatch(later, /90% · Download/);
  assert.doesNotMatch(later, /data-progress="upload"/);
  const done = decodeURIComponent(dashboardDataUri({ ...state, phase: "done" }, "dark"));
  assert.doesNotMatch(done, /data-progress=/);
  assert.match(first, />100<\/text>/);
  assert.match(later, />90%<\/text>/);
});

test("completed download and cancelled measurements have accurate labels", () => {
  assert.equal(statusText("download", { phase: "upload", result: {}, history: emptyHistory }), "Complete");
  assert.equal(statusText("upload", { phase: "cancelled", result: {}, history: emptyHistory }), "Cancelled");
});

test("dashboard contains both history charts and all summaries without invalid SVG values", () => {
  const state: LiveState = {
    phase: "done",
    result: { ping: { latency: 7.6 }, download: { bandwidth: 5_672_500 }, upload: { bandwidth: 7_173_750 } },
    history: {
      download: { samples: [0, 45.38], count: 2, peak: 64.01 },
      upload: { samples: [57.39], count: 1, peak: 57.39 },
    },
  };
  const svg = decodeURIComponent(dashboardDataUri(state, "dark"));
  assert.match(svg, /Download over time/);
  assert.match(svg, /Upload over time/);
  assert.match(svg, /<text x="337" y="211" text-anchor="end"[^>]*>peak 64\.01 Mbps<\/text>/);
  assert.match(svg, /<text x="681" y="211" text-anchor="end"[^>]*>peak 57\.39 Mbps<\/text>/);
  assert.match(svg, /Ping/);
  assert.match(svg, /Download/);
  assert.match(svg, /Upload/);
  assert.match(svg, /45\.38 Mbps/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("empty and zero histories remain renderable and distinguish zero from unmeasured", () => {
  const state: LiveState = {
    phase: "download",
    result: { download: { bandwidth: 0 }, upload: {} },
    history: { download: { samples: [0], count: 1, peak: 0 }, upload: { samples: [], count: 0, peak: 0 } },
  };
  const svg = decodeURIComponent(dashboardDataUri(state, "light"));
  assert.match(svg, />0\.00<\/text>/);
  assert.match(svg, /1 samples/);
  assert.match(svg, /0 samples/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("network footer renders metadata safely and bounds long address text", () => {
  const state: LiveState = {
    phase: "done",
    result: {
      isp: 'A & <B> "C" \'D\'',
      interface: { internalIp: "2001:db8:85a3:0000:0000:8a2e:0370:7334", externalIp: "198.51.100.23" },
    },
    history: emptyHistory,
  };
  const svg = decodeURIComponent(dashboardDataUri(state, "dark"));
  assert.match(svg, />ISP<\/text>/);
  assert.match(svg, />A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;<\/text>/);
  assert.match(svg, />Internal IP<\/text>/);
  assert.match(svg, />2001:db8:[^<]*…<\/text>/);
  assert.doesNotMatch(svg, /2001:db8:85a3:0000:0000:8a2e:0370:7334/);
  assert.match(svg, />External IP<\/text>/);
  assert.match(svg, />198\.51\.100\.23<\/text>/);
  assert.doesNotMatch(svg, /<B>/);
});

test("network footer uses dashes before metadata arrives", () => {
  const svg = decodeURIComponent(dashboardDataUri({ phase: "starting", result: {}, history: emptyHistory }, "light"));
  assert.match(svg, />ISP<\/text>/);
  assert.match(svg, />Internal IP<\/text>/);
  assert.match(svg, />External IP<\/text>/);
  assert.equal((svg.match(/fill="#17171b">—<\/text>/g) ?? []).length, 3);
});
