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

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${a}T12:00:00Z`) - Date.parse(`${b}T12:00:00Z`)) / 86_400_000);
const prevMonth = (month: string) => { const [y, m] = month.split("-").map(Number); const d = new Date(Date.UTC(y, m - 2, 1)); return d.toISOString().slice(0, 7); };

/** One notification for rent that's a few days late and not ticked off. Runs hourly; acts from 9am London. */
export async function rentLateAlertsOnce(env: Env) {
  if (str(env.JARVIS_RENT_ALERTS).toLowerCase() === "off") return;
  const now = londonToday();
  if (now.hour < 9 || now.hour >= 21) return;
  const grace = Math.max(0, Number(str(env.JARVIS_RENT_GRACE_DAYS) || "3"));
  // Only alert on rent due from the day this feature went live, so old months don't flood in.
  let since = (await get<{ value: string }>("SELECT value FROM settings WHERE key = 'rent_ticks_since'"))?.value;
  if (!since) {
    since = now.date;
    await run("INSERT INTO settings (key, value) VALUES ('rent_ticks_since', ?) ON CONFLICT(key) DO NOTHING", [since]);
  }
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
  app.get("/api/rent-checklist", async (c) => {
    const month = c.req.query("month") ?? londonToday().month;
    if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "month must be YYYY-MM" }, 400);
    return c.json({ month, today: londonToday().date, items: await rentChecklist(month) });
  });

  app.put("/api/rent-checklist", async (c) => {
    const b = await c.req.json<{ month?: string; key?: string; paid?: boolean; amount?: number | null; paid_on?: string | null }>().catch(() => ({} as Record<string, never>));
    const { month, key } = b;
    if (!month || !/^\d{4}-\d{2}$/.test(month) || !key || !/^(home|room):/.test(key)) return c.json({ error: "month and key are needed" }, 400);
    if (b.paid === false) {
      await run("DELETE FROM rent_ticks WHERE month = ? AND key = ?", [month, key]);
    } else {
      const paidOn = b.paid_on && /^\d{4}-\d{2}-\d{2}$/.test(b.paid_on) ? b.paid_on : londonToday().date;
      const amount = typeof b.amount === "number" && b.amount >= 0 ? b.amount : null;
      await run(
        `INSERT INTO rent_ticks (month, key, amount, paid_on, ticked_by) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(month, key) DO UPDATE SET amount = excluded.amount, paid_on = excluded.paid_on, ticked_by = excluded.ticked_by, ticked_at = datetime('now')`,
        [month, key, amount, paidOn, getUser(c)?.name ?? null],
      );
    }
    const item = (await rentChecklist(month)).find((i) => i.key === key) ?? null;
    return c.json({ item });
  });
}
