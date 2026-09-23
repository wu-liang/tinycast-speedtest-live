import { LiveState, SpeedMeasurement } from "./types";

const colors = {
  download: "#2196ff", upload: "#8047ff", ping: "#ffc83d",
  darkBackground: "#18191d", darkPanel: "#232325", darkText: "#f7f7fa", darkMuted: "#9c9ba2",
  lightBackground: "#f5f5f7", lightPanel: "#ffffff", lightText: "#17171b", lightMuted: "#666671",
  track: "#3b3b3e",
};

function palette(appearance: "light" | "dark") {
  return appearance === "dark"
    ? { background: colors.darkBackground, panel: colors.darkPanel, text: colors.darkText, muted: colors.darkMuted, track: colors.track }
    : { background: colors.lightBackground, panel: colors.lightPanel, text: colors.lightText, muted: colors.lightMuted, track: "#d1d1d5" };
}

export function megabitsPerSecond(measurement?: SpeedMeasurement): number | undefined {
  const bandwidth = measurement?.bandwidth;
  const mbps = typeof bandwidth === "number" && Number.isFinite(bandwidth) && bandwidth >= 0 ? bandwidth * 8 / 1_000_000 : undefined;
  return mbps !== undefined && Number.isFinite(mbps) ? mbps : undefined;
}

export function formatMbps(measurement?: SpeedMeasurement): string {
  const value = megabitsPerSecond(measurement);
  return value === undefined ? "—" : value.toFixed(2);
}

function formatValue(value: number | undefined, suffix = " Mbps"): string {
  return value === undefined || !Number.isFinite(value) ? "—" : `${value.toFixed(2)}${suffix}`;
}

export function statusText(kind: "download" | "upload", state: LiveState): string {
  if (state.phase === "error") return "Failed";
  if (state.phase === "cancelled") return "Cancelled";
  if (state.phase === "done") return "Complete";
  if (state.phase === kind) return `Measuring live · ${Math.round((state.result[kind]?.progress ?? 0) * 100)}%`;
  if (kind === "download" && state.phase === "upload") return "Complete";
  if (kind === "upload" && state.phase === "download") return "Waiting for download";
  if (state.phase === "ping") return "Measuring latency…";
  return "Connecting…";
}

const speedTicks = [0, 1, 5, 10, 50, 100, 500, 1000];

export function speedFraction(mbps: number | undefined): number {
  const speed = Math.max(0, Math.min(1000, Number.isFinite(mbps) ? mbps! : 0));
  for (let index = 1; index < speedTicks.length; index++) {
    if (speed <= speedTicks[index]) return (index - 1 + (speed - speedTicks[index - 1]) / (speedTicks[index] - speedTicks[index - 1])) / (speedTicks.length - 1);
  }
  return 1;
}

function point(fraction: number, radius: number, cx: number, cy: number): string {
  const angle = (135 + fraction * 270) * Math.PI / 180;
  return `${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`;
}
function arc(fraction: number, cx: number, cy: number, radius = 72): string {
  return `M ${point(0, radius, cx, cy)} A ${radius} ${radius} 0 ${fraction > 2 / 3 ? 1 : 0} 1 ${point(fraction, radius, cx, cy)}`;
}
function encodeSvg(svg: string): string { return `data:image/svg+xml,${encodeURIComponent(svg)}`; }
function progressFraction(measurement?: SpeedMeasurement): number {
  const progress = measurement?.progress;
  return typeof progress === "number" && Number.isFinite(progress)
    ? Math.max(0, Math.min(1, progress)) : 0;
}

function gauge(kind: "download" | "upload", state: LiveState, theme: ReturnType<typeof palette>, cx: number): string {
  const value = megabitsPerSecond(state.result[kind]);
  const fraction = speedFraction(value);
  const color = colors[kind];
  const active = state.phase === kind;
  const progress = progressFraction(state.result[kind]);
  const ticks = speedTicks.map((tick, index) => {
    const tickFraction = index / (speedTicks.length - 1);
    const [x1, y1] = point(tickFraction, 82, cx, 112).split(" ");
    const [x2, y2] = point(tickFraction, 87, cx, 112).split(" ");
    const [x, y] = point(tickFraction, 98, cx, 112).split(" ");
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${theme.muted}" stroke-width="1"/><text x="${x}" y="${Number(y) + 3}" text-anchor="middle" fill="${theme.muted}" font-size="8">${tick}</text>`;
  }).join("");
  const [markerX, markerY] = point(fraction, 72, cx, 112).split(" ");
  const label = kind[0].toUpperCase() + kind.slice(1);
  return `${ticks}<path d="${arc(1, cx, 112)}" fill="none" stroke="${theme.track}" stroke-width="10" stroke-linecap="round"/>
    ${value !== undefined ? `<path d="${arc(fraction, cx, 112)}" fill="none" stroke="${color}" stroke-width="10" stroke-linecap="round"/>` : ""}
    ${active && progress > 0 ? `<path data-progress="${kind}" d="${arc(progress, cx, 112, 61)}" fill="none" stroke="${color}" stroke-opacity=".55" stroke-width="1.8" stroke-linecap="round"/>` : ""}
    <circle cx="${markerX}" cy="${markerY}" r="5" fill="#fff" stroke="${color}" stroke-width="2"/>
    <text x="${cx}" y="117" text-anchor="middle" fill="${theme.text}" font-size="28" font-weight="700">${formatMbps(state.result[kind])}</text>
    <text x="${cx}" y="136" text-anchor="middle" fill="${theme.muted}" font-size="10">Mbps</text>
    <text x="${cx}" y="177" text-anchor="middle" fill="${color}" font-size="11" font-weight="600">${active ? `${Math.round(progress * 100)}% · ${label}` : label}</text>`;
}

