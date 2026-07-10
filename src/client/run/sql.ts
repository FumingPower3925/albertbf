import type { Engine, OutputEvent } from "./index";

/**
 * SQL engine: sql.js (SQLite compiled to WASM), fully client-side.
 *
 * `db=` fence meta selects the database for a block:
 *   (omitted)              fresh empty in-memory DB, discarded after the run.
 *   db=seed.sql           fresh DB seeded from a colocated SQL text script.
 *   db=data.sqlite        fresh DB opened from a colocated binary SQLite file.
 *   db=@shared            one persistent DB reused across every block on the
 *                         page — progressive tutorials build state block by block.
 *   db=@shared:seed.sql   the shared DB, seeded once (text or binary) on first use.
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

/** One persistent database per page, backing `db=@shared` tutorials. */
let sharedDb: any = null;

function parseDbMeta(db?: string): { shared: boolean; seed?: string } {
  if (!db) return { shared: false };
  const sharedMatch = db.match(/^@shared(?::(.+))?$/);
  if (sharedMatch) return { shared: true, seed: sharedMatch[1] };
  return { shared: false, seed: db };
}

/** A binary SQLite snapshot is opened directly; a .sql script is executed. */
function isBinarySeed(file: string): boolean {
  return /\.(sqlite3?|db)$/i.test(file);
}

/**
 * Open a new database, optionally seeded. Text seeds run into a fresh DB;
 * binary seeds ARE the database. Returns the DB plus a one-line system notice.
 */
async function openDb(
  SQL: any,
  seed: string | undefined,
  baseUrl: string,
): Promise<{ db: any; notice?: string }> {
  if (!seed) return { db: new SQL.Database() };
  const url = baseUrl.replace(/[^/]*$/, "") + seed.replace(/^\.\//, "");
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Seed file not found: ${seed}`);
  if (isBinarySeed(seed)) {
    const bytes = new Uint8Array(await res.arrayBuffer());
    return { db: new SQL.Database(bytes), notice: `-- opened ${seed}\n\n` };
  }
  const db = new SQL.Database();
  try {
    db.run(await res.text());
  } catch (err) {
    db.close();
    throw err;
  }
  return { db, notice: `-- loaded ${seed}\n\n` };
}

export const engine: Engine = {
  async *run(source: string, opts: { db?: string; baseUrl: string }): AsyncIterable<OutputEvent> {
    const SQL = await loadSqlJs();
    const { shared, seed } = parseDbMeta(opts.db);
    let db: any = null;
    try {
      if (shared) {
        if (!sharedDb) {
          const opened = await openDb(SQL, seed, opts.baseUrl);
          sharedDb = opened.db;
          // Seeding notice only fires once, when the shared DB is first created.
          if (opened.notice) yield { kind: "system", text: opened.notice };
        }
        db = sharedDb;
      } else {
        const opened = await openDb(SQL, seed, opts.baseUrl);
        db = opened.db;
        if (opened.notice) yield { kind: "system", text: opened.notice };
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
      // The shared DB persists for later blocks; per-run databases are closed.
      if (!shared && db) db.close();
    }
  },
};
