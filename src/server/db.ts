// Database access shared by both runtimes.
//
// On Cloudflare Workers the app talks to D1 through `env.DB`. On a Node host
// (Render, a VPS, your laptop) src/server/node.ts installs a SQLite adapter
// before the first request. Route code only ever sees query / get / run.

type Params = unknown[];

export interface RunResult {
  changes: number;
  lastInsertRowid: number;
}

export interface DbAdapter {
  all<T>(sql: string, params: Params): Promise<T[]>;
  run(sql: string, params: Params): Promise<RunResult>;
}

let adapter: DbAdapter | null = null;

/** Used by the Node server to plug in its SQLite database. */
export function setAdapter(a: DbAdapter): void {
  adapter = a;
}

function d1Adapter(db: D1Database): DbAdapter {
  return {
    async all<T>(sql: string, params: Params) {
      const r = await db.prepare(sql).bind(...params).all<T>();
      return (r.results ?? []) as T[];
    },
    async run(sql: string, params: Params) {
      const r = await db.prepare(sql).bind(...params).run();
      return { changes: r.meta.changes ?? 0, lastInsertRowid: Number(r.meta.last_row_id ?? 0) };
    },
  };
}

/** Called per request; on Workers it binds D1, on Node the adapter is already set. */
export function initDB(env: { DB?: D1Database }): void {
  if (env.DB) adapter = d1Adapter(env.DB);
}

function db(): DbAdapter {
  if (!adapter) throw new Error("Database not initialised");
  return adapter;
}

export function query<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T[]> {
  return db().all<T>(sql, params);
}

export async function get<T = Record<string, unknown>>(sql: string, params: Params = []): Promise<T | undefined> {
  const rows = await db().all<T>(sql, params);
  return rows[0];
}

export function run(sql: string, params: Params = []): Promise<RunResult> {
  return db().run(sql, params);
}
