// Personal logins.
//
// Each person has their own username and password, a role (admin or member)
// and a list of mailboxes they may read in the Inbox. Company data
// (properties, invoices, …) is shared; mailboxes are not: nobody sees a
// mailbox that isn't on their list, admins included.
//
// Passwords are stored as PBKDF2-SHA256 hashes (WebCrypto, so this runs on
// Node and Cloudflare alike). Sessions are a signed cookie carrying the user
// id and a password version, so changing a password signs that person out
// everywhere. APP_PASSWORD signs the cookies.
//
// Setup login: APP_USERNAME / APP_PASSWORD signs in as a temporary admin
// ONLY while no admin account exists (or ALLOW_SETUP_LOGIN=true), so the
// first admin can be created. After that it stops working.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, initDB, query, run } from "./db";

export interface SessionUser {
  id: number; // 0 = setup login
  username: string;
  name: string;
  role: "admin" | "member";
  mailboxes: string[];
  setup: boolean;
}

interface UserRow {
  id: number;
  username: string;
  name: string;
  password_hash: string;
  role: "admin" | "member";
  mailboxes: string;
  pw_version: number;
  active: number;
  last_login: string | null;
  created_at: string;
}

export interface AuthEnv {
  APP_PASSWORD?: string;
  APP_USERNAME?: string;
  ALLOW_NO_AUTH?: string;
  ALLOW_SETUP_LOGIN?: string;
  DB?: D1Database;
}

export const SESSION_COOKIE = "pf_session";
const SESSION_DAYS = 30;
const ITERATIONS = 100_000;

// ── Helpers ────────────────────────────────────────────────────────

export function safeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder();
  const x = enc.encode(a);
  const y = enc.encode(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const b64 = (buf: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(buf instanceof Uint8Array ? buf : new Uint8Array(buf))));
const unb64 = (s: string) => Uint8Array.from(atob(s), (ch) => ch.charCodeAt(0));
const b64url = (buf: ArrayBuffer) => b64(buf).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

async function pbkdf2(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations }, key, 256);
  return new Uint8Array(bits);
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await pbkdf2(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, iter, salt, hash] = stored.split("$");
  if (scheme !== "pbkdf2" || !iter || !salt || !hash) return false;
  const got = await pbkdf2(password, unb64(salt), Number(iter));
  return safeEqual(b64(got), hash);
}

async function sign(secret: string, data: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(`portfolio-session:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}

/** Token: userId.pwVersion.expires.signature */
async function makeToken(secret: string, userId: number, pwVersion: number): Promise<string> {
  const exp = Date.now() + SESSION_DAYS * 86_400_000;
  const body = `${userId}.${pwVersion}.${exp}`;
  return `${body}.${await sign(secret, body)}`;
}

async function readToken(secret: string, token: string | undefined): Promise<{ userId: number; pwVersion: number } | null> {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 4) return null;
  const [uid, pv, exp, sig] = parts;
  if (Number(exp) < Date.now()) return null;
  if (!safeEqual(sig, await sign(secret, `${uid}.${pv}.${exp}`))) return null;
  return { userId: Number(uid), pwVersion: Number(pv) };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  for (const part of (header ?? "").split(";")) {
    const [k, ...v] = part.trim().split("=");
    if (k === name) return decodeURIComponent(v.join("="));
  }
  return undefined;
}

function cookie(c: Context, token: string | null) {
  const secure = new URL(c.req.url).protocol === "https:" || c.req.header("x-forwarded-proto") === "https";
  c.header(
    "Set-Cookie",
    token
      ? `${SESSION_COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}${secure ? "; Secure" : ""}`
      : `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
  );
}

const parseMailboxes = (raw: string): string[] => {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => String(x).toLowerCase()) : [];
  } catch {
    return [];
  }
};

const toSession = (u: UserRow): SessionUser => ({
  id: u.id,
  username: u.username,
  name: u.name,
  role: u.role,
  mailboxes: parseMailboxes(u.mailboxes),
  setup: false,
});

async function adminCount(): Promise<number> {
  const r = await get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE role = 'admin' AND active = 1").catch(() => ({ n: 0 }));
  return Number(r?.n ?? 0);
}

