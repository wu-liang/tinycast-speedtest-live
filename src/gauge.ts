import { LiveState, SpeedMeasurement } from "./types";

const colors = {
  download: "#2196ff", upload: "#8047ff", ping: "#ffc83d",
  darkBackground: "#18191d", darkPanel: "#232325", darkText: "#f7f7fa", darkMuted: "#9c9ba2",
  lightBackground: "#f5f5f7", lightPanel: "#ffffff", lightText: "#17171b", lightMuted: "#666671",
  track: "#3b3b3e",
};

const layout = {
  width: 720,
  height: 360,
  edge: 24,
  gap: 16,
  chartY: 194,
  chartHeight: 84,
  summaryHeight: 39,
  footerBaseline: 352,
} as const;
const chartWidth = (layout.width - layout.edge * 2 - layout.gap) / 2;
const summaryWidth = (layout.width - layout.edge * 2 - layout.gap * 2) / 3;

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

function escapeSvgText(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]!);
}

function networkMetadata(label: string, value: string | undefined, x: number, anchor: "start" | "middle" | "end", theme: ReturnType<typeof palette>): string {
  const cellWidth = 5.2, labelGap = 6;
  const textWidth = (text: string) => Array.from(text).reduce((width, character) => width + (character.codePointAt(0)! > 255 ? 2 : 1) * cellWidth, 0);
  const labelWidth = textWidth(label);
  const available = summaryWidth - labelWidth - labelGap;
  let display = value?.trim().replace(/[\u0000-\u001f\u007f]/g, " ") || "—";
  if (textWidth(display) > available) {
    const characters = Array.from(display).slice(0, Math.floor(available / cellWidth));
    while (characters.length && textWidth(characters.join("") + "…") > available) characters.pop();
    display = characters.join("") + "…";
  }
  const width = labelWidth + labelGap + textWidth(display);
  const start = anchor === "start" ? x : anchor === "middle" ? x - width / 2 : x - width;
  const columnX = anchor === "start" ? x : anchor === "middle" ? x - summaryWidth / 2 : x - summaryWidth;
  const clipId = `footer-${anchor}`;
  // Separate text nodes retain their colors in Tinycast's native SVG renderer.
  return `<defs><clipPath id="${clipId}"><rect x="${columnX}" y="338" width="${summaryWidth}" height="20"/></clipPath></defs>
    <g clip-path="url(#${clipId})" font-family="Menlo,monospace" font-size="8.5">
      <text x="${start}" y="${layout.footerBaseline}" fill="${theme.muted}">${label}</text>
      <text x="${start + labelWidth + labelGap}" y="${layout.footerBaseline}" fill="${theme.text}">${escapeSvgText(display)}</text>
    </g>`;
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
    <text x="${cx}" y="177" text-anchor="middle" fill="${color}" font-size="11" font-weight="600">${label}</text>`;
}

function chart(kind: "download" | "upload", state: LiveState, theme: ReturnType<typeof palette>, x: number): string {
  const history = state.history[kind];
  const samples = history.samples.filter((value) => Number.isFinite(value) && value >= 0);
  const width = chartWidth - 30, baseline = 264, top = 235;
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
  return `<g><rect x="${x - 15}" y="${layout.chartY}" width="${chartWidth}" height="${layout.chartHeight}" rx="12" fill="${theme.panel}"/>
    <text x="${x}" y="211" fill="${theme.muted}" font-size="10">${label} over time</text>
    <text x="${x + chartWidth - 30}" y="211" text-anchor="end" fill="${theme.muted}" font-size="9">peak ${formatValue(history.count ? history.peak : undefined)}</text>
    ${fill ? `<path d="${fill}" fill="${color}" fill-opacity=".20"/>` : ""}${line ? `<path d="${line}" fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" stroke-linecap="round"/>` : ""}${samples.length ? `<circle cx="${endX.toFixed(2)}" cy="${endY.toFixed(2)}" r="3.5" fill="${color}"/>` : ""}</g>`;
}

function latency(state: LiveState): number | undefined {
  const value = state.result.ping?.latency;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : undefined;
}
function summaryText(value: string | undefined, maxWidth: number): string {
  let display = value?.trim().replace(/[\u0000-\u001f\u007f]/g, " ") || "—";
  const width = (text: string) => Array.from(text).reduce((total, character) => total + (character.codePointAt(0)! > 255 ? 10 : 5.5), 0);
  if (width(display) > maxWidth) {
    const characters = Array.from(display);
    while (characters.length && width(characters.join("") + "…") > maxWidth) characters.pop();
    display = characters.join("") + "…";
  }
  return escapeSvgText(display);
}

function summaryCard(index: number, color: string, title: string | undefined, value: string | undefined, theme: ReturnType<typeof palette>): string {
  const x = layout.edge + index * (summaryWidth + layout.gap);
  const centerY = layout.chartY + layout.chartHeight + layout.gap + layout.summaryHeight / 2;
  const summaryY = layout.chartY + layout.chartHeight + layout.gap;
  const textWidth = summaryWidth - 41;
  const clipId = `summary-${index}`;
  return `<defs><clipPath id="${clipId}"><rect x="${x + 31}" y="${summaryY + 4}" width="${textWidth}" height="${layout.summaryHeight - 6}"/></clipPath></defs><rect x="${x}" y="${summaryY}" width="${summaryWidth}" height="${layout.summaryHeight}" rx="11" fill="${color}" fill-opacity=".19"/><circle cx="${x + 17}" cy="${centerY}" r="4.5" fill="${color}"/><g clip-path="url(#${clipId})"><text x="${x + 31}" y="${summaryY + 18}" fill="${theme.text}" font-size="10" font-weight="600">${summaryText(title, textWidth)}</text><text x="${x + 31}" y="${summaryY + 31}" fill="${theme.text}" font-size="10" font-weight="700">${summaryText(value, textWidth)}</text></g>`;
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
  return encodeSvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${layout.width}" height="${layout.height}" viewBox="0 0 ${layout.width} ${layout.height}" font-family="-apple-system,BlinkMacSystemFont,sans-serif">
    <rect width="${layout.width}" height="${layout.height}" fill="${theme.background}"/>
    <text x="360" y="117" text-anchor="middle" fill="${statusColor}" font-size="30" font-weight="600">${statusValue}</text>
    <text x="360" y="141" text-anchor="middle" fill="${statusColor}" font-size="12">${statusLabel}</text>
    ${gauge("download", state, theme, 180)}${gauge("upload", state, theme, 540)}
    ${chart("download", state, theme, layout.edge + 15)}${chart("upload", state, theme, layout.edge + chartWidth + layout.gap + 15)}
    ${summaryCard(0, colors.download, state.result.isp, state.clientLocation?.city ? `${state.clientLocation.city}${state.clientLocation.countryCode ? `, ${state.clientLocation.countryCode}` : ""}` : undefined, theme)}
    ${summaryCard(1, colors.ping, "Ping", ping === undefined ? "— ms" : `${ping.toFixed(1)} ms`, theme)}
    ${summaryCard(2, colors.upload, state.result.server?.name, state.result.server?.location, theme)}
    ${networkMetadata("Internal IP", state.result.interface?.internalIp, layout.edge, "start", theme)}
    ${networkMetadata("External IP", state.result.interface?.externalIp, layout.width - layout.edge, "end", theme)}
  </svg>`);
}
