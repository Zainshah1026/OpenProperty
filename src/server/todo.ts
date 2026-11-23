// One to-do list for everything: what the rest of the app already knows
// needs doing (approvals, repairs, certificates, missed rent, tenancy and
// mortgage dates) plus your own tasks. Leads are not included.
//
// Items from elsewhere can be ticked "done for now", which hides them for a
// while (todo_hidden); they come back if the thing still needs doing. Your
// own tasks live in `todos`.

import type { Hono } from "hono";
import { z } from "zod";
import { query, run } from "./db";
import { getUser } from "./auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

export interface TodoItem {
  key: string;
  kind: "own" | "approval" | "repair" | "certificate" | "rent" | "lead" | "tenancy" | "mortgage" | "review";
  title: string;
  detail?: string | null;
  due?: string | null;        // YYYY-MM-DD
  urgent?: boolean;
  href?: string | null;
  id?: number;                // own tasks only
  done?: boolean;
  property_ref?: string | null;
}

const CERTS: [string, string][] = [
  ["gas_expiry", "gas safety certificate"],
  ["eicr_expiry", "electrical certificate (EICR)"],
  ["epc_expiry", "EPC"],
  ["licence_expiry", "licence"],
  ["insurance_expiry", "insurance"],
];

const londonToday = () => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London" }).format(new Date());
const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T12:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
const gbp = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const home = (p: { ref: string | null; name?: string | null; home?: string | null }) => { const n = p.name ?? p.home ?? null; return p.ref ? `Ref ${p.ref}${n ? `, ${n}` : ""}` : n ?? "a home"; };

export async function buildTodos(): Promise<TodoItem[]> {
  const today = londonToday();
  const items: TodoItem[] = [];
  const safe = <T>(p: Promise<T[]>) => p.catch(() => [] as T[]);

  // Your own tasks (done ones from the last week stay visible, ticked).
  for (const t of await safe(query<{ id: number; title: string; notes: string | null; due_date: string | null; done_at: string | null; ref: string | null; name: string | null; property_id: number | null }>(
    `SELECT t.id, t.title, t.notes, t.due_date, t.done_at, t.property_id, p.ref, p.name FROM todos t LEFT JOIN properties p ON p.id = t.property_id
     WHERE t.done_at IS NULL OR t.done_at >= datetime('now', '-7 days') ORDER BY t.id DESC`,
  ))) {
    items.push({
      key: `own:${t.id}`, kind: "own", id: t.id, title: t.title, detail: [t.property_id ? home(t) : null, t.notes].filter(Boolean).join(" · ") || null,
      due: t.due_date, done: !!t.done_at, href: t.property_id ? `/properties/${t.property_id}` : null, property_ref: t.ref,
    });
  }

  for (const a of await safe(query<{ id: number; summary: string; urgent: number; created_at: string }>("SELECT id, summary, urgent, created_at FROM approvals WHERE status = 'pending'"))) {
    items.push({ key: `approval:${a.id}`, kind: "approval", title: `Say yes or no: ${a.summary}`, due: a.created_at.slice(0, 10), urgent: !!a.urgent, href: `/approvals#${a.id}` });
  }

  for (const w of await safe(query<{ id: number; title: string; priority: string; status: string; scheduled_at: string | null; created_at: string; ref: string | null; name: string | null }>(
    `SELECT w.id, w.title, w.priority, w.status, w.scheduled_at, w.created_at, p.ref, p.name FROM work_orders w LEFT JOIN properties p ON p.id = w.property_id
     WHERE w.status IN ('open', 'assigned', 'in_progress')`,
  ))) {
    const urgent = w.priority === "urgent" || w.priority === "high";
    items.push({
      key: `repair:${w.id}`, kind: "repair", title: `Repair: ${w.title}`, detail: `${home(w)} · ${w.status.replace("_", " ")}`,
      due: w.scheduled_at?.slice(0, 10) ?? (urgent ? w.created_at.slice(0, 10) : null), urgent, href: "/maintenance", property_ref: w.ref,
    });
  }

  type P = { id: number; ref: string | null; name: string | null; rent_status: string | null; arrears_amount: number | null; energy: string | null; [k: string]: unknown };
  const props = await safe(query<P>("SELECT * FROM properties"));
  const horizon = addDays(today, 60);
  for (const p of props) {
    for (const [field, label] of CERTS) {
      if (field === "gas_expiry" && p.energy === "all_electric") continue;
      const d = p[field] as string | null;
      if (!d || d > horizon) continue;
      items.push({
        key: `cert:${p.id}:${field}`, kind: "certificate",
        title: d < today ? `Renew the ${label}: it has expired` : `Renew the ${label}`,
        detail: home(p), due: d, urgent: d < addDays(today, 14), href: "/compliance", property_ref: p.ref,
      });
    }
    // From 1 Oct 2030 a rented home needs EPC C or better (C issued before 1 Oct 2029 counts until it expires).
    const rating = String(p.epc_rating ?? "").toUpperCase();
    if (/^[D-G]$/.test(rating) && p.section !== "freehold") {
      items.push({
        key: `epc-c:${p.id}`, kind: "certificate",
        title: `Get the EPC up to C (now ${rating}) before 1 Oct 2030`,
        detail: home(p), due: "2030-10-01", urgent: /^[F-G]$/.test(rating), href: "/compliance", property_ref: p.ref,
      });
    }
    if (p.rent_status === "missed") {
      items.push({
        key: `rent:${p.id}`, kind: "rent", title: `Chase missed rent${p.arrears_amount ? ` of ${gbp(p.arrears_amount)}` : ""}`,
        detail: home(p), due: today, urgent: true, href: `/properties/${p.id}`, property_ref: p.ref,
      });
    }
  }

  // Leads are left off on purpose: they live on Houses for sale and Landlords to sign up.

  for (const r of await safe(query<{ property_id: number; room: string | null; tenant_name: string | null; end_date: string; ref: string | null; name: string | null }>(
    `SELECT r.property_id, r.room, r.tenant_name, r.end_date, p.ref, p.name FROM rooms r JOIN properties p ON p.id = r.property_id
     WHERE r.end_date IS NOT NULL AND r.end_date BETWEEN ? AND ?`,
    [addDays(today, -14), addDays(today, 60)],
  ))) {
    items.push({
      key: `tenancy:${r.property_id}:${r.room ?? ""}:${r.end_date}`, kind: "tenancy",
      title: `Tenancy ends: ${r.tenant_name || r.room || "tenant"}`, detail: [home(r), r.room].filter(Boolean).join(" · "),
      due: r.end_date, urgent: r.end_date <= addDays(today, 14), href: `/properties/${r.property_id}`, property_ref: r.ref,
    });
  }

  for (const m of await safe(query<{ id: number; lender: string; deal_end: string; ref: string | null; name: string | null }>(
    `SELECT m.id, m.lender, m.deal_end, p.ref, p.name FROM mortgages m LEFT JOIN properties p ON p.id = m.property_id
     WHERE COALESCE(m.status, 'active') = 'active' AND m.deal_end IS NOT NULL AND m.deal_end BETWEEN ? AND ?`,
    [addDays(today, -30), addDays(today, 120)],
  ))) {
    items.push({
      key: `mortgage:${m.id}:${m.deal_end}`, kind: "mortgage", title: `Sort a new mortgage deal (${m.lender})`,
      detail: `${home(m)} · the current deal ends`, due: m.deal_end, urgent: m.deal_end <= addDays(today, 30), href: "/mortgages", property_ref: m.ref,
    });
  }

  // Hidden for now ("done for now" on an item from elsewhere).
  const hidden = new Set((await safe(query<{ key: string }>("SELECT key FROM todo_hidden WHERE until > ?", [today]))).map((h) => h.key));
  return items
    .filter((i) => i.kind === "own" || !hidden.has(i.key))
    .sort((a, b) => Number(!!a.done) - Number(!!b.done) || Number(!!b.urgent && !b.done) - Number(!!a.urgent && !a.done) || (a.due ?? "9999").localeCompare(b.due ?? "9999"));
}

