import { cpSync, existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");
const target = resolve(homedir(), "Library/Application Support/com.tinycast.app/extensions/tinycast-speedtest-live");
if (!existsSync(resolve(dist, "index.js"))) throw new Error("Build first: npm run build");
cpSync(dist, target, { recursive: true, force: true });
console.log(`Installed only this extension to ${target}`);
console.log("Then open: tinycast://extensions/wu-liang/tinycast-speedtest-live/index");
