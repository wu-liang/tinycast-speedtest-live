import { build } from "esbuild";
import { cpSync, mkdirSync, rmSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const fixture = resolve(root, "fixture-dist");
rmSync(fixture, { recursive: true, force: true });
mkdirSync(fixture, { recursive: true });
cpSync(resolve(root, "dist"), fixture, { recursive: true });
const quote = (value) => "'" + value.replaceAll("'", "'\\''") + "'";
const cli = resolve(fixture, "speedtest-fixture");
writeFileSync(cli, `#!/bin/sh\nSPEEDTEST_FIXTURE_MODE=visual exec ${quote(process.execPath)} ${quote(resolve(root, "tests/fixtures/fake-speedtest.mjs"))}\n`);
chmodSync(cli, 0o755);
const manifest = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));
manifest.name = "tinycast-speedtest-live-fixture";
manifest.title = "Speedtest Live Fixture";
manifest.commands[0].title = "Speedtest Live Fixture";
for (const name of ["package.json", "manifest.json"]) writeFileSync(resolve(fixture, name), JSON.stringify(manifest, null, 2));
await build({
  entryPoints: [resolve(root, "src/index.tsx")], outfile: resolve(fixture, "index.js"),
  bundle: true, format: "cjs", platform: "node", target: "es2022",
  define: { __SPEEDTEST_FIXTURE_CLI__: JSON.stringify(cli) },
  external: ["@raycast/api", "react", "react/jsx-runtime", "fs", "path", "child_process"],
});
console.log("Built isolated Speedtest Live Fixture with a 22-second local CLI; no production preferences change.");