const Own = z.object({
  title: z.string().trim().min(1).max(300),
  notes: z.string().max(2000).optional().nullable(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  property_id: z.number().int().optional().nullable(),
});

export async function addOwnTodo(t: z.infer<typeof Own>, by: string | null) {
  const r = await run("INSERT INTO todos (title, notes, due_date, property_id, created_by) VALUES (?, ?, ?, ?, ?)", [
    t.title, t.notes ?? null, t.due_date ?? null, t.property_id ?? null, by,
  ]);
  return r.lastInsertRowid;
}

export function registerTodoRoutes(app: AnyApp) {
  app.get("/api/todo", async (c) => c.json({ items: await buildTodos(), today: londonToday() }));

  app.post("/api/todo", async (c) => {
    const parsed = Own.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: "Write what needs doing." }, 400);
    const id = await addOwnTodo(parsed.data, getUser(c)?.name ?? null);
    return c.json({ id }, 201);
  });

  app.put("/api/todo/:id", async (c) => {
    const id = Number(c.req.param("id"));
    const body = (await c.req.json().catch(() => ({}))) as { done?: boolean };
    if (typeof body.done !== "boolean") return c.json({ error: "Nothing to change." }, 400);
    await run("UPDATE todos SET done_at = CASE WHEN ? THEN datetime('now') ELSE NULL END WHERE id = ?", [body.done ? 1 : 0, id]);
    return c.json({ ok: true });
  });

  app.delete("/api/todo/:id", async (c) => {
    await run("DELETE FROM todos WHERE id = ?", [Number(c.req.param("id"))]);
    return c.json({ ok: true });
  });

  // "Done for now": hide something from elsewhere for a while (default a week).
  app.post("/api/todo/hide", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { key?: string; days?: number };
    const key = String(body.key ?? "").slice(0, 200);
    if (!key || key.startsWith("own:")) return c.json({ error: "Nothing to hide." }, 400);
    const days = Math.min(365, Math.max(1, Number(body.days) || 7));
    await run("INSERT INTO todo_hidden (key, until) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET until = excluded.until", [key, addDays(londonToday(), days)]);
    return c.json({ ok: true });
  });

  app.get("/api/todo/count", async (c) => {
    const items = await buildTodos();
    const today = londonToday();
    return c.json({ due: items.filter((i) => !i.done && (i.urgent || (i.due && i.due <= today))).length, total: items.filter((i) => !i.done).length });
  });
}
