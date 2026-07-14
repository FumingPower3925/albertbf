import { escapeHtml, escapeAttr } from "../render/html";
// dagre-d3-es bundles dagre's layout + graphlib (pure JS, no DOM), already a
// transitive dependency. We use it only for layout math and render our own SVG.
// eslint-disable-next-line
import * as dagre from "dagre-d3-es/src/dagre/index.js";
import { Graph } from "dagre-d3-es/src/graphlib/index.js";

/**
 * Build-time diagrams: a small node/edge DSL laid out by dagre and rendered to
 * themed SVG at build time (no client JS, unlike the old client-mermaid path).
 *
 *   ```diagram
 *   dir: LR
 *   K (stadium): one global lock
 *   go (accent): Go\ngoroutines & channels
 *   Q -> K
 *   r60 ~> go1: 6 months, weekly only     # ~> is a dashed edge
 *   group "Go 1.0": Q, K, Ta, Tb          # a cluster
 *   ```
 *
 * Nodes: `id (shape,style): label`. shapes: box round stadium circle hex cyl.
 * styles: accent, muted. `\n` in a label is a line break. Edges: `a -> b`
 * (chains ok: `a -> b -> c`), `a ~> b` dashed, trailing `: text` is an edge
 * label. Undeclared ids referenced by an edge become plain boxes.
 */

const OPTION_KEYS = new Set(["dir", "direction", "title", "note", "spacing"]);
const SHAPES = new Set(["box", "round", "stadium", "circle", "hex", "cyl"]);

interface Node { id: string; label: string; shape: string; accent: boolean; muted: boolean; }
interface Edge { from: string; to: string; label?: string; dashed: boolean; }
interface Group { label: string; members: string[]; }
interface Spec { opts: Record<string, string>; nodes: Map<string, Node>; edges: Edge[]; groups: Group[]; }

function ensureNode(nodes: Map<string, Node>, id: string): Node {
  let n = nodes.get(id);
  if (!n) { n = { id, label: id, shape: "box", accent: false, muted: false }; nodes.set(id, n); }
  return n;
}

function parseDiagram(source: string): Spec {
  const opts: Record<string, string> = {};
  const nodes = new Map<string, Node>();
  const edges: Edge[] = [];
  const groups: Group[] = [];

  for (const raw of source.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("#")) continue;

    // group "Label": a, b, c
    const gm = line.match(/^group\s+"([^"]*)"\s*:\s*(.+)$/i);
    if (gm) {
      const members = gm[2].split(",").map((s) => s.trim()).filter(Boolean);
      members.forEach((id) => ensureNode(nodes, id));
      groups.push({ label: gm[1], members });
      continue;
    }

    // edge line (contains an arrow)
    if (/(->|~>)/.test(line)) {
      // trailing ": label" (only after the last arrow)
      let body = line, label: string | undefined;
      const lastArrow = Math.max(body.lastIndexOf("->"), body.lastIndexOf("~>"));
      const colon = body.indexOf(":", lastArrow);
      if (colon !== -1) { label = body.slice(colon + 1).trim(); body = body.slice(0, colon); }
      const segs = body.split(/\s*(->|~>)\s*/);
      for (let i = 0; i + 2 < segs.length + 1; i += 2) {
        const from = segs[i]?.trim(), op = segs[i + 1], to = segs[i + 2]?.trim();
        if (!from || !to) break;
        ensureNode(nodes, from); ensureNode(nodes, to);
        const isLast = i + 2 >= segs.length - 1;
        edges.push({ from, to, dashed: op === "~>", label: isLast ? label : undefined });
      }
      continue;
    }

    // option or node: `key: value` / `id (mods): label`
    const nm = line.match(/^([\w-]+)\s*(?:\(([^)]*)\))?\s*:\s*([\s\S]*)$/);
    if (!nm) continue;
    const [, key, mods, value] = nm;
    if (!mods && OPTION_KEYS.has(key.toLowerCase())) { opts[key.toLowerCase()] = value.trim(); continue; }
    const n = ensureNode(nodes, key);
    n.label = value.trim();
    for (const m of (mods || "").split(",").map((s) => s.trim().toLowerCase())) {
      if (SHAPES.has(m)) n.shape = m;
      else if (m === "accent") n.accent = true;
      else if (m === "muted") n.muted = true;
    }
  }
  return { opts, nodes, edges, groups };
}

// ---- geometry ---------------------------------------------------------------

const CHAR_W = 7.3;   // avg glyph advance for the UI font at 14px
const LINE_H = 18;
const PAD_X = 15;
const PAD_Y = 11;

