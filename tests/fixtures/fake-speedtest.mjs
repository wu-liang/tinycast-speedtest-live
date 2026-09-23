#!/usr/bin/env node

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const write = (event, split = false) => {
  const line = `${JSON.stringify(event)}\n`;
  if (split) {
    process.stdout.write(line.slice(0, Math.floor(line.length / 2)));
    setTimeout(() => process.stdout.write(line.slice(Math.floor(line.length / 2))), 12);
  } else {
    process.stdout.write(line);
  }
};

const mode = process.env.SPEEDTEST_FIXTURE_MODE ?? "success";
if (mode === "failure") {
  process.stderr.write("fixture deliberately failed\n");
  process.exitCode = 7;
} else if (mode === "cancel") {
  await wait(10_000);
} else if (mode === "visual") {
  write({ type: "testStart", isp: "Fixture ISP", server: { name: "Fixture Server", location: "Amsterdam" } });
  await wait(1000);
  write({ type: "ping", ping: { latency: 8.4, jitter: 1.2, progress: 1 } });
  await wait(1000);
  for (const kind of ["download", "upload"]) {
    for (let index = 1; index <= 50; index++) {
      const mbps = (kind === "download" ? 144 : 40) * (0.7 + 0.3 * Math.sin(index / 5));
      write({ type: kind, [kind]: { bandwidth: mbps * 1_000_000 / 8, progress: index / 50 } }, index % 5 === 0);
      await wait(200);
    }
  }
  write({ type: "result", ping: { latency: 8.4, jitter: 1.2 }, download: { bandwidth: 18_000_000 }, upload: { bandwidth: 5_000_000 } });
} else {
  write({ type: "testStart", isp: "Fixture ISP", server: { name: "Fixture Server", location: "Amsterdam" } });
  await wait(18);
  write({ type: "ping", ping: { latency: 8.4, jitter: 1.2, progress: 1 } });
  await wait(18);
  write({ type: "download", download: { bandwidth: 12_500_000, progress: 0.48 } }, true);
  await wait(35);
  write({ type: "download", download: { bandwidth: 18_000_000, progress: 1 } });
  await wait(18);
  write({ type: "upload", upload: { bandwidth: 4_500_000, progress: 0.66 } });
  await wait(18);
  write({ type: "result", ping: { latency: 8.4, jitter: 1.2 }, download: { bandwidth: 18_000_000 }, upload: { bandwidth: 5_000_000 }, result: { url: "https://example.test/result" } }, true);
}
