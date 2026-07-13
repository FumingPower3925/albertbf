import { escapeHtml, escapeAttr } from "../render/html";

/**
 * Build-time benchmark visualizations. Two fences, both rendered to static
 * SVG/HTML at build time so the client ships zero JavaScript: theme-aware
 * (colors are CSS variables), accessible (every chart carries an `.sr-only`
 * data table or a real `<table>`), and CSP-clean.
 *
 *   ```chart      -> horizontal bar chart (one or more series)
 *   ```matrix     -> heatmap / comparison grid
 *
 * Authoring format (a small line-based DSL; `#` starts a comment):
 *
 *   ```chart
 *   title: Go 1.0 -> 1.1, measured speedup
 *   unit: x
 *   baseline: 1
 *   MapAccessInt: 2.33
 *   JSONMarshal: 1.87
 *   AppendBytes: 0.87
 *   ```
 *
 * Multi-series (grouped bars) use a `series:` header and comma-separated values:
 *
 *   ```chart
 *   series: go 1.0, go 1.1
 *   FmtFprintfInt: 94.1, 66.6
 *   MapAccessInt: 36.1, 15.5
 *   ```
 */

const RESERVED = new Set([
  "type", "title", "unit", "series", "baseline", "sort", "max", "note",
  "cols", "scale", "caption",
]);

interface Row {
  label: string;
  values: number[];
  /** Raw cell strings, for matrices that mix text and numbers. */
  cells: string[];
}

interface ChartSpec {
  options: Record<string, string>;
  series: string[];
  rows: Row[];
}

function parseSpec(source: string): ChartSpec {
  const options: Record<string, string> = {};
  const rows: Row[] = [];
  for (const raw of source.split("\n")) {
    const line = raw.replace(/\s+$/, "");
    if (!line.trim() || line.trim().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1).trim();
    if (RESERVED.has(key.toLowerCase())) {
      options[key.toLowerCase()] = rest;
      continue;
    }
    const cells = rest.split(",").map((c) => c.trim());
    rows.push({ label: key, cells, values: cells.map(parseNum) });
  }
  const series = options.series
    ? options.series.split(",").map((s) => s.trim()).filter(Boolean)
    : options.cols
      ? options.cols.split(",").map((s) => s.trim()).filter(Boolean)
      : [];
  return { options, series, rows };
}

/** Parses "1,234.5", "94.1", "2.33x", "42%" -> number; NaN for non-numeric. */
function parseNum(s: string): number {
  const cleaned = s.replace(/,/g, "").replace(/[x×%]$/i, "").trim();
  if (cleaned === "" || !/^-?\d*\.?\d+$/.test(cleaned)) return NaN;
  return Number(cleaned);
}

function fmtNum(v: number, unit?: string): string {
  const abs = Math.abs(v);
  let s: string;
  if (abs >= 1000) s = Math.round(v).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  else if (abs >= 100) s = Math.round(v).toString();
  else s = (Math.round(v * 100) / 100).toString();
  if (!unit) return s;
  if (unit === "×" || unit === "x" || unit === "%") return s + (unit === "x" ? "×" : unit);
  return `${s} ${unit}`;
}

// ---- bar chart --------------------------------------------------------------

const W = 760;
const PAD = 8;