function labelLines(label: string): string[] {
  return label.split(/\\n|\n/).map((s) => s.trim());
}

function nodeSize(n: Node): { width: number; height: number } {
  const lines = labelLines(n.label);
  const textW = Math.max(...lines.map((l) => l.length * CHAR_W), 10);
  let width = textW + PAD_X * 2;
  let height = lines.length * LINE_H + PAD_Y * 2;
  if (n.shape === "stadium") width += height * 0.5;
  if (n.shape === "hex") width += height * 0.7;
  if (n.shape === "circle") { const d = Math.max(width, height, 54); return { width: d, height: d }; }
  return { width: Math.max(width, 48), height: Math.max(height, 38) };
}

function hashId(s: string): string {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

// catmull-rom through the routed points → a smooth path
function smoothPath(pts: { x: number; y: number }[]): string {
  if (pts.length < 3) return `M ${pts.map((p) => `${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" L ")}`;
  let d = `M ${pts[0].x.toFixed(1)} ${pts[0].y.toFixed(1)}`;
  for (let i = 0; i < pts.length - 1; i++) {
    const p0 = pts[i - 1] || pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] || p2;
    const c1x = p1.x + (p2.x - p0.x) / 6, c1y = p1.y + (p2.y - p0.y) / 6;
    const c2x = p2.x - (p3.x - p1.x) / 6, c2y = p2.y - (p3.y - p1.y) / 6;
    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

// ---- shape rendering --------------------------------------------------------

function nodeShape(n: Node, x: number, y: number, w: number, h: number): string {
  const L = x - w / 2, T = y - h / 2;
  switch (n.shape) {
    case "circle":
      return `<circle cx="${x}" cy="${y}" r="${(w / 2).toFixed(1)}"/>`;
    case "stadium":
      return `<rect x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${w}" height="${h}" rx="${(h / 2).toFixed(1)}"/>`;
    case "round":
      return `<rect x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${w}" height="${h}" rx="16"/>`;
    case "hex": {
      const c = h * 0.32;
      return `<polygon points="${L + c},${T} ${L + w - c},${T} ${L + w},${y} ${L + w - c},${T + h} ${L + c},${T + h} ${L},${y}"/>`;
    }
    case "cyl": {
      const e = Math.min(10, h * 0.16);
      return `<path d="M ${L} ${T + e} A ${w / 2} ${e} 0 0 1 ${L + w} ${T + e} L ${L + w} ${T + h - e} A ${w / 2} ${e} 0 0 1 ${L} ${T + h - e} Z M ${L} ${T + e} A ${w / 2} ${e} 0 0 0 ${L + w} ${T + e}"/>`;
    }
    default:
      return `<rect x="${L.toFixed(1)}" y="${T.toFixed(1)}" width="${w}" height="${h}" rx="9"/>`;
  }
}

function nodeText(n: Node, x: number, y: number): string {
  const lines = labelLines(n.label);
  const startY = y - ((lines.length - 1) * LINE_H) / 2;
  const tspans = lines.map((l, i) =>
    `<tspan x="${x.toFixed(1)}" y="${(startY + i * LINE_H).toFixed(1)}">${escapeHtml(l)}</tspan>`).join("");
  return `<text text-anchor="middle" dominant-baseline="central">${tspans}</text>`;
}

// ---- main -------------------------------------------------------------------

