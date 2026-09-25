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
  assert.match(svg, /<circle cx="337\.00" cy="[^\"]+" r="3\.5" fill="#2196ff"\/>/);
  assert.match(svg, /<circle cx="383\.00" cy="[^\"]+" r="3\.5" fill="#8047ff"\/>/);
  assert.doesNotMatch(svg, /samples<\/text>/);
  assert.match(svg, /Ping/);
  assert.match(svg, /Download/);
  assert.match(svg, /Upload/);
  assert.match(svg, /<text x="180" y="117"[^>]*>45\.38<\/text>/);
  assert.doesNotMatch(svg, /NaN|Infinity/);
});

test("outer summary cards show client and server names and cities while Ping stays centered", () => {
  const state: LiveState = {
    phase: "done",
    result: { isp: "Client ISP", server: { name: "Test Server", location: "Amsterdam" }, ping: { latency: 7.6 } },
    clientLocation: { city: "Utrecht", countryCode: "NL" },
    history: emptyHistory,
  };
  const svg = decodeURIComponent(dashboardDataUri(state, "dark"));
  assert.match(svg, /clip-path="url\(#summary-0\)"[^>]*><text[^>]*>Client ISP<\/text><text[^>]*>Utrecht, NL<\/text>/);
  assert.match(svg, /clip-path="url\(#summary-1\)"[^>]*><text[^>]*>Ping<\/text><text[^>]*>7\.6 ms<\/text>/);
  assert.match(svg, /clip-path="url\(#summary-2\)"[^>]*><text[^>]*>Test Server<\/text><text[^>]*>Amsterdam<\/text>/);
});

test("outer summary cards escape and bound network names and use dashes for missing cities", () => {
  const state: LiveState = {
    phase: "starting",
    result: { isp: '<Client & "ISP">', server: { name: "Very Long Server Name That Cannot Fit Inside The Summary Card", location: "<City>" } },
    history: emptyHistory,
  };
  const svg = decodeURIComponent(dashboardDataUri(state, "light"));
  assert.match(svg, /&lt;Client &amp; &quot;ISP&quot;&gt;/);
  assert.match(svg, /clip-path="url\(#summary-0\)"[^>]*><text[^>]*>[^<]*<\/text><text[^>]*>—<\/text>/);
  assert.match(svg, /Very Long Server Name[^<]*…<\/text>/);
  assert.doesNotMatch(svg, /Very Long Server Name That Cannot Fit Inside The Summary Card/);
  assert.match(svg, /&lt;City&gt;/);
  assert.doesNotMatch(svg, /<City>/);
});

test("empty and zero histories remain renderable and distinguish zero from unmeasured", () => {
  const state: LiveState = {
    phase: "download",
    result: { download: { bandwidth: 0 }, upload: {} },
    history: { download: { samples: [0], count: 1, peak: 0 }, upload: { samples: [], count: 0, peak: 0 } },
  };
  const svg = decodeURIComponent(dashboardDataUri(state, "light"));
  assert.match(svg, />0\.00<\/text>/);
  assert.match(svg, /<circle cx="39\.00" cy="264\.00" r="3\.5" fill="#2196ff"\/>/);
  assert.doesNotMatch(svg, /<circle cx="383\.00"[^>]+fill="#8047ff"\/>/);
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
  assert.doesNotMatch(svg, />ISP<\/text>/);
  assert.match(svg, />A &amp; &lt;B&gt; &quot;C&quot; &apos;D&apos;<\/text>/);
  assert.match(svg, />Internal IP<\/text>/);
  assert.match(svg, /<text x="24" y="352"[^>]*>Internal IP<\/text>/);
  assert.match(svg, />2001:db8:[^<]*…<\/text>/);
  assert.doesNotMatch(svg, /2001:db8:85a3:0000:0000:8a2e:0370:7334/);
  assert.match(svg, />External IP<\/text>/);
  assert.match(svg, />198\.51\.100\.23<\/text>/);
  assert.doesNotMatch(svg, /<B>/);
});

test("network footer uses dashes before metadata arrives", () => {
  const svg = decodeURIComponent(dashboardDataUri({ phase: "starting", result: {}, history: emptyHistory }, "light"));
  assert.doesNotMatch(svg, />ISP<\/text>/);
  assert.match(svg, />Internal IP<\/text>/);
  assert.match(svg, />External IP<\/text>/);
  assert.equal((svg.match(/fill="#17171b">—<\/text>/g) ?? []).length, 2);
});
