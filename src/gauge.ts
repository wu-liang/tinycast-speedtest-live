import { LiveState, SpeedMeasurement } from "./types";

const colors = {
  download: "#38bdf8",
  upload: "#a855f7",
  track: "#1e293b",
  text: "#f8fafc",
  muted: "#94a3b8",
};

function palette(appearance: "light" | "dark") {
  return appearance === "dark"
    ? colors
    : { ...colors, track: "#cbd5e1", text: "#0f172a", muted: "#475569" };
}

export function megabitsPerSecond(measurement?: SpeedMeasurement): number {
  // Ookla reports bytes/s; eight bits form a byte and 1,000,000 bits form a Mbps.
  return Math.max(0, (measurement?.bandwidth ?? 0) * 8 / 1_000_000);
}

export function formatMbps(measurement?: SpeedMeasurement): string {
  const value = megabitsPerSecond(measurement);
  if (value === 0) return "—";
  return value >= 100 ? value.toFixed(0) : value.toFixed(1);
}

export function statusText(kind: "download" | "upload", state: LiveState): string {
  if (state.phase === "error") return "Failed — see error message";
  if (state.phase === "cancelled") return "Cancelled";
  if (state.phase === "done") return "Complete";
  if (state.phase === kind) return `Measuring live · ${Math.round((state.result[kind]?.progress ?? 0) * 100)}%`;
  if (kind === "download" && state.phase === "upload") return "Complete";
  if (kind === "upload" && state.phase === "download") return "Waiting for download";
  if (state.phase === "ping") return "Measuring latency…";
  return "Connecting…";
}

const speedTicks = [0, 1, 5, 10, 50, 100, 500, 1000];

export function speedFraction(mbps: number): number {
  const speed = Math.max(0, Math.min(1000, mbps));
  for (let index = 1; index < speedTicks.length; index++) {
    if (speed <= speedTicks[index]) {
      return (index - 1 + (speed - speedTicks[index - 1]) / (speedTicks[index] - speedTicks[index - 1])) / (speedTicks.length - 1);
    }
  }
  return 1;
}

function point(fraction: number, radius: number): string {
  const angle = (135 + fraction * 270) * Math.PI / 180;
  return `${(160 + Math.cos(angle) * radius).toFixed(2)} ${(139 + Math.sin(angle) * radius).toFixed(2)}`;
}

function arc(fraction: number): string {
  return `M ${point(0, 78)} A 78 78 0 ${fraction > 2 / 3 ? 1 : 0} 1 ${point(fraction, 78)}`;
}

function encodeSvg(svg: string): string {
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

/** A self-contained image allows Grid.Item content to change without replacing the Grid item. */
export function gaugeDataUri(kind: "download" | "upload", state: LiveState, appearance: "light" | "dark"): string {
  const theme = palette(appearance);
  const measurement = state.result[kind];
  const value = formatMbps(measurement);
  const fraction = speedFraction(megabitsPerSecond(measurement));
  const color = theme[kind];
  const label = kind[0].toUpperCase() + kind.slice(1);
  const status = statusText(kind, state).replace(/[<&>]/g, "");
  const ticks = speedTicks.map((tick, index) => {
    const fraction = index / (speedTicks.length - 1);
    const [x1, y1] = point(fraction, 90).split(" ");
    const [x2, y2] = point(fraction, 95).split(" ");
    const [x, y] = point(fraction, 109).split(" ");
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${theme.muted}" stroke-width="1.5"/><text x="${x}" y="${Number(y) + 3}" text-anchor="middle" fill="${theme.muted}" font-size="10">${tick}</text>`;
  }).join("");
  const phaseText = state.phase === kind ? "LIVE" : state.phase === "done" ? "DONE" : "";

  const [markerX, markerY] = point(fraction, 78).split(" ");
  return encodeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="320" height="240" viewBox="0 0 320 240" font-family="-apple-system, BlinkMacSystemFont, sans-serif">
    <text x="18" y="24" fill="${theme.text}" font-size="16" font-weight="700">${label}</text>
    <text x="302" y="24" text-anchor="end" fill="${color}" font-size="10" font-weight="700">${phaseText}</text>
    ${ticks}
    <path d="${arc(1)}" fill="none" stroke="${theme.track}" stroke-width="11" stroke-linecap="round"/>
    ${fraction > 0 ? `<path d="${arc(fraction)}" fill="none" stroke="${color}" stroke-width="11" stroke-linecap="round"/>` : ""}
    <circle cx="${markerX}" cy="${markerY}" r="5.5" fill="${color}"/>
    <text x="160" y="144" text-anchor="middle" fill="${theme.text}" font-size="38" font-weight="700">${value}</text>
    <text x="160" y="167" text-anchor="middle" fill="${theme.muted}" font-size="13">Mbps</text>
    <text x="160" y="225" text-anchor="middle" fill="${theme.muted}" font-size="12">${status}</text>
  </svg>`);
}
