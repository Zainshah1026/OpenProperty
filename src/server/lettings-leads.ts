// Lettings leads: landlords who want to let a property to us, from the
// guaranteed rent ads and the Chisti & Co lead form. Most arrive through the
// sheet's Lettings Leads tab (see sync.ts); they can also be added here.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

export const LETTINGS_STATUSES = ["new", "contacted", "viewing", "offer_sent", "signed", "not_interested"] as const;
const text = (max: number) => z.string().trim().max(max).optional().nullable();

const Input = z.object({
  name: z.string().trim().min(1, "Add the landlord's name").max(160),
  phone: text(60),
  email: text(200),
  location: text(200),
  postcode: text(12),
  bedrooms: text(40),
  property_type: text(60),
  properties_owned: text(20),
  when_to_let: text(60),
  source: text(200),
  enquired_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  status: z.enum(LETTINGS_STATUSES).optional(),
  next_action: text(300),
  notes: text(4000),
  do_not_email: z.boolean().optional(),
});
const FIELDS = Object.keys(Input.shape) as (keyof z.infer<typeof Input> & string)[];

const intId = (c: Context) => {
  const n = parseInt(c.req.param("id") ?? "", 10);
  return Number.isFinite(n) ? n : null;
};

export function registerLettingsLeads(app: AnyApp) {
  app.get("/api/lettings-leads", async (c) => {
    const rows = await query("SELECT * FROM lettings_leads ORDER BY COALESCE(enquired_on, created_at) DESC, id DESC").catch(() => []);
    return c.json({ leads: rows });
  });

  app.post("/api/lettings-leads", async (c) => {
    const parsed = Input.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const d = parsed.data;
    const cols = FIELDS.filter((k) => d[k] !== undefined);
    const r = await run(
      `INSERT INTO lettings_leads (${cols.join(", ")}, origin) VALUES (${cols.map(() => "?").join(", ")}, 'app')`,
      cols.map((k) => d[k] ?? null),
    );
    return c.json({ lead: await get("SELECT * FROM lettings_leads WHERE id = ?", [r.lastInsertRowid]) }, 201);
  });

  app.put("/api/lettings-leads/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = Input.partial().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of FIELDS) {
      if (parsed.data[k] === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(parsed.data[k]);
    }
    if (!sets.length) return c.json({ error: "No changes" }, 400);
    const r = await run(`UPDATE lettings_leads SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    return c.json({ lead: await get("SELECT * FROM lettings_leads WHERE id = ?", [id]) });
  });

  app.delete("/api/lettings-leads/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const row = await get<{ sheet_key: string | null }>("SELECT sheet_key FROM lettings_leads WHERE id = ?", [id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    await run("DELETE FROM lettings_leads WHERE id = ?", [id]);
    // Still in the sheet? Remember the delete so the next sync doesn't bring it back.
    if (row.sheet_key) await run("INSERT OR IGNORE INTO sheet_deleted (sheet_key) VALUES (?)", [row.sheet_key]);
    return c.json({ ok: true });
  });
}
