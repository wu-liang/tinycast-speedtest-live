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
  assert.deepEqual(first.match(/<path[^>]+/g), later.match(/<path[^>]+/g));
  assert.match(first, />100<\/text>/);
  assert.match(later, /90%/);
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