export function renderDiagramFence(lang: string, source: string): string | null {
  if (lang !== "diagram") return null;
  const spec = parseDiagram(source);
  if (!spec.nodes.size) return "";

  const uid = hashId(source);
  const rankdir = (spec.opts.dir || spec.opts.direction || "LR").toUpperCase();

  const g: any = new Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir, nodesep: 26, ranksep: 52, marginx: 8, marginy: 8 });
  g.setDefaultEdgeLabel(() => ({}));

  // clusters first, then nodes parented into them
  const memberOf = new Map<string, number>();
  spec.groups.forEach((grp, gi) => {
    g.setNode(`cluster${gi}`, {});
    grp.members.forEach((id) => memberOf.set(id, gi));
  });
  for (const n of spec.nodes.values()) {
    g.setNode(n.id, nodeSize(n));
    const gi = memberOf.get(n.id);
    if (gi !== undefined) g.setParent(n.id, `cluster${gi}`);
  }
  spec.edges.forEach((e, i) => {
    const lbl = e.label ? { width: e.label.length * 6.2 + 12, height: 16, labelpos: "c" } : {};
    g.setEdge(e.from, e.to, lbl, `e${i}`);
  });

  dagre.layout(g);
  const gr = g.graph();
  const W = Math.ceil(gr.width || 10), H = Math.ceil(gr.height || 10);
  const P = 6;

  // Track the real drawn bounds so inflated cluster cards (which extend up for
  // their header label) are never clipped by the viewBox.
  let minX = 0, minY = 0, maxX = W, maxY = H;
  const clusters: string[] = [];
  spec.groups.forEach((grp, gi) => {
    const c = g.node(`cluster${gi}`);
    if (!c) return;
    const pad = 8, labelH = 20;
    const bx = c.x - c.width / 2 - pad;
    const by = c.y - c.height / 2 - pad - labelH;
    const bw = c.width + pad * 2;
    const bh = c.height + pad * 2 + labelH;
    minX = Math.min(minX, bx); minY = Math.min(minY, by);
    maxX = Math.max(maxX, bx + bw); maxY = Math.max(maxY, by + bh);
    clusters.push(
      `<g class="diagram__cluster">` +
      `<rect x="${bx.toFixed(1)}" y="${by.toFixed(1)}" width="${bw.toFixed(1)}" height="${bh.toFixed(1)}" rx="14"/>` +
      `<text class="diagram__cluster-label" x="${(bx + 13).toFixed(1)}" y="${(by + labelH / 2 + 5).toFixed(1)}">${escapeHtml(grp.label)}</text>` +
      `</g>`);
  });

  const edgeEls: string[] = [];
  spec.edges.forEach((e, i) => {
    const ed = g.edge(e.from, e.to, `e${i}`);
    if (!ed?.points) return;
    const cls = `diagram__edge${e.dashed ? " diagram__edge--dashed" : ""}`;
    const marker = e.dashed ? `url(#ah-a-${uid})` : `url(#ah-${uid})`;
    edgeEls.push(`<path class="${cls}" d="${smoothPath(ed.points)}" marker-end="${marker}"/>`);
    if (e.label && ed.x !== undefined) {
      const lw = e.label.length * 6.2 + 12;
      edgeEls.push(
        `<g class="diagram__edge-label">` +
        `<rect x="${(ed.x - lw / 2).toFixed(1)}" y="${(ed.y - 9).toFixed(1)}" width="${lw.toFixed(1)}" height="18" rx="5"/>` +
        `<text x="${ed.x.toFixed(1)}" y="${ed.y.toFixed(1)}" text-anchor="middle" dominant-baseline="central">${escapeHtml(e.label)}</text>` +
        `</g>`);
    }
  });

  const nodeEls: string[] = [];
  for (const n of spec.nodes.values()) {
    const p = g.node(n.id);
    if (!p) continue;
    const cls = `diagram__node${n.accent ? " diagram__node--accent" : ""}${n.muted ? " diagram__node--muted" : ""}`;
    nodeEls.push(`<g class="${cls}">${nodeShape(n, p.x, p.y, p.width, p.height)}${nodeText(n, p.x, p.y)}</g>`);
  }

  const arrow = (id: string, cls: string) =>
    `<marker id="${id}" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse"><path class="${cls}" d="M 0 1 L 9 5 L 0 9 z"/></marker>`;

  const nodeList = [...spec.nodes.values()].map((n) => labelLines(n.label).join(" ")).join("; ");
  const summary = `${spec.opts.title || "Diagram"}: ${spec.nodes.size} nodes, ${spec.edges.length} connections. ${nodeList}`;

  const titleHtml = spec.opts.title ? `<figcaption class="diagram__title">${escapeHtml(spec.opts.title)}</figcaption>` : "";
  const noteHtml = spec.opts.note ? `<p class="diagram__note">${escapeHtml(spec.opts.note)}</p>` : "";

  const vbX = (minX - P).toFixed(1), vbY = (minY - P).toFixed(1);
  const vbW = (maxX - minX + P * 2).toFixed(1), vbH = (maxY - minY + P * 2).toFixed(1);
  return `<figure class="diagram">${titleHtml}` +
    `<svg class="diagram__svg" viewBox="${vbX} ${vbY} ${vbW} ${vbH}" role="img" aria-label="${escapeAttr(summary)}" preserveAspectRatio="xMidYMid meet">` +
    `<defs>${arrow(`ah-${uid}`, "diagram__arrowhead")}${arrow(`ah-a-${uid}`, "diagram__arrowhead diagram__arrowhead--accent")}</defs>` +
    clusters.join("") + edgeEls.join("") + nodeEls.join("") +
    `</svg>${noteHtml}</figure>\n`;
}
