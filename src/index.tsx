import { Action, ActionPanel, environment, getPreferenceValues, Grid, Icon, showToast, Toast } from "@raycast/api";
import { existsSync } from "fs";
import { useCallback, useEffect, useRef, useState } from "react";
import { gaugeDataUri, statusText } from "./gauge";
import { runSpeedtest, SpeedtestRun } from "./speedtest-runner";
import { LiveState } from "./types";

interface Preferences { cliPath?: string }
declare const __SPEEDTEST_FIXTURE_CLI__: string | undefined;

const initialState: LiveState = { phase: "starting", result: { ping: {}, download: {}, upload: {} } };

function resolveCliPath(preferences: Preferences): string {
  if (typeof __SPEEDTEST_FIXTURE_CLI__ !== "undefined") return __SPEEDTEST_FIXTURE_CLI__!;
  const configured = preferences.cliPath?.trim();
  return configured || `${environment.supportPath}/cli/speedtest`;
}

export default function Command() {
  const [state, setState] = useState<LiveState>(initialState);
  const [runNumber, setRunNumber] = useState(0);
  const runRef = useRef<SpeedtestRun | undefined>(undefined);

  const start = useCallback(() => {
    runRef.current?.cancel();
    setState(initialState);
    const cliPath = resolveCliPath(getPreferenceValues<Preferences>());
    if (!existsSync(cliPath)) {
      setState({
        ...initialState,
        phase: "error",
        message: "Ookla CLI is missing. Set the Ookla CLI Path preference or run npm run install-speedtest-cli locally.",
      });
      return;
    }
    try {
      runRef.current = runSpeedtest({
        cliPath,
        supportPath: environment.supportPath,
        onState: (next) => setState(next),
      });
    } catch (error) {
      setState({ ...initialState, phase: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }, []);

  useEffect(() => {
    start();
    return () => runRef.current?.cancel();
  }, [runNumber, start]);

  useEffect(() => {
    if (state.phase === "error") {
      void showToast({ style: Toast.Style.Failure, title: "Speedtest failed", message: state.message });
    }
  }, [state.phase, state.message]);

  const restart = () => setRunNumber((value) => value + 1);
  const cancel = () => {
    runRef.current?.cancel();
    setState((current) => ({ ...current, phase: "cancelled", message: "Cancelled" }));
  };
  const running = !["done", "error", "cancelled"].includes(state.phase);
  const actions = (
    <ActionPanel>
      <Action title="Restart Speedtest" icon={Icon.RotateClockwise} onAction={restart} />
      {running && <Action title="Cancel Speedtest" icon={Icon.XMarkCircle} onAction={cancel} />}
      {state.result.result?.url && <Action.OpenInBrowser title="Open Result in Browser" url={state.result.result.url} />}
    </ActionPanel>
  );

  // Keys and ids are intentionally constants: only the content data URI changes during polling.
  return (
    <Grid columns={2} aspectRatio="4/3" inset={Grid.Inset.Zero} searchBarPlaceholder={state.phase === "error" ? state.message : "Live Ookla Speedtest"}>
      <Grid.Item
        key="download"
        id="download"
        title="Download"
        subtitle={statusText("download", state)}
        content={{ source: gaugeDataUri("download", state, environment.appearance) }}
        actions={actions}
      />
      <Grid.Item
        key="upload"
        id="upload"
        title="Upload"
        subtitle={statusText("upload", state)}
        content={{ source: gaugeDataUri("upload", state, environment.appearance) }}
        actions={actions}
      />
    </Grid>
  );
}
