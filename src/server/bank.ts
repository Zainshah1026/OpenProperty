// Bank connection (open banking, read-only) through TrueLayer Data API v1.
//
// Setup: create an app in the TrueLayer Console, register the redirect URI
// <PUBLIC_URL>/bank, then set TRUELAYER_CLIENT_ID, TRUELAYER_CLIENT_SECRET
// and TRUELAYER_ENV (sandbox | live, default sandbox). Optional:
// TRUELAYER_USER_NAME / TRUELAYER_USER_EMAIL (who the connection is for).
//
// What it does
//   - Connect: a signed-in person is sent to TrueLayer's hosted page, picks
//     their bank and approves read-only access at the bank itself. Nobody here
//     ever sees bank logins. The tokens TrueLayer returns stay on the server.
//   - Sync: every 6 hours (TrueLayer allows 4 unattended calls a day) and on
//     demand, new transactions are stored in bank_transactions.
//   - Match: money in is matched to the rent each home or room expects, money
//     out to mortgages and other payments, by amount, name and date. Matching
//     only records what was paid; it never changes a property. If a home was
//     in arrears, a payment queues an approval to mark it up to date.
//   - Alert: rent or a mortgage that hasn't shown up a few days after it was
//     due (JARVIS_RENT_GRACE_DAYS, default 3) sends one notification.

import type { Hono } from "hono";
import { get, query, run } from "./db";
import { getUser } from "./auth";
import { propose, pushToAll } from "./jarvis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;
type Env = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const live = (env: Env) => str(env.TRUELAYER_ENV).toLowerCase() === "live";
const authHost = (env: Env) => (live(env) ? "https://auth.truelayer.com" : "https://auth.truelayer-sandbox.com");
const apiHost = (env: Env) => (live(env) ? "https://api.truelayer.com" : "https://api.truelayer-sandbox.com");
const configured = (env: Env) => !!(str(env.TRUELAYER_CLIENT_ID) && str(env.TRUELAYER_CLIENT_SECRET));
const publicBase = (env: Env) => (str(env.PUBLIC_URL) || str(env.RENDER_EXTERNAL_URL)).replace(/\/+$/, "");
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

// ── TrueLayer API (Data v1: auth link → code → tokens) ───────────────

const SCOPES = "info accounts balance transactions offline_access";

interface ConnectionRow {
  id: number; connection_id: string; status: string; accounts: string | null; last_sync_at: string | null; synced_until: string | null;
  error: string | null; created_by: string | null; created_at: string;
  access_token: string | null; refresh_token: string | null; token_expires_at: number | null;
}

class TlError extends Error { constructor(msg: string, public status = 0, public code = "") { super(msg); } }