function chart(kind: "download" | "upload", state: LiveState, theme: ReturnType<typeof palette>, x: number): string {
  const history = state.history[kind];
  const samples = history.samples.filter((value) => Number.isFinite(value) && value >= 0);
  const width = 204, baseline = 276, top = 241;
  const retainedPeak = Number.isFinite(history.peak) && history.peak >= 0 ? history.peak : 0;
  const max = Math.max(1, retainedPeak, ...samples);
  const points = samples.map((value, index) => {
    const px = x + (samples.length === 1 ? 0 : index / (samples.length - 1) * width);
    const py = baseline - value / max * (baseline - top);
    return `${px.toFixed(2)},${py.toFixed(2)}`;
  });
  const line = points.length > 1 ? `M ${points.join(" L ")}` : "";
  const fill = line ? `${line} L ${(x + width).toFixed(2)},${baseline} L ${x},${baseline} Z` : "";
  const latest = samples.at(-1);
  const endX = samples.length ? x + (samples.length === 1 ? 0 : width) : x;
  const endY = latest === undefined ? baseline : baseline - latest / max * (baseline - top);
  const label = kind[0].toUpperCase() + kind.slice(1), color = colors[kind];
  return `<g><rect x="${x - 15}" y="194" width="328" height="96" rx="12" fill="${theme.panel}"/>
    <text x="${x}" y="212" fill="${theme.muted}" font-size="10">${label} over time</text>
    <text x="${x}" y="226" fill="${theme.muted}" font-size="9">peak ${formatValue(history.count ? history.peak : undefined)}</text>
    ${fill ? `<path d="${fill}" fill="${color}" fill-opacity=".20"/>` : ""}${line ? `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}${samples.length ? `<circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="3.5" fill="${color}"/>` : ""}
    <text x="${x + 216}" y="251" fill="${theme.text}" font-size="11" font-weight="700">${formatValue(latest)}</text>
    <text x="${x + 216}" y="279" fill="${theme.muted}" font-size="9">${history.count} samples</text></g>`;
}

function latency(state: LiveState): number | undefined {
  const value = state.result.ping?.latency;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function summaryCard(x: number, color: string, title: string, value: string, theme: ReturnType<typeof palette>): string {
  return `<rect x="${x}" y="303" width="202" height="39" rx="11" fill="${color}" fill-opacity=".19"/><circle cx="${x + 17}" cy="323" r="4.5" fill="${color}"/><text x="${x + 31}" y="321" fill="${theme.text}" font-size="10" font-weight="600">${title}</text><text x="${x + 31}" y="334" fill="${theme.text}" font-size="10" font-weight="700">${value}</text>`;
}

/** One composite image keeps Tinycast's Grid identity stable throughout a live run. */
export function dashboardDataUri(state: LiveState, appearance: "light" | "dark"): string {
  const theme = palette(appearance), ping = latency(state);
  const activeKind = state.phase === "download" || state.phase === "upload" ? state.phase : undefined;
  const statusValue = activeKind ? `${Math.round(progressFraction(state.result[activeKind]) * 100)}%`
    : state.phase === "done" ? "✓" : state.phase === "error" ? "!" : state.phase === "cancelled" ? "—" : "…";
  const statusLabel = state.phase === "download" ? "Downloading" : state.phase === "upload" ? "Uploading"
    : state.phase === "ping" ? "Measuring ping" : state.phase === "done" ? "Complete"
      : state.phase === "error" ? "Failed" : state.phase === "cancelled" ? "Cancelled" : "Connecting";
  const statusColor = activeKind ? colors[activeKind] : state.phase === "done" ? "#32c878"
    : state.phase === "error" ? "#ef6464" : theme.muted;
  return encodeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="720" height="360" viewBox="0 0 720 360" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    <rect width="720" height="360" fill="${theme.background}"/>
    <text x="360" y="117" text-anchor="middle" fill="${statusColor}" font-size="30" font-weight="600">${statusValue}</text>
    <text x="360" y="141" text-anchor="middle" fill="${statusColor}" font-size="12">${statusLabel}</text>
    ${gauge("download", state, theme, 180)}${gauge("upload", state, theme, 540)}
    ${chart("download", state, theme, 39)}${chart("upload", state, theme, 383)}
    ${summaryCard(24, colors.ping, "Ping", ping === undefined ? "— ms" : `${ping.toFixed(1)} ms`, theme)}
    ${summaryCard(259, colors.download, "Download", formatValue(megabitsPerSecond(state.result.download)), theme)}
    ${summaryCard(494, colors.upload, "Upload", formatValue(megabitsPerSecond(state.result.upload)), theme)}
  </svg>`);
}