async function setupAllowed(env: AuthEnv): Promise<boolean> {
  if (!env.APP_PASSWORD) return false;
  if (env.ALLOW_SETUP_LOGIN === "true") return true;
  return (await adminCount()) === 0;
}

function setupUser(env: AuthEnv): SessionUser {
  return { id: 0, username: env.APP_USERNAME || "admin", name: "Setup login", role: "admin", mailboxes: [], setup: true };
}

/** Check a username and password. Returns the user, or null. */
async function checkLogin(env: AuthEnv, username: string, password: string): Promise<{ user: SessionUser; pwVersion: number } | null> {
  const row = await get<UserRow>("SELECT * FROM users WHERE username = ? COLLATE NOCASE AND active = 1", [username.trim()]).catch(() => undefined);
  if (row && (await verifyPassword(password, row.password_hash))) {
    await run("UPDATE users SET last_login = ? WHERE id = ?", [new Date().toISOString(), row.id]).catch(() => {});
    return { user: toSession(row), pwVersion: row.pw_version };
  }
  if (
    env.APP_PASSWORD &&
    safeEqual(username.trim().toLowerCase(), (env.APP_USERNAME || "admin").toLowerCase()) &&
    safeEqual(password, env.APP_PASSWORD) &&
    (await setupAllowed(env))
  ) {
    return { user: setupUser(env), pwVersion: 0 };
  }
  return null;
}

/** Who is signed in on this request, if anyone. */
export async function currentUser(c: Context): Promise<SessionUser | null> {
  const env = c.env as AuthEnv;
  if (!env.APP_PASSWORD) return null;
  const t = await readToken(env.APP_PASSWORD, readCookie(c.req.header("Cookie"), SESSION_COOKIE));
  if (t) {
    if (t.userId === 0) return (await setupAllowed(env)) ? setupUser(env) : null;
    const row = await get<UserRow>("SELECT * FROM users WHERE id = ? AND active = 1", [t.userId]).catch(() => undefined);
    if (row && row.pw_version === t.pwVersion) return toSession(row);
    return null;
  }
  // Username/password in the request itself is for scripts only. Browsers
  // remember Basic logins from the site's first version and keep sending
  // them, which would sign people straight back in after Sign out.
  const header = c.req.header("Authorization") ?? "";
  if (header.startsWith("Basic ") && c.req.header("X-Portfolio-Script") === "1") {
    try {
      const decoded = atob(header.slice(6));
      const sep = decoded.indexOf(":");
      if (sep > -1) return (await checkLogin(env, decoded.slice(0, sep), decoded.slice(sep + 1)))?.user ?? null;
    } catch {
      /* malformed */
    }
  }
  return null;
}

export const getUser = (c: Context): SessionUser => c.get("user" as never) as SessionUser;

// ── Sign-in page ───────────────────────────────────────────────────

export function loginPage(error = "", headExtra = ""): string {
  const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
  return `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow">
<title>Sign in · Chisti &amp; Co.</title>${headExtra}
<style>
  :root{color-scheme:light dark;--bg:#eef4f9;--card:#fff;--ink:#14212b;--muted:#5c6b77;--line:#d9e3ea;--brand:#0b7cc2;--err:#a1281f}
  @media (prefers-color-scheme:dark){:root{--bg:#0d1720;--card:#16222c;--ink:#eef3f7;--muted:#9aaab6;--line:#2a3945;--brand:#4aa8e6;--err:#ff8a80}}
  *{box-sizing:border-box}body{margin:0;min-height:100vh;display:grid;place-items:center;background:var(--bg);color:var(--ink);font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;padding:16px}
  .wrap{width:100%;max-width:380px}
  .logo{display:block;width:100%;border-radius:12px 12px 0 0;background:#0b7cc2}
  form{width:100%;background:var(--card);border:1px solid var(--line);border-top:0;border-radius:0 0 12px 12px;padding:24px 28px 28px}
  h1{font-size:20px;margin:0 0 4px}p{margin:0 0 20px;color:var(--muted);font-size:14px}
  label{display:block;font-size:13px;font-weight:600;margin:14px 0 6px}
  input{width:100%;padding:11px 12px;border:1px solid var(--line);border-radius:8px;background:transparent;color:inherit;font-size:16px}
  input:focus{outline:2px solid var(--brand);outline-offset:1px}
  button{margin-top:22px;width:100%;padding:12px;border:0;border-radius:8px;background:var(--brand);color:#fff;font-size:16px;font-weight:600;cursor:pointer}
  .err{color:var(--err);font-size:14px;margin:12px 0 0}
</style></head><body>
<div class="wrap"><img class="logo" src="/brand/chisti-logo.jpg" alt="Chisti &amp; Co., Ilford" width="380" height="236">
<form method="post" action="/login">
  <h1>Portfolio dashboard</h1><p>Sign in with your own username and password.</p>
  <label for="u">Username</label><input id="u" name="username" autocomplete="username" autocapitalize="none" required>
  <label for="p">Password</label><input id="p" name="password" type="password" autocomplete="current-password" required>
  ${error ? `<div class="err" role="alert">${esc(error)}</div>` : ""}
  <button type="submit">Sign in</button>
</form></div>
<script>if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});</script>
</body></html>`;
}

