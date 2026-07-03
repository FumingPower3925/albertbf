import type { Engine, OutputEvent } from "./index";

/**
 * SQL engine: sql.js (SQLite compiled to WASM), fully client-side.
 * Each run gets a fresh in-memory database. Optional `db=seed.sql` fence
 * meta preloads a seed file colocated with the article.
 */

declare global {
  interface Window {
    initSqlJs?: (config: { locateFile: (f: string) => string }) => Promise<any>;
  }
}

let sqlJs: Promise<any> | null = null;

function loadSqlJs(): Promise<any> {
  if (!sqlJs) {
    sqlJs = new Promise<void>((resolve, reject) => {
      if (window.initSqlJs) return resolve();
      const script = document.createElement("script");
      script.src = "/vendor/sqljs/sql-wasm.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("sql.js failed to load"));
      document.head.appendChild(script);
    }).then(() =>
      window.initSqlJs!({ locateFile: (f: string) => `/vendor/sqljs/${f}` }),
    );
  }
  return sqlJs;
}

/** Renders result rows as an aligned text table. */
function textTable(columns: string[], values: unknown[][]): string {
  const rows = [columns, ...values.map((row) => row.map((v) => (v === null ? "NULL" : String(v))))];
  const widths = columns.map((_, i) => Math.max(...rows.map((r) => r[i].length)));
  const line = (row: string[]) => row.map((cell, i) => cell.padEnd(widths[i])).join("  ");
  const separator = widths.map((w) => "-".repeat(w)).join("  ");
  return [line(rows[0]), separator, ...rows.slice(1).map(line)].join("\n");
}

export const engine: Engine = {
  async *run(source: string, opts: { db?: string; baseUrl: string }): AsyncIterable<OutputEvent> {
    const SQL = await loadSqlJs();
    const db = new SQL.Database();
    try {
      if (opts.db) {
        const seedUrl = opts.baseUrl.replace(/[^/]*$/, "") + opts.db.replace(/^\.\//, "");
        const res = await fetch(seedUrl);
        if (!res.ok) throw new Error(`Seed file not found: ${opts.db}`);
        db.run(await res.text());
        yield { kind: "system", text: `-- loaded ${opts.db}\n\n` };
      }

      const results = db.exec(source);
      let statements = 0;
      for (const result of results) {
        if (statements++) yield { kind: "stdout", text: "\n\n" };
        yield { kind: "stdout", text: textTable(result.columns, result.values) };
      }
      const changes = db.getRowsModified();
      if (!results.length) {
        yield {
          kind: "system",
          text: changes > 0 ? `${changes} row(s) modified` : "OK (no rows returned)",
        };
      }
    } catch (err) {
      yield { kind: "stderr", text: err instanceof Error ? err.message : String(err) };
    } finally {
      db.close();
    }
  },
};