async function tokenRequest(env: Env, fields: Record<string, string>) {
  const res = await fetch(`${authHost(env)}/connect/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: str(env.TRUELAYER_CLIENT_ID), client_secret: str(env.TRUELAYER_CLIENT_SECRET), ...fields }).toString(),
  });
  const json = (await res.json().catch(() => ({}))) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
  if (!res.ok || !json.access_token) throw new TlError(`TrueLayer sign-in failed (${res.status}): ${json.error_description ?? json.error ?? "no token"}`, res.status, json.error ?? "");
  return json;
}

async function saveTokens(id: number, t: { access_token?: string; refresh_token?: string; expires_in?: number }, keepRefresh: string | null) {
  await run("UPDATE bank_connections SET access_token = ?, refresh_token = ?, token_expires_at = ? WHERE id = ?", [
    t.access_token ?? null, t.refresh_token ?? keepRefresh, Date.now() + Math.max(60, (t.expires_in ?? 3600) - 120) * 1000, id,
  ]);
}

async function accessToken(env: Env, c: ConnectionRow) {
  if (c.access_token && c.token_expires_at && Date.now() < c.token_expires_at) return c.access_token;
  if (!c.refresh_token) throw new TlError("The bank connection has no refresh token: connect again.", 401, "invalid_grant");
  const t = await tokenRequest(env, { grant_type: "refresh_token", refresh_token: c.refresh_token });
  await saveTokens(c.id, t, c.refresh_token);
  c.access_token = t.access_token!;
  c.refresh_token = t.refresh_token ?? c.refresh_token;
  c.token_expires_at = Date.now() + ((t.expires_in ?? 3600) - 120) * 1000;
  return c.access_token;
}

async function tl<T>(env: Env, c: ConnectionRow, path: string, userIp?: string): Promise<T> {
  const headers: Record<string, string> = { Authorization: `Bearer ${await accessToken(env, c)}` };
  if (userIp) headers["X-PSU-IP"] = userIp;
  const res = await fetch(`${apiHost(env)}/data/v1${path}`, { headers });
  const json = (await res.json().catch(() => ({}))) as { error?: string; error_description?: string; results?: unknown };
  if (!res.ok) throw new TlError(`TrueLayer ${res.status}: ${json.error_description ?? json.error ?? "request failed"}`, res.status, json.error ?? "");
  return json as T;
}

interface TlAccount {
  id: string;
  type: string;
  currency: string;
  account_type?: string;
  account_identifiers?: { type: string; sort_code?: string; account_number?: string; iban?: string }[];
  account_holder_names?: string[];
}
interface TlTx { id: string; timestamp: string; description: string; currency: string; amount_in_minor: number; status: string; transaction_type?: string }

interface V1Account { account_id: string; account_type?: string; display_name?: string; currency?: string; account_number?: { iban?: string; number?: string; sort_code?: string } }
interface V1Tx { transaction_id: string; normalised_provider_transaction_id?: string; timestamp: string; description?: string; merchant_name?: string; amount: number; currency?: string; transaction_type?: string }

async function fetchAccounts(env: Env, c: ConnectionRow, userIp?: string): Promise<TlAccount[]> {
  const r = await tl<{ results?: V1Account[] }>(env, c, "/accounts", userIp);
  return (r.results ?? []).map((a) => ({
    id: a.account_id,
    type: "account",
    currency: a.currency ?? "GBP",
    account_type: (a.account_type ?? "").toLowerCase().replace(/_/g, " "),
    account_identifiers: [
      ...(a.account_number?.number ? [{ type: "sort_code_account_number", sort_code: a.account_number.sort_code, account_number: a.account_number.number }] : []),
      ...(a.account_number?.iban ? [{ type: "iban", iban: a.account_number.iban }] : []),
    ],
    account_holder_names: a.display_name ? [a.display_name] : [],
  }));
}

async function fetchTransactions(env: Env, c: ConnectionRow, accountId: string, from: string, to: string, userIp?: string): Promise<TlTx[]> {
  const q = new URLSearchParams({ from: `${from}T00:00:00Z`, to: `${to}T23:59:59Z` });
  const r = await tl<{ results?: V1Tx[] }>(env, c, `/accounts/${encodeURIComponent(accountId)}/transactions?${q}`, userIp);
  return (r.results ?? []).map((t) => {
    const pounds = Math.abs(t.amount) * (t.transaction_type === "DEBIT" ? -1 : t.transaction_type === "CREDIT" ? 1 : Math.sign(t.amount) || 1);
    return {
      id: t.normalised_provider_transaction_id || t.transaction_id,
      timestamp: t.timestamp,
      description: [t.description, t.merchant_name && !t.description?.includes(t.merchant_name) ? t.merchant_name : ""].filter(Boolean).join(" · "),
      currency: t.currency ?? "GBP",
      amount_in_minor: Math.round(pounds * 100),
      status: "settled",
      transaction_type: t.transaction_type,
    };
  });
}

// ── Matching ─────────────────────────────────────────────────────────

export interface Expected {
  key: string;            // stable per home/room/mortgage
  kind: "in" | "out";
  property_id: number | null;
  ref: string | null;
  label: string;          // "12 High St · Room 1 · J Smith"
  names: string[];        // words to look for in the bank description
  amount: number;         // pounds, positive
  date: string;           // due date YYYY-MM-DD
}

const words = (s: string) => s.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !["the", "and", "ltd", "rent", "room", "flat", "mrs", "miss"].includes(w));
const days = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);

/** The best expected payment for a transaction, or null. `taken` holds keys+month already matched. */
export function matchTransaction(tx: { amount: number; description: string; date: string }, expected: Expected[], taken: Set<string>) {
  const kind = tx.amount > 0 ? "in" : "out";
  const amount = Math.abs(tx.amount);
  const desc = tx.description.toLowerCase();
  let best: { e: Expected; score: number } | null = null;
  let tie = false;
  for (const e of expected) {
    if (e.kind !== kind || taken.has(`${e.key}@${e.date.slice(0, 7)}`)) continue;
    if (Math.abs(e.amount - amount) > Math.max(1, e.amount * 0.005)) continue;
    const gap = Math.abs(days(tx.date, e.date));
    if (gap > 12) continue;
    let score = gap <= 4 ? 2 : 1;
    if (e.names.some((n) => desc.includes(n))) score += 3;
    if (e.ref && new RegExp(`\\bref\\s*${e.ref.replace(/[^a-z0-9]/gi, "")}\\b`, "i").test(tx.description)) score += 3;
    if (!best || score > best.score) { best = { e, score }; tie = false; }
    else if (score === best.score) tie = true;
  }
  // Two equally good candidates (same rent, no name in the reference): don't guess.
  return best && !tie ? best.e : null;
}

const iso = (d: Date) => d.toISOString().slice(0, 10);

/** What the portfolio expects in and out for the months covering [from, to]. */
async function expectations(app: AnyApp, env: Env, from: string, to: string): Promise<Expected[]> {
  const months = new Set<string>();
  for (let t = Date.parse(`${from.slice(0, 7)}-01T12:00:00Z`); t <= Date.parse(`${to}T12:00:00Z`); ) {
    const d = new Date(t);
    months.add(iso(d).slice(0, 7));
    t = Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1, 12);
  }
  const mortgages = await query<{ id: number; property_id: number | null; lender: string; monthly_payment: number | null; payment_day: number | null; ref: string | null; name: string | null }>(
    `SELECT m.id, m.property_id, m.lender, m.monthly_payment, m.payment_day, p.ref, p.name
     FROM mortgages m LEFT JOIN properties p ON p.id = m.property_id
     WHERE COALESCE(m.status, 'active') = 'active' AND m.payment_day IS NOT NULL AND m.monthly_payment > 0`,
  ).catch(() => []);
  const covered = new Set(mortgages.map((m) => m.property_id).filter((x): x is number => x != null));
  const out: Expected[] = [];
  for (const month of months) {
    const res = await app.fetch(new Request(`http://internal/api/calendar?month=${month}`), { ...env, ALLOW_NO_AUTH: "true" });
    const cal = (await res.json()) as { days_in_month: number; events: { date: string; kind: string; amount?: number; title: string; detail: string; property_id: number; ref: string | null }[] };
    for (const e of cal.events) {
      if ((e.kind !== "in" && e.kind !== "out") || !e.amount) continue;
      if (e.kind === "out" && e.detail === "Mortgage" && covered.has(e.property_id)) continue;
      out.push({
        key: `${e.kind}:${e.property_id}:${e.detail}`,
        kind: e.kind,
        property_id: e.property_id,
        ref: e.ref,
        label: [e.ref ? `Ref ${e.ref}` : "", e.title, e.detail].filter(Boolean).join(" · "),
        names: e.kind === "in" ? words(e.detail.split("·").pop() ?? "") : [],
        amount: e.amount,
        date: e.date,
      });
    }
    for (const m of mortgages) {
      out.push({
        key: `mortgage:${m.id}`,
        kind: "out",
        property_id: m.property_id,
        ref: m.ref,
        label: [m.ref ? `Ref ${m.ref}` : "", m.name ?? "", `Mortgage (${m.lender})`].filter(Boolean).join(" · "),
        names: words(m.lender),
        amount: m.monthly_payment!,
        date: `${month}-${String(Math.min(m.payment_day!, cal.days_in_month)).padStart(2, "0")}`,
      });
    }
  }
  return out.filter((e) => e.date >= from && e.date <= to);
}

