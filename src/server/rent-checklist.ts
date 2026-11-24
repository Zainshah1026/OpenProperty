// Rent tick-off list: every rent the portfolio expects each month (whole
// homes, or room by room in shared houses), ticked off by hand when it
// arrives. Rent still not ticked a few days after it was due sends one
// notification (JARVIS_RENT_GRACE_DAYS, default 3; off with
// JARVIS_RENT_ALERTS=off).

import type { Hono } from "hono";
import { get, query, run } from "./db";
import { getUser } from "./auth";
import { pushToAll } from "./jarvis";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;
type Env = Record<string, unknown>;

const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;

export interface RentItem {
  key: string;
  property_id: number;
  ref: string | null;
  home: string;
  who: string;            // room and tenant, or the tenant/agent label
  amount: number;
  due_date: string | null;
  paid: boolean;
  paid_amount: number | null;
  paid_on: string | null;
  ticked_by: string | null;
}

function londonToday() {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit", hour: "numeric", hourCycle: "h23" })
      .formatToParts(new Date()).map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, month: `${p.year}-${p.month}`, hour: Number(p.hour) };
}

const roomKey = (pid: number, room: string | null, i: number) => `room:${pid}:${(room || `#${i + 1}`).trim().toLowerCase()}`;

export async function rentChecklist(month: string): Promise<RentItem[]> {
  const [y, m] = month.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const due = (d: number | null) => (d ? `${month}-${String(Math.min(d, dim)).padStart(2, "0")}` : null);
  type P = { id: number; ref: string | null; name: string; occupancy: string; rent_in: number; rent_in_day: number | null; tenant_label: string | null };
  type R = { property_id: number; room: string | null; tenant_name: string | null; rent: number; pay_day: number | null; rent_status: string | null };
  const props = await query<P>("SELECT id, ref, name, occupancy, rent_in, rent_in_day, tenant_label FROM properties");
  const rooms = await query<R>("SELECT property_id, room, tenant_name, rent, pay_day, rent_status FROM rooms ORDER BY sort, id");
  const ticks = await query<{ key: string; amount: number | null; paid_on: string | null; ticked_by: string | null }>("SELECT key, amount, paid_on, ticked_by FROM rent_ticks WHERE month = ?", [month]);
  const tick = new Map(ticks.map((t) => [t.key, t]));
  const out: RentItem[] = [];
  const add = (it: Omit<RentItem, "paid" | "paid_amount" | "paid_on" | "ticked_by">) => {
    const t = tick.get(it.key);
    out.push({ ...it, paid: !!t, paid_amount: t?.amount ?? null, paid_on: t?.paid_on ?? null, ticked_by: t?.ticked_by ?? null });
  };
  for (const p of props) {
    const paying = rooms.filter((r) => r.property_id === p.id).map((r, i) => ({ r, i })).filter(({ r }) => r.rent > 0 && r.rent_status !== "empty");
    if (paying.length) {
      for (const { r, i } of paying) {
        add({ key: roomKey(p.id, r.room, i), property_id: p.id, ref: p.ref, home: p.name, who: [r.room, r.tenant_name].filter(Boolean).join(" · ") || "Room", amount: r.rent, due_date: due(r.pay_day ?? p.rent_in_day) });
      }
    } else if (p.rent_in > 0 && p.occupancy !== "vacant") {
      add({ key: `home:${p.id}`, property_id: p.id, ref: p.ref, home: p.name, who: p.tenant_label || "Rent", amount: p.rent_in, due_date: due(p.rent_in_day) });
    }
  }
  return out.sort((a, b) => (a.due_date ?? "9999").localeCompare(b.due_date ?? "9999") || a.home.localeCompare(b.home));
}


/** Tick a rent off as received (or untick it). */
async function setRentTick(month: string, key: string, paid: boolean, by: string | null, amount?: number | null, paidOn?: string | null) {
  if (!paid) {
    await run("DELETE FROM rent_ticks WHERE month = ? AND key = ?", [month, key]);
    return;
  }
  const on = paidOn && /^\d{4}-\d{2}-\d{2}$/.test(paidOn) ? paidOn : londonToday().date;
  const amt = typeof amount === "number" && amount >= 0 ? amount : null;
  await run(
    `INSERT INTO rent_ticks (month, key, amount, paid_on, ticked_by) VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(month, key) DO UPDATE SET amount = excluded.amount, paid_on = excluded.paid_on, ticked_by = excluded.ticked_by, ticked_at = datetime('now')`,
    [month, key, amt, on, by],
  );
}

async function ticksSince(today: string) {
  let since = (await get<{ value: string }>("SELECT value FROM settings WHERE key = 'rent_ticks_since'"))?.value;
  if (!since) {
    since = today;
    await run("INSERT INTO settings (key, value) VALUES ('rent_ticks_since', ?) ON CONFLICT(key) DO NOTHING", [since]);
  }
  return since;
}

