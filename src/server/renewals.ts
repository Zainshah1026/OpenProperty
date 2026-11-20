// Rent reviews and renewals.
//
// Since 1 May 2026 (Renters' Rights Act, England) tenancies let to people are
// assured periodic tenancies: they don't end or "renew", and the rent can go up
// only once a year, never in the first year, by serving Form 4A (section 13)
// at least 2 months before the new rent starts. Company lets aren't assured
// tenancies, so they still run for a fixed term and get renewed.
//
// This works out, for every tenancy, when the rent can next go up, suggests a
// figure (RENT_REVIEW_PERCENT, default 3%), and keeps a record of notices
// served. It never changes a rent by itself and gives no legal advice: the
// page links to the official form and guidance.

import type { Hono } from "hono";
import { z } from "zod";
import { query, run } from "./db";
import { addOwnTodo } from "./todo";
import { getUser } from "./auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;
type Env = Record<string, unknown>;

export const FORM_4A_URL = "https://www.gov.uk/guidance/assured-tenancy-forms-for-privately-rented-properties-from-1-may-2026";
export const RENT_GUIDE_URL = "https://www.gov.uk/assured-tenancy-agreements-a-guide-for-landlords/rent-increases";

const COMPANY = /\b(ltd|limited|llp|plc|council|housing|association|trust|group|services|lettings)\b/i;
const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const addMonths = (iso: string, n: number) => {
  const d = new Date(`${iso}T12:00:00Z`);
  const day = d.getUTCDate();
  d.setUTCDate(1);
  d.setUTCMonth(d.getUTCMonth() + n);
  const last = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 0)).getUTCDate();
  d.setUTCDate(Math.min(day, last));
  return d.toISOString().slice(0, 10);
};
const maxDate = (a: string, b: string) => (a > b ? a : b);

export interface Tenancy {
  key: string;                 // "<property_id>:<room or ''>"
  property_id: number;
  ref: string | null;
  home: string;
  room: string | null;
  tenant: string | null;
  rent: number;
  start_date: string | null;
  end_date: string | null;
  kind: "assured" | "company";
  last_increase: string | null;       // when the last recorded new rent started
  earliest_new_rent: string | null;   // the soonest a new rent could start if notice went today
  notice_from: string | null;         // first day a notice can usefully be served
  status: "ready" | "soon" | "wait" | "unknown" | "ending" | "running" | "pending";
  suggested_rent: number;
  pending?: { notice_served: string; takes_effect: string; new_rent: number } | null;
}

