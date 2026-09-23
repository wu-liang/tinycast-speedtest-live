import { copyFileSync, existsSync, mkdirSync, chmodSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

const appSupport = resolve(homedir(), "Library/Application Support/com.tinycast.app");
const source = resolve(appSupport, "extension-support/speedtest/cli/speedtest");
const destination = resolve(appSupport, "extension-support/tinycast-speedtest-live/cli/speedtest");
if (!existsSync(source)) {
  throw new Error(`Original local Ookla CLI was not found at ${source}. Set the extension's Ookla CLI Path preference instead.`);
}
mkdirSync(resolve(destination, ".."), { recursive: true });
copyFileSync(source, destination);
chmodSync(destination, 0o755);
console.log(`Copied the existing local CLI to ${destination}`);
console.log("The CLI is local support data and is deliberately not included in dist/.");