function renderBar(spec: ChartSpec): string {
  const { options } = spec;
  const nSeries = Math.max(1, spec.series.length);
  let rows = spec.rows.filter((r) => r.values.some((v) => !Number.isNaN(v)));
  if (!rows.length) return "";

  const sort = (options.sort || "none").toLowerCase();
  if (sort === "desc" || sort === "asc") {
    const dir = sort === "desc" ? -1 : 1;
    rows = [...rows].sort((a, b) => dir * ((a.values[0] || 0) - (b.values[0] || 0)));
  }

  const unit = options.unit;
  const baseline = options.baseline !== undefined ? parseNum(options.baseline) : NaN;
  const allVals = rows.flatMap((r) => r.values.filter((v) => !Number.isNaN(v)));
  const dataMax = Math.max(...allVals, Number.isNaN(baseline) ? 0 : baseline);
  const maxOpt = options.max !== undefined ? parseNum(options.max) : NaN;
  const maxVal = (!Number.isNaN(maxOpt) ? maxOpt : dataMax) * 1.02 || 1;

  const longest = Math.max(...rows.map((r) => r.label.length), 6);
  const labelW = Math.min(300, Math.max(78, longest * 7.1 + 8));
  const barStart = PAD + labelW + 12;
  const valueW = 58;
  const barMax = W - PAD - valueW - barStart;

  const thick = nSeries === 1 ? 15 : 12;
  const innerGap = 4;
  const groupH = nSeries * thick + (nSeries - 1) * innerGap;
  const rowH = groupH + 16;
  const top = PAD + 2;
  const chartH = top + rows.length * rowH + PAD;
  const scale = barMax / maxVal;

  const parts: string[] = [];

  // baseline reference line
  if (!Number.isNaN(baseline) && baseline > 0) {
    const bx = barStart + baseline * scale;
    parts.push(
      `<line class="chart__baseline" x1="${bx.toFixed(1)}" y1="${top}" x2="${bx.toFixed(1)}" y2="${(chartH - PAD).toFixed(1)}"/>`,
      `<text class="chart__baseline-label" x="${bx.toFixed(1)}" y="${(top - 0.5).toFixed(1)}" text-anchor="middle">${escapeHtml(fmtNum(baseline, unit))}</text>`,
    );
  }

  rows.forEach((r, i) => {
    const gTop = top + i * rowH + 8;
    const cy = gTop + groupH / 2;
    parts.push(
      `<text class="chart__cat" x="${(PAD + labelW).toFixed(1)}" y="${cy.toFixed(1)}" text-anchor="end" dominant-baseline="middle">${escapeHtml(r.label)}</text>`,
    );
    for (let s = 0; s < nSeries; s++) {
      const v = r.values[s];
      if (Number.isNaN(v)) continue;
      const by = gTop + s * (thick + innerGap);
      const w = Math.max(0, v * scale);
      const under = !Number.isNaN(baseline) && v < baseline;
      const cls = nSeries === 1
        ? (under ? "chart__bar chart__bar--under" : "chart__bar chart__bar--s1")
        : `chart__bar chart__bar--s${(s % 4) + 1}`;
      parts.push(
        `<rect class="${cls}" x="${barStart.toFixed(1)}" y="${by.toFixed(1)}" width="${w.toFixed(1)}" height="${thick}" rx="3"/>`,
        `<text class="chart__val" x="${(barStart + w + 6).toFixed(1)}" y="${(by + thick / 2).toFixed(1)}" dominant-baseline="middle">${escapeHtml(fmtNum(v, unit))}</text>`,
      );
    }
  });

  // sr-only data table + concise aria summary
  const sorted = [...rows].sort((a, b) => (a.values[0] || 0) - (b.values[0] || 0));
  const lo = sorted[0], hi = sorted[sorted.length - 1];
  const summary = `${options.title || "Bar chart"}: ${rows.length} ${rows.length === 1 ? "value" : "values"}` +
    (nSeries === 1 ? `, from ${lo.label} ${fmtNum(lo.values[0], unit)} to ${hi.label} ${fmtNum(hi.values[0], unit)}.` : ` across ${nSeries} series.`);

  const legend = nSeries > 1
    ? `<div class="chart__legend">${spec.series.map((name, s) =>
        `<span class="chart__legend-item"><span class="chart__swatch chart__swatch--s${(s % 4) + 1}"></span>${escapeHtml(name)}</span>`).join("")}</div>`
    : "";

  const table = buildBarTable(spec, rows, unit);

  const titleHtml = options.title
    ? `<figcaption class="chart__title">${escapeHtml(options.title)}</figcaption>` : "";
  const noteHtml = options.note
    ? `<p class="chart__note">${escapeHtml(options.note)}</p>` : "";

  return `<figure class="chart chart--bar">${titleHtml}${legend}` +
    `<svg class="chart__svg" viewBox="0 0 ${W} ${chartH.toFixed(0)}" role="img" ` +
    `aria-label="${escapeAttr(summary)}" preserveAspectRatio="xMinYMin meet">${parts.join("")}</svg>` +
    `${noteHtml}${table}</figure>\n`;
}

