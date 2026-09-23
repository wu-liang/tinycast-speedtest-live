import assert from "node:assert/strict";
import test from "node:test";
import { gaugeDataUri, speedFraction, statusText } from "../src/gauge";
import { LiveState } from "../src/types";

test("speed scale follows Mbps independently of test completion", () => {
  assert.equal(speedFraction(0), 0);
  assert.equal(speedFraction(1000), 1);
  assert.equal(speedFraction(2000), 1);
  assert.ok(speedFraction(20) < speedFraction(100));
  const state: LiveState = { phase: "download", result: { download: { bandwidth: 12_500_000, progress: 0.1 } } };
  const first = decodeURIComponent(gaugeDataUri("download", state, "dark"));
  const later = decodeURIComponent(gaugeDataUri("download", { ...state, result: { download: { ...state.result.download, progress: 0.9 } } }, "dark"));
  assert.deepEqual(first.match(/<path[^>]+/g), later.match(/<path[^>]+/g));
  assert.match(first, />100<\/text>/);
  assert.match(later, /90%/);
});

test("completed download and cancelled measurements have accurate labels", () => {
  assert.equal(statusText("download", { phase: "upload", result: {} }), "Complete");
  assert.equal(statusText("upload", { phase: "cancelled", result: {} }), "Cancelled");
});
