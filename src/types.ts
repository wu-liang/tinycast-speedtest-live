export type Phase = "starting" | "ping" | "download" | "upload" | "done" | "error" | "cancelled";

export interface SpeedMeasurement {
  bandwidth?: number;
  progress?: number;
  elapsed?: number;
  bytes?: number;
}

export interface NetworkInterface {
  internalIp?: string;
  externalIp?: string;
}

export interface SpeedtestResult {
  ping?: { latency?: number; jitter?: number; progress?: number };
  download?: SpeedMeasurement;
  upload?: SpeedMeasurement;
  result?: { url?: string; id?: string };
  server?: { name?: string; location?: string };
  isp?: string;
  interface?: NetworkInterface;
}

export interface SpeedHistory {
  /** Recent valid Mbps readings, retained for rendering only. */
  samples: number[];
  /** All valid readings received in this run, including samples dropped from `samples`. */
  count: number;
  /** The all-run peak in Mbps, so the label remains accurate after the cap is reached. */
  peak: number;
}

export interface LiveState {
  phase: Phase;
  result: SpeedtestResult;
  clientLocation?: { city?: string; countryCode?: string };
  history: Record<"download" | "upload", SpeedHistory>;
  message?: string;
}