// ── Sync ─────────────────────────────────────────────────────────────

let syncing = false;

export async function syncBank(app: AnyApp, env: Env, opts: { userIp?: string; refreshAccounts?: boolean } = {}) {
  if (!configured(env)) return { skipped: "not set up" };
  if (syncing) return { skipped: "already syncing" };
  syncing = true;
  const summary = { connections: 0, accounts: 0, new_transactions: 0, matched: 0, errors: [] as string[] };
  try {
    const conns = await query<ConnectionRow>("SELECT * FROM bank_connections WHERE status = 'active'");
    const today = iso(new Date());
    for (const c of conns) {
      try {
        let accounts: TlAccount[] = c.accounts ? JSON.parse(c.accounts) : [];
        if (!accounts.length || opts.refreshAccounts || c.status !== "active") {
          accounts = await fetchAccounts(env, c, opts.userIp);
          await run("UPDATE bank_connections SET status = 'active', accounts = ?, error = NULL WHERE id = ?", [JSON.stringify(accounts), c.id]);
        }
        summary.connections++;
        const from = c.synced_until ? iso(new Date(Date.parse(`${c.synced_until}T12:00:00Z`) - 10 * 86_400_000)) : iso(new Date(Date.now() - 90 * 86_400_000));
        for (const a of accounts) {
          summary.accounts++;
          const txs = await fetchTransactions(env, c, a.id, from, today, opts.userIp);
          for (const t of txs) {
            const r = await run(
              `INSERT INTO bank_transactions (id, connection_id, account_id, date, timestamp, description, amount, currency, status, transaction_type)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
               ON CONFLICT(id) DO UPDATE SET status = excluded.status, description = excluded.description`,
              [t.id, c.connection_id, a.id, t.timestamp.slice(0, 10), t.timestamp, t.description ?? "", (t.amount_in_minor ?? 0) / 100, t.currency, t.status, t.transaction_type ?? null],
            );
            if (r.changes) summary.new_transactions++;
          }
        }
        await run("UPDATE bank_connections SET last_sync_at = datetime('now'), synced_until = ?, error = NULL WHERE id = ?", [today, c.id]);
      } catch (err) {
        const e = err as Error & { status?: number };
        const msg = e.message;
        summary.errors.push(msg);
        // Consent expired or revoked: say so once, and stop trying.
        const gone = (e as TlError).code === "invalid_grant" || e.status === 401 || e.status === 403 || /expired|revoked|consent/i.test(msg);
        await run("UPDATE bank_connections SET error = ?, status = CASE WHEN ? THEN 'expired' ELSE status END WHERE id = ?", [msg.slice(0, 500), gone ? 1 : 0, c.id]);
        if (gone && c.status === "active") {
          await pushToAll(env, { title: "Jarvis: bank connection needs renewing", body: "Your bank access has expired. Open Bank in the app and tap Reconnect.", url: "/bank", tag: "bank-expired" }).catch(() => {});
        }
      }
    }
    if (summary.connections) summary.matched = await matchAndAlert(app, env);
  } finally {
    syncing = false;
  }
  return summary;
}

