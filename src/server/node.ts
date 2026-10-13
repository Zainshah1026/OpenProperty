// Node entry point, for hosts such as Render that run a plain Node process.
//
// It serves the same Hono app as the Cloudflare Worker, with the database in a
// SQLite file (node:sqlite, built into Node 22+) and the built React app served
// from dist/. Set DATABASE_PATH to a persistent disk, e.g. /var/data/portfolio.db.

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { mkdirSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, join, normalize, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import schema from "./schema.sql?raw";
import app from "./index";
import { setAdapter } from "./db";

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = resolve(process.env.DATABASE_PATH || "./data/portfolio.db");
const DIST = resolve(process.env.STATIC_DIR || "./dist");

// ── Database ───────────────────────────────────────────────────────

mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
sqlite.exec(schema);

type SqlValue = null | number | bigint | string | Uint8Array;
const bindable = (params: unknown[]): SqlValue[] =>
  params.map((p) => (p === undefined ? null : typeof p === "boolean" ? (p ? 1 : 0) : (p as SqlValue)));

setAdapter({
  async all<T>(sql: string, params: unknown[]) {
    return sqlite.prepare(sql).all(...bindable(params)) as T[];
  },
  async run(sql: string, params: unknown[]) {
    const r = sqlite.prepare(sql).run(...bindable(params));
    return { changes: Number(r.changes), lastInsertRowid: Number(r.lastInsertRowid) };
  },
});

// ── Static files (stands in for Cloudflare's ASSETS binding) ───────

const TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".ico": "image/x-icon",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".woff2": "font/woff2",
};

function fileResponse(path: string): Response | null {
  try {
    if (!statSync(path).isFile()) return null;
  } catch {
    return null;
  }
  const body = readFileSync(path);
  const type = TYPES[extname(path)] ?? "application/octet-stream";
  const cache = path.includes(`${join(DIST, "assets")}`) ? "public, max-age=31536000, immutable" : "no-cache";
  return new Response(body, { headers: { "Content-Type": type, "Cache-Control": cache } });
}

const ASSETS = {
  async fetch(input: Request | string): Promise<Response> {
    const url = new URL(typeof input === "string" ? input : input.url);
    const safe = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
    const target = join(DIST, safe);
    if (target.startsWith(DIST)) {
      const hit = fileResponse(target);
      if (hit) return hit;
    }
    // Client-side routes fall back to the app shell.
    return fileResponse(join(DIST, "index.html")) ?? new Response("Not found", { status: 404 });
  },
};

const env = {
  ASSETS: ASSETS as unknown as Fetcher,
  APP_PASSWORD: process.env.APP_PASSWORD,
  APP_USERNAME: process.env.APP_USERNAME,
  ALLOW_NO_AUTH: process.env.ALLOW_NO_AUTH,
};

// ── HTTP bridge ────────────────────────────────────────────────────

async function readBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return undefined;
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const host = req.headers.host ?? `localhost:${PORT}`;
  const url = `http://${host}${req.url ?? "/"}`;
  const headers = new Headers();
  for (const [k, v] of Object.entries(req.headers)) {
    if (Array.isArray(v)) v.forEach((x) => headers.append(k, x));
    else if (v !== undefined) headers.set(k, v);
  }
  const body = await readBody(req);
  const request = new Request(url, { method: req.method, headers, body: body && body.length ? body : undefined });
  const response = await app.fetch(request, env);
  res.statusCode = response.status;
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.end(Buffer.from(await response.arrayBuffer()));
}

createServer((req, res) => {
  handle(req, res).catch((err) => {
    console.error(err);
    res.statusCode = 500;
    res.end("Internal error");
  });
}).listen(PORT, () => {
  console.log(`Portfolio app listening on :${PORT} (database: ${DB_PATH})`);
});
