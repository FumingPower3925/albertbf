import { escapeAttr, escapeHtml } from "../render/html";

/**
 * The roadmap's overview graphic: the tier dependency graph drawn as a trunk
 * that fans into branches.
 *
 * The tier graph is a DAG, not a tree (tier 9 builds on two tiers at once), so
 * rows come from a longest-path pass rather than a parent pointer. That keeps
 * the drawing correct if the `builds_on` edges in the data change.
 *
 * Conventions follow src/build/markdown/diagram.ts: the SVG is decorative
 * (role="img" plus a text summary), colours arrive as CSS custom properties so
 * both themes work, and marker ids are suffixed to stay unique on the page.
 * Tier colours are never used for text, only for geometry, because several of
 * them do not reach 4.5:1 against the light background.
 */

export interface SpineTier {
  id: string;
  n: number;
  short: string;
  name: string;
  builds_on?: string[];
}

const NODE_H = 34;
const CHAR_W = 7.3; // avg glyph advance for the UI font at 14px, as in diagram.ts
const PAD_X = 14;
const ROW_GAP = 78;
const COL_GAP = 14;
const MARGIN = 10;

function nodeWidth(label: string): number {
  return Math.max(label.length * CHAR_W + PAD_X * 2, 62);
}

/** Longest path from any root, so a node always sits below every parent. */
function rowOf(tiers: SpineTier[]): Map<string, number> {
  const byId = new Map(tiers.map((t) => [t.id, t]));
  const memo = new Map<string, number>();
  const walk = (id: string, seen: Set<string>): number => {
    if (memo.has(id)) return memo.get(id)!;
    const t = byId.get(id);
    const parents = (t?.builds_on ?? []).filter((p) => byId.has(p) && !seen.has(p));
    const depth = parents.length
      ? Math.max(...parents.map((p) => walk(p, new Set([...seen, id])) + 1))
      : 0;
    memo.set(id, depth);
    return depth;
  };
  for (const t of tiers) walk(t.id, new Set());
  return memo;
}

export function renderSpine(tiers: SpineTier[]): string {
  if (!tiers.length) return "";

  const rows = rowOf(tiers);
  const byRow = new Map<number, SpineTier[]>();
  for (const t of tiers) {
    const r = rows.get(t.id) ?? 0;
    if (!byRow.has(r)) byRow.set(r, []);
    byRow.get(r)!.push(t);
  }
  for (const list of byRow.values()) list.sort((a, b) => a.n - b.n);

  // widest row sets the drawing width; every row is centred within it
  let width = 0;
  for (const list of byRow.values()) {
    const w = list.reduce((sum, t) => sum + nodeWidth(t.short), 0) + COL_GAP * (list.length - 1);
    width = Math.max(width, w);
  }

  const pos = new Map<string, { x: number; y: number; w: number }>();
  for (const [r, list] of byRow) {
    const rowW = list.reduce((s, t) => s + nodeWidth(t.short), 0) + COL_GAP * (list.length - 1);
    let x = (width - rowW) / 2;
    for (const t of list) {
      const w = nodeWidth(t.short);
      pos.set(t.id, { x, y: r * ROW_GAP, w });
      x += w + COL_GAP;
    }
  }

  const maxRow = Math.max(...byRow.keys());
  const height = maxRow * ROW_GAP + NODE_H;

  // edges first so nodes paint over them
  const edges: string[] = [];
  for (const t of tiers) {
    for (const parentId of t.builds_on ?? []) {
      const p = pos.get(parentId);
      const c = pos.get(t.id);
      if (!p || !c) continue;
      const x1 = p.x + p.w / 2;
      const y1 = p.y + NODE_H;
      const x2 = c.x + c.w / 2;
      const y2 = c.y;
      const mid = (y1 + y2) / 2;
      edges.push(
        `<path class="spine__edge" d="M ${x1.toFixed(1)} ${y1.toFixed(1)} C ${x1.toFixed(1)} ${mid.toFixed(1)}, ${x2.toFixed(1)} ${mid.toFixed(1)}, ${x2.toFixed(1)} ${y2.toFixed(1)}"/>`,
      );
    }
  }

  const nodes = tiers.map((t) => {
    const p = pos.get(t.id)!;
    const cx = p.x + p.w / 2;
    return (
      `<g class="spine__node" style="--tier:var(--tier-${t.n})">` +
      `<rect x="${p.x.toFixed(1)}" y="${p.y.toFixed(1)}" width="${p.w.toFixed(1)}" height="${NODE_H}" rx="${(NODE_H / 2).toFixed(1)}"/>` +
      `<text class="spine__label" x="${cx.toFixed(1)}" y="${(p.y + NODE_H / 2).toFixed(1)}" text-anchor="middle" dominant-baseline="central">${escapeHtml(t.short)}</text>` +
      `</g>`
    );
  });

  const summary =
    `Tier dependency graph. ` +
    tiers
      .map((t) => {
        const deps = (t.builds_on ?? [])
          .map((id) => tiers.find((x) => x.id === id)?.name)
          .filter(Boolean);
        return deps.length
          ? `${t.name} builds on ${deps.join(" and ")}`
          : `${t.name} has no prerequisites`;
      })
      .join(". ") + ".";

  const vb = `${-MARGIN} ${-MARGIN} ${(width + MARGIN * 2).toFixed(1)} ${(height + MARGIN * 2).toFixed(1)}`;
  return (
    `<figure class="spine">` +
    `<svg class="spine__svg" viewBox="${vb}" role="img" aria-label="${escapeAttr(summary)}" preserveAspectRatio="xMidYMid meet">` +
    edges.join("") +
    nodes.join("") +
    `</svg>` +
    `</figure>`
  );
}
