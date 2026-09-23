export type Phase = "starting" | "ping" | "download" | "upload" | "done" | "error" | "cancelled";

export interface SpeedMeasurement {
  bandwidth?: number;
  progress?: number;
  elapsed?: number;
  bytes?: number;
}

export interface SpeedtestResult {
  ping?: { latency?: number; jitter?: number; progress?: number };
  download?: SpeedMeasurement;
  upload?: SpeedMeasurement;
  result?: { url?: string; id?: string };
  server?: { name?: string; location?: string };
  isp?: string;
}

export interface LiveState {
  phase: Phase;
  result: SpeedtestResult;
  message?: string;
}