// ── Routes ─────────────────────────────────────────────────────────

const Username = z.string().trim().min(2).max(120);
const Password = z.string().min(8, "Passwords need at least 8 characters").max(200);
const Mailboxes = z.array(z.string().trim().toLowerCase().email()).max(10);

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerAuth(app: Hono<any>, opts: { headExtra: string; publicPaths: string[]; allMailboxes: () => string[] }) {
  app.post("/login", async (c) => {
    const env = c.env as AuthEnv;
    if (!env.APP_PASSWORD) return c.text("Login is not set up yet: add an APP_PASSWORD setting.", 503);
    initDB(env);
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const result = await checkLogin(env, String(form.username ?? ""), String(form.password ?? ""));
    if (!result) {
      // Why it failed, without ever logging a password.
      const tried = String(form.username ?? "").trim();
      const known = await get<{ id: number; active: number }>("SELECT id, active FROM users WHERE username = ? COLLATE NOCASE", [tried]).catch(() => undefined);
      console.log(
        `Login failed for "${tried.slice(0, 80)}": ${known ? (known.active ? "account exists, wrong password" : "account is disabled") : "no account with that username"}` +
          `; setup login ${(await setupAllowed(env)) ? "on" : "off"}` +
          (tried.toLowerCase() === (env.APP_USERNAME || "admin").toLowerCase() ? " (setup username matched, so the setup password was wrong)" : ""),
      );
      await new Promise((r) => setTimeout(r, 1000)); // slow down guessing
      return c.html(loginPage("That username and password don't match.", opts.headExtra), 401);
    }
    cookie(c, await makeToken(env.APP_PASSWORD, result.user.id, result.pwVersion));
    return c.redirect(result.user.setup ? "/settings#users" : "/", 303);
  });

  app.get("/logout", (c) => {
    cookie(c, null);
    return c.redirect("/", 303);
  });

  // Every other request needs a signed-in user.
  app.use("*", async (c, next) => {
    // /r/<token> is the tenant repair form: it can only create a work order for that one home.
    if (opts.publicPaths.includes(c.req.path) || c.req.path.startsWith("/brand/") || /^\/r\/[A-Za-z0-9_-]{8,}$/.test(c.req.path)) return next();
    const env = c.env as AuthEnv;
    if (env.ALLOW_NO_AUTH === "true") {
      c.set("user" as never, { id: 0, username: "local", name: "Local", role: "admin", mailboxes: opts.allMailboxes(), setup: false } as never);
      return next();
    }
    if (!env.APP_PASSWORD) return c.text("Login is not set up yet: add an APP_PASSWORD setting.", 503);
    initDB(env);
    const user = await currentUser(c);
    if (user) {
      c.set("user" as never, user as never);
      return next();
    }
    if (c.req.path.startsWith("/api/")) return c.json({ error: "Signed out. Reload the page to sign in." }, 401);
    return c.html(loginPage("", opts.headExtra), 401);
  });

  app.get("/api/me", (c) => {
    const u = getUser(c);
    return c.json({ user: u });
  });

  app.post("/api/me/password", async (c) => {
    const u = getUser(c);
    if (u.setup || u.id === 0) return c.json({ error: "The setup login has no password to change. Create your own account under Users." }, 400);
    const body = z.object({ current: z.string(), next: Password }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: body.error.issues[0]?.message ?? "Invalid" }, 400);
    const row = await get<UserRow>("SELECT * FROM users WHERE id = ?", [u.id]);
    if (!row || !(await verifyPassword(body.data.current, row.password_hash))) return c.json({ error: "Your current password isn't right." }, 400);
    const pv = row.pw_version + 1;
    await run("UPDATE users SET password_hash = ?, pw_version = ? WHERE id = ?", [await hashPassword(body.data.next), pv, u.id]);
    cookie(c, await makeToken((c.env as AuthEnv).APP_PASSWORD!, u.id, pv)); // stay signed in here; other devices sign out
    return c.json({ ok: true });
  });

  // ── Admin: manage people ─────────────────────────────────────────

  const adminOnly = (c: Context) => (getUser(c).role === "admin" ? null : c.json({ error: "Only admins can manage users." }, 403));

  const publicRow = (u: UserRow) => ({
    id: u.id, username: u.username, name: u.name, role: u.role, mailboxes: parseMailboxes(u.mailboxes),
    active: !!u.active, last_login: u.last_login, created_at: u.created_at,
  });

  app.get("/api/users", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const rows = await query<UserRow>("SELECT * FROM users ORDER BY name COLLATE NOCASE");
    return c.json({ users: rows.map(publicRow), mailboxes: opts.allMailboxes() });
  });

  const NewUser = z.object({
    username: Username,
    name: z.string().trim().min(1).max(80),
    password: Password,
    role: z.enum(["admin", "member"]).default("member"),
    mailboxes: Mailboxes.default([]),
  });

  app.post("/api/users", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const parsed = NewUser.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
    const d = parsed.data;
    const clash = await get("SELECT id FROM users WHERE username = ? COLLATE NOCASE", [d.username]);
    if (clash) return c.json({ error: "That username is already taken." }, 400);
    const r = await run(
      "INSERT INTO users (username, name, password_hash, role, mailboxes) VALUES (?, ?, ?, ?, ?)",
      [d.username, d.name, await hashPassword(d.password), d.role, JSON.stringify(d.mailboxes)],
    );
    const row = await get<UserRow>("SELECT * FROM users WHERE id = ?", [r.lastInsertRowid]);
    return c.json({ user: publicRow(row!) }, 201);
  });

  const UserPatch = z.object({
    name: z.string().trim().min(1).max(80).optional(),
    role: z.enum(["admin", "member"]).optional(),
    mailboxes: Mailboxes.optional(),
    active: z.boolean().optional(),
    password: Password.optional(), // admin reset
  });

  app.put("/api/users/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    const parsed = UserPatch.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => i.message).join("; ") }, 400);
    const d = parsed.data;
    const row = await get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    const losingAdmin = row.role === "admin" && row.active && ((d.role && d.role !== "admin") || d.active === false);
    if (losingAdmin && (await adminCount()) <= 1) return c.json({ error: "Keep at least one active admin." }, 400);
    const sets: string[] = [];
    const params: unknown[] = [];
    if (d.name !== undefined) { sets.push("name = ?"); params.push(d.name); }
    if (d.role !== undefined) { sets.push("role = ?"); params.push(d.role); }
    if (d.mailboxes !== undefined) { sets.push("mailboxes = ?"); params.push(JSON.stringify(d.mailboxes)); }
    if (d.active !== undefined) { sets.push("active = ?", "pw_version = pw_version + 1"); params.push(d.active ? 1 : 0); }
    if (d.password !== undefined) { sets.push("password_hash = ?", "pw_version = pw_version + 1"); params.push(await hashPassword(d.password)); }
    if (!sets.length) return c.json({ error: "No changes" }, 400);
    params.push(id);
    await run(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, params);
    return c.json({ user: publicRow((await get<UserRow>("SELECT * FROM users WHERE id = ?", [id]))!) });
  });

  app.delete("/api/users/:id", async (c) => {
    const denied = adminOnly(c);
    if (denied) return denied;
    const id = Number(c.req.param("id"));
    if (id === getUser(c).id) return c.json({ error: "You can't delete your own account." }, 400);
    const row = await get<UserRow>("SELECT * FROM users WHERE id = ?", [id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    if (row.role === "admin" && row.active && (await adminCount()) <= 1) return c.json({ error: "Keep at least one active admin." }, 400);
    await run("DELETE FROM users WHERE id = ?", [id]);
    return c.json({ ok: true });
  });
}
