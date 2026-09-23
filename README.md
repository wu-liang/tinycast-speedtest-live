# Tinycast Speedtest Live

A standalone, local Raycast-format extension for unmodified Tinycast 0.11.3. It presents two permanent Grid cards—download and upload—with changing SVG data URIs, so Tinycast can retain each native grid cell while the live gauges update. It polls CLI progress every 200 ms and coalesces each batch into one UI update. The 270-degree arcs follow Mbps on a graduated scale; test completion percentage is displayed separately.

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

`npm test` verifies partial JSONL buffering, the final result, nonzero stderr reporting, cancellation cleanup, run isolation, shell-safe paths with spaces, per-poll batching, terminal malformed/read errors, immediate cancellation, and speed-scale semantics. `npm run build` produces `dist/package.json` (the Tinycast extension manifest), a duplicate `dist/manifest.json` for inspection, `dist/index.js`, and the extension asset.

The CLI binary is local support data, never part of the source or distributable bundle. This plugin is independent of Tinycast's application bundle; compatibility with future releases should still be checked.
