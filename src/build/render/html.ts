/**
 * Minimal HTML templating: a tagged template literal that escapes every
 * interpolated value unless it is wrapped in raw(). Arrays are joined
 * (each element escaped by the same rule), null/undefined render empty.
 */

const ESCAPE_RE = /[&<>"']/g;
const ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value: unknown): string {
  return String(value).replace(ESCAPE_RE, (ch) => ESCAPES[ch]);
}

export function escapeAttr(value: unknown): string {
  return escapeHtml(value);
}

class RawHtml {
  constructor(public readonly value: string) {}
  toString(): string {
    return this.value;
  }
}

/** Mark a string as already-safe HTML so `html` does not escape it. */
export function raw(value: string): RawHtml {
  return new RawHtml(value);
}

type Interpolation =
  | string
  | number
  | boolean
  | RawHtml
  | null
  | undefined
  | Interpolation[];

function render(value: Interpolation): string {
  if (value === null || value === undefined || value === false) return "";
  if (value instanceof RawHtml) return value.value;
  if (Array.isArray(value)) return value.map(render).join("");
  return escapeHtml(value);
}

export function html(
  strings: TemplateStringsArray,
  ...values: Interpolation[]
): RawHtml {
  let out = "";
  for (let i = 0; i < strings.length; i++) {
    out += strings[i];
    if (i < values.length) out += render(values[i]);
  }
  return new RawHtml(out);
}

export type { RawHtml };