async function matchAndAlert(app: AnyApp, env: Env) {
  const today = iso(new Date());
  const windowStart = iso(new Date(Date.now() - 45 * 86_400_000));
  const firstSeen = (await get<{ d: string | null }>("SELECT MIN(date) AS d FROM bank_transactions"))?.d;
  if (!firstSeen) return 0;
  const from = windowStart > firstSeen ? windowStart : firstSeen;
  const expected = await expectations(app, env, from, iso(new Date(Date.now() + 10 * 86_400_000)));
  const already = await query<{ match_key: string; match_month: string }>("SELECT match_key, match_month FROM bank_transactions WHERE match_key IS NOT NULL");
  const taken = new Set(already.map((r) => `${r.match_key}@${r.match_month}`));
  const fresh = await query<{ id: string; date: string; description: string; amount: number }>(
    "SELECT id, date, description, amount FROM bank_transactions WHERE match_key IS NULL AND matched_at IS NULL AND date >= ? ORDER BY date",
    [from],
  );
  const received: string[] = [];
  let matched = 0;
  for (const t of fresh) {
    const e = matchTransaction(t, expected, taken);
    await run("UPDATE bank_transactions SET matched_at = datetime('now'), match_key = ?, match_month = ?, match_label = ? WHERE id = ?", [
      e?.key ?? null, e ? e.date.slice(0, 7) : null, e?.label ?? null, t.id,
    ]);
    if (!e) continue;
    matched++;
    taken.add(`${e.key}@${e.date.slice(0, 7)}`);
    if (e.kind === "in") {
      received.push(`${e.ref ? `Ref ${e.ref}` : e.label} ${gbp(t.amount)}`);
      // Paying off arrears is the only time a property's record should change, and only with a yes.
      const p = e.property_id ? await get<{ ref: string | null; rent_status: string | null }>("SELECT ref, rent_status FROM properties WHERE id = ?", [e.property_id]) : undefined;
      if (p?.ref && (p.rent_status === "in_arrears" || p.rent_status === "missed")) {
        await propose(env, {
          tool: "update_rent_status",
          input: { property_ref: p.ref, rent_status: "on_time" },
          summary: `${gbp(t.amount)} rent arrived for ref ${p.ref}, which is marked as behind. Mark it up to date?`,
          details: `Bank: "${t.description}" on ${t.date}. Matched to ${e.label}.`,
          source: "bank",
          dedupe_key: `bank:${t.id}`,
        }).catch((err) => console.error(`Bank approval: ${(err as Error).message}`));
      }
    }
  }
  if (received.length) {
    const shown = received.slice(0, 5).join(", ") + (received.length > 5 ? ` +${received.length - 5} more` : "");
    await pushToAll(env, { title: `Jarvis: rent received (${received.length})`, body: shown, url: "/bank", tag: `bank-in-${today}` }).catch(() => {});
  }

  // Due a few days ago and still nothing: one alert each.
  const grace = Math.max(0, Number(str(env.JARVIS_RENT_GRACE_DAYS) || "3"));
  const late = expected.filter((e) => e.date >= firstSeen && days(today, e.date) >= grace && days(today, e.date) <= 31 && !taken.has(`${e.key}@${e.date.slice(0, 7)}`));
  const fresh_late: Expected[] = [];
  for (const e of late) {
    const k = `bank_late:${e.key}@${e.date}`;
    if (await get("SELECT 1 FROM settings WHERE key = ?", [k])) continue;
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [k, today]);
    fresh_late.push(e);
  }
  const lateIn = fresh_late.filter((e) => e.kind === "in");
  const lateOut = fresh_late.filter((e) => e.kind === "out");
  const list = (xs: Expected[]) => xs.slice(0, 5).map((e) => `${e.ref ? `Ref ${e.ref}` : e.label} ${gbp(e.amount)} (due ${e.date.slice(8)}/${e.date.slice(5, 7)})`).join(", ") + (xs.length > 5 ? ` +${xs.length - 5} more` : "");
  if (lateIn.length) await pushToAll(env, { title: `Jarvis: rent not received (${lateIn.length})`, body: list(lateIn), url: "/bank", tag: `bank-late-in-${today}`, urgent: true }).catch(() => {});
  if (lateOut.length) await pushToAll(env, { title: `Jarvis: payments not seen going out (${lateOut.length})`, body: list(lateOut), url: "/bank", tag: `bank-late-out-${today}` }).catch(() => {});
  return matched;
}

