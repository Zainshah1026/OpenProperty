// Lettings leads: landlords who want to let a property to us, from the
// guaranteed rent ads and the Chisti & Co lead form. Most arrive through the
// sheet's Lettings Leads tab (see sync.ts); they can also be added here.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";
import { pushToAll } from "./jarvis";

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

// ── Website valuation form ───────────────────────────────────────────
// The public website posts here (a plain HTML form, so no CORS). Each
// enquiry becomes a lettings lead (source "Sphere website") and sends a
// notification. A hidden "website" field catches bots; each address can
// send a few an hour. Afterwards the visitor goes back to the page they
// came from, with #thanks on the end.
const recentPosts = new Map<string, number[]>();
function tooManyPosts(ip: string) {
  const now = Date.now();
  const list = (recentPosts.get(ip) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= 5) return true;
  list.push(now);
  recentPosts.set(ip, list);
  return false;
}

function backTo(referer: string | undefined) {
  try {
    const u = new URL(referer ?? "");
    if (u.protocol === "https:" || u.protocol === "http:") return `${u.origin}${u.pathname}#thanks`;
  } catch { /* no usable referer */ }
  return null;
}

const thanksPage = (msg: string) => `<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Thank you</title></head>
<body style="margin:0;font:17px/1.6 system-ui,sans-serif;background:#fff8f5;color:#1a1a1a;display:grid;place-items:center;min-height:100vh;padding:20px"><main style="max-width:420px;background:#fff;border-radius:20px;padding:28px;box-shadow:0 0 0 1px #f0dfd9"><h1 style="margin:0 0 8px;font-size:24px">Thank you</h1><p style="margin:0">${msg}</p></main></body></html>`;

export function registerWebsiteForm(app: AnyApp) {
  app.post("/api/public/valuation", async (c) => {
    const f = (await c.req.parseBody().catch(() => ({}))) as Record<string, unknown>;
    const one = (k: string, max: number) => String(f[k] ?? "").trim().slice(0, max);
    const back = backTo(c.req.header("referer"));
    const done = (msg: string, status = 200) => (back && status === 200 ? c.redirect(back, 303) : c.html(thanksPage(msg), status as 200));
    if (one("website", 200)) return done("We'll be in touch shortly."); // a bot filled the hidden field
    const name = one("name", 160);
    const phone = one("phone", 60);
    if (!name || !phone) return c.html(thanksPage("Please go back and add your name and phone number."), 400);
    const ip = (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || "unknown";
    if (tooManyPosts(ip)) return c.html(thanksPage("We've already had a few enquiries from you. Please call us instead."), 429);
    const postcode = one("postcode", 12).toUpperCase();
    const bedrooms = one("beds", 40);
    const type = one("type", 60);
    const email = one("email", 200);
    const today = new Date().toISOString().slice(0, 10);
    await run(
      `INSERT INTO lettings_leads (name, phone, email, postcode, bedrooms, property_type, source, enquired_on, status, notes, origin)
       VALUES (?, ?, ?, ?, ?, ?, 'Sphere website', ?, 'new', ?, 'app')`,
      [name, phone, email || null, postcode || null, bedrooms || null, type || null, today, "Free valuation request from the website."],
    );
    await pushToAll(c.env as Record<string, unknown>, {
      title: "New valuation request",
      body: `${name}${postcode ? `, ${postcode}` : ""}${type ? ` · ${type}` : ""}${bedrooms ? ` · ${bedrooms}` : ""} · ${phone}`,
      url: "/lettings-leads",
      tag: `website-lead-${Date.now()}`,
      urgent: true,
    }).catch((err) => console.error(`Website lead push: ${(err as Error).message}`));
    return done("We've got your details and will call you shortly.");
  });
}
