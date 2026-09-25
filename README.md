# Tinycast Speedtest Live

Run Ookla speed tests in Tinycast with live download and upload gauges, progress, speed history, ping, and network details.

![Speedtest Live in Tinycast after a completed test](https://raw.githubusercontent.com/wu-liang/tinycast-speedtest-live/main/docs/images/speedtest-live.png)

*Screenshot uses example ISP and IP addresses.*

## Install

Requires macOS, Tinycast, and the Ookla Speedtest CLI. The CLI is not included in the download.

1. Download `tinycast-speedtest-live.zip` from [Releases](https://github.com/wu-liang/tinycast-speedtest-live/releases).
2. Extract its `tinycast-speedtest-live` folder into `~/Library/Application Support/com.tinycast.app/extensions/`.
3. Set **Ookla CLI Path** in the extension preferences to the absolute path of your Speedtest CLI. If Tinycast's original Speedtest extension has already downloaded it, you can use the CLI at `~/Library/Application Support/com.tinycast.app/extension-support/speedtest/cli/speedtest` (replace `~` with your home directory).
4. Restart Tinycast and open **Speedtest Live**. A test starts immediately; use **Actions** (Cmd+K) to cancel or restart it.

To update, replace the extension folder, then close and reopen the command.

## Build from source

```sh
npm ci
npm test
npm run build
npm run install-local
```

If the original Speedtest extension has already downloaded the CLI, run `npm run install-speedtest-cli` to copy it into this extension's support directory. Otherwise, set **Ookla CLI Path** in the preferences.

The CLI performs the speed test and supplies the ISP and IP addresses shown on screen. The extension adds no analytics or separate IP lookup service.