// ── Routes ───────────────────────────────────────────────────────────

const clientIp = (h: (n: string) => string | undefined) => (h("x-forwarded-for") ?? "").split(",")[0].trim() || undefined;

export function registerBankRoutes(app: AnyApp) {
  app.get("/api/bank", async (c) => {
    const env = c.env as Env;
    const conns = await query<ConnectionRow>("SELECT * FROM bank_connections ORDER BY id DESC").catch(() => []);
    const txs = await query("SELECT id, date, description, amount, currency, status, match_label FROM bank_transactions ORDER BY date DESC, timestamp DESC LIMIT 200").catch(() => []);
    const month = iso(new Date()).slice(0, 7);
    const totals = await get<{ inn: number | null; outt: number | null; matched: number | null }>(
      "SELECT SUM(CASE WHEN amount > 0 THEN amount END) AS inn, SUM(CASE WHEN amount < 0 THEN -amount END) AS outt, SUM(CASE WHEN match_key IS NOT NULL THEN 1 ELSE 0 END) AS matched FROM bank_transactions WHERE date LIKE ?",
      [`${month}%`],
    ).catch(() => undefined);
    return c.json({
      configured: configured(env),
      mode: live(env) ? "live" : "sandbox",
      redirect_uri: `${publicBase(env)}/bank`,
      connections: conns
        .filter((r) => r.status !== "failed" && r.status !== "removed")
        .map(({ access_token: _a, refresh_token: _r, token_expires_at: _t, ...r }) => ({ ...r, accounts: r.accounts ? JSON.parse(r.accounts) : [] })),
      transactions: txs,
      month: { in: totals?.inn ?? 0, out: totals?.outt ?? 0, matched: totals?.matched ?? 0 },
    });
  });

  app.post("/api/bank/connect", async (c) => {
    const env = c.env as Env;
    if (!configured(env)) return c.json({ error: "Bank connection isn't set up yet: add TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET in Render." }, 400);
    const state = Array.from(crypto.getRandomValues(new Uint8Array(18)), (b) => b.toString(16).padStart(2, "0")).join("");
    await run("INSERT INTO bank_connections (connection_id, status, created_by) VALUES (?, 'authorizing', ?)", [state, getUser(c)?.name ?? null]);
    const q = new URLSearchParams({
      response_type: "code",
      client_id: str(env.TRUELAYER_CLIENT_ID),
      scope: SCOPES,
      redirect_uri: `${publicBase(env)}/bank`,
      providers: live(env) ? "uk-ob-all uk-oauth-all" : "uk-cs-mock uk-ob-all uk-oauth-all",
      state,
    });
    return c.json({ url: `${authHost(env)}/?${q.toString().replace(/\+/g, "%20")}` });
  });

  // Back from the bank: swap the one-time code for tokens, then fetch accounts and transactions.
  app.post("/api/bank/callback", async (c) => {
    const env = c.env as Env;
    const body = (await c.req.json().catch(() => null)) as { code?: string; state?: string; error?: string } | null;
    const row = await get<ConnectionRow>("SELECT * FROM bank_connections WHERE connection_id = ? AND status = 'authorizing'", [str(body?.state)]);
    if (!row) return c.json({ error: "That bank link has expired or was already used. Tap Connect again." }, 400);
    if (body?.error || !str(body?.code)) {
      await run("UPDATE bank_connections SET status = 'failed', error = ? WHERE id = ?", [str(body?.error) || "No code returned", row.id]);
      return c.json({ error: body?.error === "access_denied" ? "The bank connection was cancelled." : `The bank didn't connect (${str(body?.error) || "no code"}).` }, 400);
    }
    try {
      const t = await tokenRequest(env, { grant_type: "authorization_code", code: str(body!.code), redirect_uri: `${publicBase(env)}/bank` });
      await saveTokens(row.id, t, null);
      await run("UPDATE bank_connections SET status = 'active', error = NULL WHERE id = ?", [row.id]);
    } catch (err) {
      await run("UPDATE bank_connections SET status = 'failed', error = ? WHERE id = ?", [(err as Error).message.slice(0, 500), row.id]);
      return c.json({ error: (err as Error).message }, 502);
    }
    try {
      return c.json({ ok: true, ...(await syncBank(app, env, { userIp: clientIp((n) => c.req.header(n)), refreshAccounts: true })) });
    } catch (err) {
      return c.json({ ok: true, errors: [(err as Error).message] });
    }
  });

  app.post("/api/bank/sync", async (c) => {
    try {
      return c.json(await syncBank(app, c.env as Env, { userIp: clientIp((n) => c.req.header(n)), refreshAccounts: true }));
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
  });

  app.post("/api/bank/connections/:id/remove", async (c) => {
    // Stops using a connection here; the person can also revoke it at their bank.
    await run("UPDATE bank_connections SET status = 'removed' WHERE id = ?", [Number(c.req.param("id"))]);
    return c.json({ ok: true });
  });
}