function buildBarTable(spec: ChartSpec, rows: Row[], unit?: string): string {
  const headCols = spec.series.length ? spec.series : ["value"];
  const head = `<tr><th scope="col">benchmark</th>${headCols.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = rows.map((r) =>
    `<tr><th scope="row">${escapeHtml(r.label)}</th>${headCols.map((_, s) =>
      `<td>${escapeHtml(Number.isNaN(r.values[s]) ? "—" : fmtNum(r.values[s], unit))}</td>`).join("")}</tr>`).join("");
  const cap = spec.options.title ? `<caption>${escapeHtml(spec.options.title)}</caption>` : "";
  return `<table class="sr-only">${cap}<thead>${head}</thead><tbody>${body}</tbody></table>`;
}

// ---- matrix / heatmap -------------------------------------------------------

// Only unambiguously-valenced tokens get color. "yes"/"no"/"true"/"false" are
// context-dependent (in an anomaly table "yes" is bad), so they stay neutral.
const STATUS: Record<string, string> = {
  pass: "pos", ok: "pos", fail: "neg",
};

function renderMatrix(spec: ChartSpec): string {
  const { options } = spec;
  const cols = spec.series;
  if (!spec.rows.length || !cols.length) return "";

  const numericCells = spec.rows.flatMap((r) => r.values.filter((v) => !Number.isNaN(v)));
  const min = Math.min(...numericCells);
  const max = Math.max(...numericCells);
  const diverge = (options.scale || "").toLowerCase() === "diverge";
  const mid = options.baseline !== undefined ? parseNum(options.baseline) : (min + max) / 2;
  const unit = options.unit;

  const cellStyle = (v: number): string => {
    if (Number.isNaN(v) || max === min) return "";
    if (diverge) {
      const c = v >= mid ? "var(--color-success)" : "var(--color-accent)";
      const span = v >= mid ? max - mid : mid - min;
      const norm = span === 0 ? 0 : Math.abs(v - mid) / span;
      const pct = (6 + norm * 42).toFixed(0);
      return ` style="background:color-mix(in oklab, ${c} ${pct}%, transparent)"`;
    }
    const norm = (v - min) / (max - min);
    const pct = (6 + norm * 42).toFixed(0);
    return ` style="background:color-mix(in oklab, var(--color-accent) ${pct}%, transparent)"`;
  };

  const head = `<tr><td></td>${cols.map((c) => `<th scope="col">${escapeHtml(c)}</th>`).join("")}</tr>`;
  const body = spec.rows.map((r) => {
    const cells = cols.map((_, i) => {
      const raw = r.cells[i] ?? "";
      const v = r.values[i];
      if (!Number.isNaN(v)) {
        return `<td class="matrix__cell matrix__cell--num"${cellStyle(v)}>${escapeHtml(fmtNum(v, unit))}</td>`;
      }
      const st = STATUS[raw.toLowerCase()];
      const cls = st ? ` matrix__cell--${st}` : "";
      return `<td class="matrix__cell${cls}">${escapeHtml(raw)}</td>`;
    }).join("");
    return `<tr><th scope="row">${escapeHtml(r.label)}</th>${cells}</tr>`;
  }).join("");

  const cap = options.title ? `<caption>${escapeHtml(options.title)}</caption>` : "";
  const noteHtml = options.note ? `<p class="chart__note">${escapeHtml(options.note)}</p>` : "";
  return `<figure class="chart chart--matrix"><table class="matrix">${cap}<thead>${head}</thead><tbody>${body}</tbody></table>${noteHtml}</figure>\n`;
}

/** Returns rendered HTML for a `chart`/`matrix` fence, or null for other langs. */
export function renderChartFence(lang: string, source: string): string | null {
  if (lang === "chart") {
    const spec = parseSpec(source);
    const type = (spec.options.type || "bar").toLowerCase();
    if (type === "matrix" || type === "heatmap") return renderMatrix(spec);
    return renderBar(spec);
  }
  if (lang === "matrix" || lang === "heatmap") {
    return renderMatrix(parseSpec(source));
  }
  return null;
}