export async function buildTenancies(env: Env): Promise<Tenancy[]> {
  const today = londonToday();
  const pct = Math.max(0, Math.min(20, Number(String(env.RENT_REVIEW_PERCENT ?? "").trim() || "3")));
  const suggest = (rent: number) => (rent ? Math.round((rent * (1 + pct / 100)) / 5) * 5 : 0);

  const reviews = await query<{ property_id: number; room: string | null; notice_served: string; takes_effect: string; new_rent: number }>(
    "SELECT property_id, room, notice_served, takes_effect, new_rent FROM rent_reviews ORDER BY takes_effect",
  ).catch(() => []);
  const lastBy = new Map<string, { notice_served: string; takes_effect: string; new_rent: number }>();
  for (const r of reviews) lastBy.set(`${r.property_id}:${r.room ?? ""}`, r);

  const rows: Omit<Tenancy, "last_increase" | "earliest_new_rent" | "notice_from" | "status" | "suggested_rent" | "pending">[] = [];
  const rooms = await query<{ property_id: number; room: string | null; tenant_name: string | null; rent: number; start_date: string | null; end_date: string | null; rent_status: string | null }>(
    "SELECT property_id, room, tenant_name, rent, start_date, end_date, rent_status FROM rooms WHERE tenant_name IS NOT NULL AND TRIM(tenant_name) != '' AND COALESCE(rent_status, '') != 'empty'",
  ).catch(() => []);
  const props = await query<{ id: number; ref: string | null; name: string; occupancy: string; tenant_label: string | null; rent_in: number; section: string; tenant_type: string | null; company_name: string | null }>(
    `SELECT p.id, p.ref, p.name, p.occupancy, p.tenant_label, p.rent_in, p.section, t.tenant_type, t.company_name
     FROM properties p LEFT JOIN tenants t ON t.id = p.tenant_id`,
  ).catch(() => []);
  const byId = new Map(props.map((p) => [p.id, p]));
  const withRooms = new Set(rooms.map((r) => r.property_id));

  for (const r of rooms) {
    const p = byId.get(r.property_id);
    if (!p) continue;
    rows.push({
      key: `${r.property_id}:${r.room ?? ""}`, property_id: r.property_id, ref: p.ref, home: p.name, room: r.room, tenant: r.tenant_name,
      rent: r.rent, start_date: r.start_date, end_date: r.end_date, kind: COMPANY.test(r.tenant_name ?? "") ? "company" : "assured",
    });
  }
  for (const p of props) {
    if (withRooms.has(p.id) || p.occupancy === "vacant" || !(p.rent_in > 0) || !(p.tenant_label || p.tenant_type)) continue;
    const tenant = p.company_name || p.tenant_label;
    rows.push({
      key: `${p.id}:`, property_id: p.id, ref: p.ref, home: p.name, room: null, tenant, rent: p.rent_in, start_date: null, end_date: null,
      kind: p.tenant_type === "company" || COMPANY.test(tenant ?? "") ? "company" : "assured",
    });
  }

  return rows.map((t) => {
    const last = lastBy.get(t.key) ?? null;
    const base = last?.takes_effect ?? t.start_date;
    if (t.kind === "company") {
      const ending = !!t.end_date && t.end_date <= addDays(today, 90);
      return { ...t, last_increase: last?.takes_effect ?? null, earliest_new_rent: null, notice_from: null, status: ending ? "ending" : "running", suggested_rent: suggest(t.rent), pending: null };
    }
    const pending = last && last.takes_effect > today ? last : null;
    if (!base) {
      return { ...t, last_increase: null, earliest_new_rent: addMonths(today, 2), notice_from: today, status: "unknown", suggested_rent: suggest(t.rent), pending };
    }
    // A new rent can start no sooner than a year after the tenancy began or the last rise, and needs 2 months' notice.
    const yearOn = addDays(base, 364);
    const earliest = maxDate(yearOn, addMonths(today, 2));
    const noticeFrom = maxDate(today, addMonths(yearOn, -2));
    const status: Tenancy["status"] = pending ? "pending" : noticeFrom <= today ? "ready" : noticeFrom <= addDays(today, 60) ? "soon" : "wait";
    return { ...t, last_increase: last?.takes_effect ?? null, earliest_new_rent: earliest, notice_from: noticeFrom, status, suggested_rent: suggest(t.rent), pending: pending ? { notice_served: pending.notice_served, takes_effect: pending.takes_effect, new_rent: pending.new_rent } : null };
  });
}

const Review = z.object({
  property_id: z.number().int(),
  room: z.string().optional().nullable(),
  notice_served: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  takes_effect: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  old_rent: z.number().min(0).optional().nullable(),
  new_rent: z.number().positive(),
});

export function registerRenewalRoutes(app: AnyApp) {
  app.get("/api/renewals", async (c) => {
    const items = await buildTenancies(c.env as Env);
    const order = { ending: 0, ready: 1, unknown: 2, soon: 3, pending: 4, wait: 5, running: 6 } as const;
    items.sort((a, b) => order[a.status] - order[b.status] || (a.notice_from ?? a.end_date ?? "").localeCompare(b.notice_from ?? b.end_date ?? "") || (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));
    return c.json({ items, form_url: FORM_4A_URL, guide_url: RENT_GUIDE_URL, today: londonToday() });
  });

  // "I've served the notice": keep a record and put the start date on the to-do list.
  app.post("/api/renewals/review", async (c) => {
    const parsed = Review.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Fill in the dates and the new rent." }, 400);
    const d = parsed.data;
    if (d.takes_effect < d.notice_served) return c.json({ error: "The new rent can't start before the notice was served." }, 400);
    await run("INSERT INTO rent_reviews (property_id, room, notice_served, takes_effect, old_rent, new_rent, created_by) VALUES (?, ?, ?, ?, ?, ?, ?)", [
      d.property_id, d.room || null, d.notice_served, d.takes_effect, d.old_rent ?? null, d.new_rent, getUser(c)?.name ?? null,
    ]);
    await addOwnTodo({
      title: `New rent of £${Math.round(d.new_rent).toLocaleString("en-GB")} starts${d.room ? ` (${d.room})` : ""}: update the rent records`,
      due_date: d.takes_effect,
      property_id: d.property_id,
      notes: `Form 4A served on ${d.notice_served}. If the tenant refers it to the tribunal, the new rent may change.`,
    }, getUser(c)?.name ?? null);
    return c.json({ ok: true }, 201);
  });
}
