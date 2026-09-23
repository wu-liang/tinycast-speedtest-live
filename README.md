# Tinycast Speedtest Live

A standalone, local Raycast-format extension for unmodified Tinycast 0.11.3. A persistent Grid item displays a composite dashboard: two circular speed gauges, download/upload history charts, and Ping/Download/Upload summary cards. Tinycast retains the image while its SVG data URI updates. It polls CLI progress every 200 ms and coalesces each batch into one UI update. The 270-degree arcs follow Mbps on a graduated scale; test completion percentage is displayed separately.

History includes every valid progress measurement, even when several arrive between UI updates. Charts show the latest sample, all-run peak, and total sample count. The most recent 600 samples per direction are retained for drawing; counts and peaks cover the entire run. Final summary values come from the CLI result and may differ from the last progress sample. Restarting clears the histories.

During download or upload, a thin inner arc shows that stage's completion fraction, with a percentage beside the gauge label. The outer arc continues to show Mbps independently. The inner arc disappears when the stage ends, keeping the existing dashboard layout unchanged.

## Build and install

```sh
npm install
npm run typecheck
npm test
npm run build
npm run install-local
```

The local installer writes only to `~/Library/Application Support/com.tinycast.app/extensions/tinycast-speedtest-live`; it does not replace the installed `speedtest` extension. Restart Tinycast after the first installation, then search for **Speedtest Live**, or open `tinycast://extensions/wu-liang/tinycast-speedtest-live/index`. The command starts a test immediately. Use the Actions menu (Cmd+K) to cancel or restart. No custom Tinycast build or additional macOS accessibility grant is needed.

The extension does not redistribute Ookla's proprietary CLI. If the extension has no CLI, either set **Ookla CLI Path** in its preferences or, when the stock Speedtest extension is already installed locally, run:

```sh
npm run install-speedtest-cli
```

That command copies the local existing binary into Tinycast support data, outside `dist/`.

## Fixture visual check

```sh
npm run build
npm run fixture-build
```

Copy `fixture-dist/` to Tinycast's extensions folder as `tinycast-speedtest-live-fixture`, restart Tinycast, and open `tinycast://extensions/wu-liang/tinycast-speedtest-live-fixture/index`. This separate test extension runs for about 22 seconds without network traffic and never changes production preferences. Its wrapper uses the absolute Node executable and source path from the build machine, so rebuild it if moving the checkout. Remove the fixture extension after testing.

For CLI-level failure or cancellation sampling, use `SPEEDTEST_FIXTURE_MODE=failure` or `SPEEDTEST_FIXTURE_MODE=cancel` when executing `tests/fixtures/fake-speedtest.mjs`. These controls are limited to test fixtures.

## Checks

`npm test` verifies partial JSONL buffering, the final result, nonzero stderr reporting, cancellation cleanup, run isolation, shell-safe paths with spaces, per-poll batching, terminal malformed/read errors, immediate cancellation, speed-scale semantics, history retention and caps, and empty/zero SVG rendering. `npm run build` produces `dist/package.json` (the Tinycast extension manifest), a duplicate `dist/manifest.json` for inspection, `dist/index.js`, and the extension asset.

The CLI binary is local support data, never part of the source or distributable bundle. This plugin is independent of Tinycast's application bundle; compatibility with future releases should still be checked.
