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
import { runSync, syncEnabled } from "./sync";
import { setMailProvider } from "./mail";
import { createImapProvider } from "./imap";

// Inbox: the company mailboxes, read over IMAP (see src/server/imap.ts).
setMailProvider(createImapProvider(process.env));
{
  // Names only, never values: helps spot a mistyped or unsaved setting.
  const mailKeys = Object.keys(process.env).filter((k) => /mail/i.test(k)).sort();
  const boxes = createImapProvider(process.env).accounts();
  console.log(`Inbox: ${boxes.length} mailbox(es) connected${boxes.length ? `: ${boxes.join(", ")}` : ""}. Mail settings present: ${mailKeys.join(", ") || "none"}`);
  for (const k of mailKeys) {
    const v = process.env[k] ?? "";
    if (v !== v.trim()) console.log(`Inbox: ${k} has spaces at the start or end.`);
    if (!v) console.log(`Inbox: ${k} is empty.`);
  }
}

const PORT = Number(process.env.PORT || 8787);
const DB_PATH = resolve(process.env.DATABASE_PATH || "./data/portfolio.db");
const DIST = resolve(process.env.STATIC_DIR || "./dist");

// ── Database ───────────────────────────────────────────────────────

mkdirSync(dirname(DB_PATH), { recursive: true });
const sqlite = new DatabaseSync(DB_PATH);
sqlite.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
sqlite.exec(schema);
// Columns added after a database was first created: add them if missing.
for (const ddl of [
  "ALTER TABLE properties ADD COLUMN section TEXT NOT NULL DEFAULT 'owned'",
  "ALTER TABLE properties ADD COLUMN tenure TEXT",
  "ALTER TABLE invoices ADD COLUMN sent_from TEXT",
  "ALTER TABLE properties ADD COLUMN ground_rent_paid REAL NOT NULL DEFAULT 0",
  "ALTER TABLE properties ADD COLUMN service_charge_paid REAL NOT NULL DEFAULT 0",
  "ALTER TABLE properties ADD COLUMN ground_rent_received REAL NOT NULL DEFAULT 0",
  "ALTER TABLE properties ADD COLUMN service_charge_received REAL NOT NULL DEFAULT 0",
]) {
  try { sqlite.exec(ddl); } catch { /* already there */ }
}

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
  RESEND_API_KEY: process.env.RESEND_API_KEY,
  INVOICE_FROM_EMAIL: process.env.INVOICE_FROM_EMAIL,
  ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
  ASSISTANT_MODEL: process.env.ASSISTANT_MODEL,
  SHEET_SCRIPT_URL: process.env.SHEET_SCRIPT_URL,
  SHEET_SCRIPT_KEY: process.env.SHEET_SCRIPT_KEY,
  SHEET_PUB_URL: process.env.SHEET_PUB_URL,
  SHEET_PROPERTIES_GID: process.env.SHEET_PROPERTIES_GID,
  SHEET_RENT_TO_RENT_GID: process.env.SHEET_RENT_TO_RENT_GID,
  SHEET_TENANTS_GID: process.env.SHEET_TENANTS_GID,
  SHEET_COMPLIANCE_GID: process.env.SHEET_COMPLIANCE_GID,
  SHEET_SALES_GID: process.env.SHEET_SALES_GID,
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

// ── Seed on start ──────────────────────────────────────────────────
// On hosts without a persistent disk (Render's free plan) the database file is
// lost whenever the instance restarts or sleeps. If SEED_FILE points at an
// import payload (e.g. a Render secret file) and the database is empty, load
// it on boot so the portfolio is always there. Edits made in the app since the
// last restart are still lost on such hosts — use a disk to keep them.

async function seedIfEmpty() {
  const file = process.env.SEED_FILE;
  if (!file) return;
  let payload: string;
  try {
    payload = readFileSync(file, "utf8");
  } catch {
    console.log(`No seed file at ${file}; starting with the existing database.`);
    return;
  }
  const row = sqlite.prepare("SELECT COUNT(*) AS n FROM properties").get() as { n: number };
  if (Number(row.n) > 0) return;
  const res = await app.fetch(
    new Request("http://localhost/api/import", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: payload,
    }),
    { ...env, ALLOW_NO_AUTH: "true" },
  );
  console.log(`Seeded database from ${file}: ${res.status} ${await res.text()}`);
}

function listen() {
  createServer((req, res) => {
    handle(req, res).catch((err) => {
      console.error(err);
      res.statusCode = 500;
      res.end("Internal error");
    });
  }).listen(PORT, () => {
    console.log(`Portfolio app listening on :${PORT} (database: ${DB_PATH})`);
  });
}

// With a Google Sheet linked, read it on start and then every SYNC_MINUTES.
const SYNC_MINUTES = Math.max(1, Number(process.env.SYNC_MINUTES || 5));

async function syncOnce(when: string) {
  try {
    const s = await runSync(env);
    console.log(`Sheet sync (${when}): ${s.properties} properties, ${s.rooms} rooms, ${s.leads} leads`);
  } catch (err) {
    console.error(`Sheet sync (${when}) failed: ${(err as Error).message}`);
  }
}

async function start() {
  if (syncEnabled(env)) {
    await syncOnce("start");
    setInterval(() => syncOnce("scheduled"), SYNC_MINUTES * 60_000).unref();
  } else {
    await seedIfEmpty().catch((err) => console.error("Seeding failed", err));
  }
  listen();
}

start();