const itemLabel = (it: RentItem) => `${it.ref ? `Ref ${it.ref} · ` : ""}${it.home}${it.who && it.who !== "Rent" ? ` (${it.who})` : ""}`;
const askUrl = (month: string, key: string) => `/rent/ask?month=${encodeURIComponent(month)}&key=${encodeURIComponent(key)}`;

/**
 * On the day a rent is due (from JARVIS_RENT_ASK_HOUR, default 17, London
 * time), one notification per rent asks whether it has come in, with
 * "Yes, paid" and "Not yet" buttons. Yes ticks it off without opening the
 * app; where a phone shows no buttons (iPhone), tapping opens a one-tap page.
 * Off with JARVIS_RENT_ASK=off. Rent left unticked still gets the late alert.
 */
export async function rentPaidAsksOnce(env: Env) {
  if (str(env.JARVIS_RENT_ASK).toLowerCase() === "off") return;
  const now = londonToday();
  const hour = Number(str(env.JARVIS_RENT_ASK_HOUR) || "17");
  if (now.hour < (Number.isFinite(hour) ? hour : 17) || now.hour >= 21) return;
  const since = await ticksSince(now.date);
  const due = (await rentChecklist(now.month)).filter((it) => !it.paid && it.due_date === now.date && it.due_date >= since);
  for (const it of due.slice(0, 20)) {
    const k = `rent_ask:${it.key}@${it.due_date}`;
    if (await get("SELECT 1 FROM settings WHERE key = ?", [k])) continue;
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [k, now.date]);
    await pushToAll(env, {
      title: "Has this rent come in?",
      body: `${itemLabel(it)}: ${gbp(it.amount)} due today`,
      url: askUrl(now.month, it.key),
      tag: `rent-ask-${it.key}-${it.due_date}`,
      rentMonth: now.month,
      rentKey: it.key,
    }).catch((err) => console.error(`Rent ask: ${(err as Error).message}`));
  }
}

const esc = (v: string) => v.replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);

function askPage(title: string, inner: string) {
  return `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><link rel="icon" href="/brand/favicon.svg"><meta name="theme-color" content="#1a1a1a">
<link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;600;800&display=swap" rel="stylesheet">
<style>
*{box-sizing:border-box}body{margin:0;font:16px/1.5 "Plus Jakarta Sans",system-ui,sans-serif;background:#fff8f5;color:#1a1a1a;min-height:100vh;display:grid;place-items:center;padding:20px}
.card{width:100%;max-width:420px;background:#fff;border-radius:20px;padding:24px;box-shadow:0 0 0 1px #f0dfd9,0 16px 40px -20px rgba(120,40,60,.35)}
.head{display:flex;align-items:center;gap:10px;font-weight:800;margin-bottom:18px}.head img{width:32px;height:32px;border-radius:9px}
h1{font-size:24px;line-height:1.2;margin:0 0 6px;font-weight:800;letter-spacing:-.01em}p{margin:0 0 6px;color:#5e5960}.amt{font-size:32px;font-weight:800;color:#1a1a1a;margin:12px 0 4px}
form{display:grid;gap:10px;margin-top:20px}button,a.btn{display:block;width:100%;min-height:56px;border:0;border-radius:14px;font:inherit;font-size:18px;font-weight:800;cursor:pointer;text-align:center;text-decoration:none;line-height:56px}
.yes{background:#c8226f;color:#fff}.no{background:#fbede8;color:#1a1a1a}a.btn{background:#1a1a1a;color:#fff;margin-top:20px}.done{font-size:44px;line-height:1}
@media (prefers-color-scheme:dark){body{background:#141214;color:#f3ecee}.card{background:#1c191c;box-shadow:0 0 0 1px #352d33}p{color:#b3a9ae}.amt{color:#f3ecee}.no{background:#252025;color:#f3ecee}a.btn{background:#f3ecee;color:#1a1a1a}}
</style></head><body><main class="card"><div class="head"><img src="/brand/favicon.svg" alt="">Jarvis</div>${inner}</main></body></html>`;
}

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const prevMonth = (month: string) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };

/** One notification for rent that's a few days late and not ticked off. Runs hourly; acts from 9am London. */
export async function rentLateAlertsOnce(env: Env) {
  if (str(env.JARVIS_RENT_ALERTS).toLowerCase() === "off") return;
  const now = londonToday();
  if (now.hour < 9 || now.hour >= 21) return;
  const grace = Math.max(0, Number(str(env.JARVIS_RENT_GRACE_DAYS) || "3"));
  // Only alert on rent due from the day this feature went live, so old months don't flood in.
  const since = await ticksSince(now.date);
  const items = [...(await rentChecklist(prevMonth(now.month))), ...(await rentChecklist(now.month))];
  const late: RentItem[] = [];
  for (const it of items) {
    if (it.paid || !it.due_date || it.due_date < since) continue;
    const gap = daysBetween(now.date, it.due_date);
    if (gap < grace || gap > 31) continue;
    const k = `rent_late:${it.key}@${it.due_date}`;
    if (await get("SELECT 1 FROM settings WHERE key = ?", [k])) continue;
    await run("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO NOTHING", [k, now.date]);
    late.push(it);
  }
  if (!late.length) return;
  const body = late.slice(0, 5).map((e) => `${e.ref ? `Ref ${e.ref}` : e.home} ${e.who !== "Rent" ? `(${e.who}) ` : ""}${gbp(e.amount)}, due ${e.due_date!.slice(8)}/${e.due_date!.slice(5, 7)}`).join("; ") + (late.length > 5 ? ` +${late.length - 5} more` : "");
  await pushToAll(env, { title: `Jarvis: rent not ticked off (${late.length})`, body, url: "/rent", tag: `rent-late-${now.date}`, urgent: true }).catch((err) => console.error(`Rent alert: ${(err as Error).message}`));
}

export function registerRentChecklistRoutes(app: AnyApp) {

  // The page a rent notification opens: one tap to tick it off.
  const findItem = async (month: string, key: string) =>
    /^\d{4}-\d{2}$/.test(month) && /^(home|room):/.test(key) ? (await rentChecklist(month)).find((i) => i.key === key) ?? null : null;

  app.get("/rent/ask", async (c) => {
    const month = c.req.query("month") ?? "";
    const key = c.req.query("key") ?? "";
    const it = await findItem(month, key);
    if (!it) return c.html(askPage("Rent", `<h1>Couldn't find that rent</h1><p>It may have been changed in the sheet.</p><a class="btn" href="/rent">Open the rent list</a>`), 404);
    if (it.paid) return c.html(askPage("Rent", `<div class="done">✓</div><h1>Already ticked off</h1><p>${esc(itemLabel(it))}</p><p>${gbp(it.paid_amount ?? it.amount)} on ${esc(it.paid_on ?? "")}${it.ticked_by ? ` by ${esc(it.ticked_by)}` : ""}.</p><a class="btn" href="/rent">Open the rent list</a>`));
    return c.html(askPage("Has this rent come in?", `<h1>Has this rent come in?</h1><p>${esc(itemLabel(it))}</p><div class="amt">${gbp(it.amount)}</div><p>Due ${esc(it.due_date ?? "")}</p>
<form method="post" action="/rent/ask"><input type="hidden" name="month" value="${esc(month)}"><input type="hidden" name="key" value="${esc(key)}">
<button class="yes" name="answer" value="paid">✓ Yes, paid</button><button class="no" name="answer" value="not-yet">Not yet</button></form>`));
  });

  app.post("/rent/ask", async (c) => {
    const form = await c.req.parseBody().catch(() => ({} as Record<string, unknown>));
    const month = String(form.month ?? "");
    const key = String(form.key ?? "");
    const it = await findItem(month, key);
    if (!it) return c.html(askPage("Rent", `<h1>Couldn't find that rent</h1><a class="btn" href="/rent">Open the rent list</a>`), 404);
    if (form.answer === "paid") {
      await setRentTick(month, key, true, getUser(c)?.name ?? null);
      return c.html(askPage("Ticked off", `<div class="done">✓</div><h1>Ticked off</h1><p>${esc(itemLabel(it))}: ${gbp(it.amount)} received today.</p><a class="btn" href="/rent">Open the rent list</a>`));
    }
    return c.html(askPage("Not yet", `<h1>Okay, left unticked</h1><p>${esc(itemLabel(it))}. If it still isn't ticked off in a few days, Jarvis will remind you.</p><a class="btn" href="/rent">Open the rent list</a>`));
  });

  app.get("/api/rent-checklist", async (c) => {
    const month = c.req.query("month") ?? londonToday().month;
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "month must be YYYY-MM" }, 400);
    return c.json({ month, today: londonToday().date, items: await rentChecklist(month) });
  });

  app.put("/api/rent-checklist", async (c) => {
    const b = await c.req.json<{ month?: string; key?: string; paid?: boolean; amount?: number | null; paid_on?: string | null }>().catch(() => ({} as Record<string, never>));
    const { month, key } = b;
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !key || !/^(home|room):/.test(key)) return c.json({ error: "month and key are needed" }, 400);
    await setRentTick(month, key, b.paid !== false, getUser(c)?.name ?? null, b.amount, b.paid_on);
    const item = (await rentChecklist(month)).find((i) => i.key === key) ?? null;
    return c.json({ item });
  });
}
