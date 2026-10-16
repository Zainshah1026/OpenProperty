// Keys & access, empty-period (void) tracking, and tenant repair requests.
//
// Repair requests are the one part of the app anyone can reach: each home
// has a secret link (/r/<token>, printed as a QR code on a poster) where a
// tenant can describe a problem and add photos. It only ever CREATES a work
// order for that one home; it can't read anything back.

import type { Context, Hono } from "hono";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { get, query, run } from "./db";
import { getUser } from "./auth";
import { saveUpload, publicRow, type DocRow } from "./documents";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

const intId = (c: Context) => {
  const n = parseInt(c.req.param("id") ?? "", 10);
  return Number.isFinite(n) ? n : null;
};
const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
const londonToday = () =>
  new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
const ISO = /^\d{4}-\d{2}-\d{2}$/;

// ── Keys & access ──────────────────────────────────────────────────

const ACCESS_FIELDS = ["key_safe_location", "key_safe_code", "keys_held_by", "alarm_code", "access_notes"] as const;

function registerAccess(app: AnyApp) {
  app.get("/api/properties/:id/access", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const row = await get("SELECT * FROM property_access WHERE property_id = ?", [id]);
    return c.json({ access: row ?? null });
  });

  app.put("/api/properties/:id/access", async (c) => {
    const id = intId(c);
    if (!id || !(await get("SELECT id FROM properties WHERE id = ?", [id]))) return c.json({ error: "Unknown property" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const vals = ACCESS_FIELDS.map((k) => {
      const v = String(body[k] ?? "").trim();
      return v ? v.slice(0, 1000) : null;
    });
    await run(
      `INSERT INTO property_access (property_id, ${ACCESS_FIELDS.join(", ")}, updated_by, updated_at)
       VALUES (?, ${ACCESS_FIELDS.map(() => "?").join(", ")}, ?, datetime('now'))
       ON CONFLICT(property_id) DO UPDATE SET ${ACCESS_FIELDS.map((k) => `${k} = excluded.${k}`).join(", ")},
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
      [id, ...vals, getUser(c)?.name ?? null],
    );
    return c.json({ access: await get("SELECT * FROM property_access WHERE property_id = ?", [id]) });
  });
}

// ── Empty periods ──────────────────────────────────────────────────

interface VoidRow {
  id: number;
  property_id: number;
  room: string | null;
  start_date: string;
  end_date: string | null;
  monthly_rent: number;
}

/**
 * Called after each sheet sync: opens an empty period when a home (or a
 * room) shows as empty and closes it when it's let again. History builds up
 * from the day this runs; earlier gaps can be added by hand.
 */
export async function recordVoids(): Promise<void> {
  const today = londonToday();
  const props = await query<{ id: number; occupancy: string | null; rent_in: number }>("SELECT id, occupancy, rent_in FROM properties");
  const rooms = await query<{ property_id: number; room: string | null; tenant_name: string | null; rent: number; rent_status: string | null }>(
    "SELECT property_id, room, tenant_name, rent, rent_status FROM rooms",
  );
  const open = await query<VoidRow>("SELECT * FROM voids WHERE end_date IS NULL");
  const key = (pid: number, room: string | null) => `${pid}|${(room ?? "").trim().toLowerCase()}`;
  const openBy = new Map(open.map((v) => [key(v.property_id, v.room), v]));
  const emptyNow = new Map<string, { pid: number; room: string | null; rent: number }>();

  for (const p of props) {
    if (p.occupancy === "vacant") emptyNow.set(key(p.id, null), { pid: p.id, room: null, rent: p.rent_in || 0 });
  }
  for (const r of rooms) {
    if (!r.room) continue;
    if (r.rent_status === "empty" || !r.tenant_name) emptyNow.set(key(r.property_id, r.room), { pid: r.property_id, room: r.room, rent: r.rent || 0 });
  }
  for (const [k, e] of emptyNow) {
    if (!openBy.has(k)) await run("INSERT INTO voids (property_id, room, start_date, monthly_rent) VALUES (?, ?, ?, ?)", [e.pid, e.room, today, e.rent]);
  }
  for (const [k, v] of openBy) {
    if (!emptyNow.has(k)) await run("UPDATE voids SET end_date = ? WHERE id = ?", [today, v.id]);
  }
}

/** Days of a period that fall inside [from, to], counting both ends. */
function overlapDays(v: VoidRow, from: string, to: string): number {
  const start = v.start_date > from ? v.start_date : from;
  const endRaw = v.end_date ?? to;
  const end = endRaw < to ? endRaw : to;
  if (end < start) return 0;
  return Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
}

function voidStats(rows: VoidRow[]) {
  const today = londonToday();
  const yearStart = `${today.slice(0, 4)}-01-01`;
  let days = 0;
  let lost = 0;
  for (const v of rows) {
    const d = overlapDays(v, yearStart, today);
    days += v.room ? 0 : d; // whole-home days; rooms count toward lost rent
    lost += (d * (v.monthly_rent || 0) * 12) / 365;
  }
  const roomDays = rows.filter((v) => v.room).reduce((a, v) => a + overlapDays(v, yearStart, today), 0);
  return { days_this_year: days, room_days_this_year: roomDays, lost_rent_this_year: Math.round(lost), empty_now: rows.filter((v) => !v.end_date).length };
}

function registerVoids(app: AnyApp) {
  app.get("/api/voids", async (c) => {
    const pid = parseInt(c.req.query("property_id") ?? "", 10);
    if (!Number.isFinite(pid)) return c.json({ error: "property_id is required" }, 400);
    const rows = await query<VoidRow>("SELECT * FROM voids WHERE property_id = ? ORDER BY start_date DESC", [pid]);
    return c.json({ voids: rows, stats: voidStats(rows) });
  });

  app.get("/api/voids/summary", async (c) => {
    const rows = await query<VoidRow>("SELECT * FROM voids");
    const by = new Map<number, VoidRow[]>();
    for (const v of rows) by.set(v.property_id, [...(by.get(v.property_id) ?? []), v]);
    const out: Record<number, ReturnType<typeof voidStats>> = {};
    for (const [pid, vs] of by) out[pid] = voidStats(vs);
    const total = voidStats(rows);
    return c.json({ properties: out, total });
  });

  app.post("/api/voids", async (c) => {
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const pid = Number(b.property_id);
    if (!Number.isInteger(pid) || !(await get("SELECT id FROM properties WHERE id = ?", [pid]))) return c.json({ error: "Unknown property" }, 400);
    const start = String(b.start_date ?? "");
    const end = b.end_date ? String(b.end_date) : null;
    if (!ISO.test(start) || (end && (!ISO.test(end) || end < start))) return c.json({ error: "Give a start date, and an end date on or after it." }, 400);
    const r = await run("INSERT INTO voids (property_id, room, start_date, end_date, monthly_rent) VALUES (?, ?, ?, ?, ?)", [
      pid, String(b.room ?? "").trim() || null, start, end, Math.max(0, Number(b.monthly_rent) || 0),
    ]);
    return c.json({ void: await get("SELECT * FROM voids WHERE id = ?", [r.lastInsertRowid]) }, 201);
  });

  app.put("/api/voids/:id", async (c) => {
    const id = intId(c);
    const v = id ? await get<VoidRow>("SELECT * FROM voids WHERE id = ?", [id]) : undefined;
    if (!v) return c.json({ error: "Not found" }, 404);
    const b = (await c.req.json().catch(() => ({}))) as Record<string, unknown>;
    const start = b.start_date !== undefined ? String(b.start_date) : v.start_date;
    const end = b.end_date !== undefined ? (b.end_date ? String(b.end_date) : null) : v.end_date;
    if (!ISO.test(start) || (end && (!ISO.test(end) || end < start))) return c.json({ error: "Give a start date, and an end date on or after it." }, 400);
    const rent = b.monthly_rent !== undefined ? Math.max(0, Number(b.monthly_rent) || 0) : v.monthly_rent;
    await run("UPDATE voids SET start_date = ?, end_date = ?, monthly_rent = ? WHERE id = ?", [start, end, rent, id]);
    return c.json({ void: await get("SELECT * FROM voids WHERE id = ?", [id]) });
  });

  app.delete("/api/voids/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    await run("DELETE FROM voids WHERE id = ?", [id]);
    return c.json({ ok: true });
  });
}

// ── Tenant repair requests ─────────────────────────────────────────

const newToken = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return btoa(String.fromCharCode(...b)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
};

async function tokenFor(pid: number, reset = false): Promise<string | null> {
  const p = await get<{ report_token: string | null }>("SELECT report_token FROM properties WHERE id = ?", [pid]);
  if (!p) return null;
  if (p.report_token && !reset) return p.report_token;
  const t = newToken();
  await run("UPDATE properties SET report_token = ? WHERE id = ?", [t, pid]);
  return t;
}

// QR codes are drawn by the `qrcode` package, installed at build time into
// server-deps like the mail libraries (see package.json build:mail-deps).
type QR = { toString(text: string, opts: Record<string, unknown>): Promise<string> };
let qr: QR | null | undefined;
function qrLib(): QR | null {
  if (qr !== undefined) return qr;
  for (const base of [resolve(process.cwd(), "server-deps", "package.json"), resolve(process.cwd(), "package.json")]) {
    try {
      qr = createRequire(base)("qrcode") as QR;
      return qr;
    } catch { /* try the next place */ }
  }
  qr = null;
  return qr;
}

const PAGE_CSS = `
*{box-sizing:border-box}body{margin:0;font-family:Figtree,-apple-system,"Segoe UI",sans-serif;background:#f3f5f8;color:#13202e}
.wrap{max-width:560px;margin:0 auto;padding:24px 16px 48px}
.head{display:flex;align-items:center;gap:10px;margin-bottom:20px}.head img{width:36px;height:36px;border-radius:8px}
.head b{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:20px}
.card{background:#fff;border-radius:16px;padding:20px;box-shadow:0 0 0 1px rgba(16,36,58,.05),0 8px 24px -14px rgba(16,36,58,.18)}
h1{font-family:Newsreader,Georgia,serif;font-weight:500;font-size:28px;line-height:1.15;margin:0 0 6px}
p.sub{margin:0 0 18px;color:#5b6878}
label{display:block;font-size:14px;font-weight:600;margin:14px 0 6px}
input,textarea,select{width:100%;font:inherit;font-size:16px;padding:10px 12px;border-radius:10px;border:1px solid #d9e0e8;background:#fff;color:inherit}
textarea{min-height:120px}
.hint{font-size:13px;color:#5b6878;margin-top:4px}
button{margin-top:20px;width:100%;font:inherit;font-weight:600;font-size:16px;padding:12px;border:0;border-radius:10px;background:#0b7cc2;color:#fff;cursor:pointer}
.urgent{margin-top:14px;padding:12px;border-radius:10px;background:#f9edec;color:#8a2f2d;font-size:14px}
.hp{position:absolute;left:-9999px}
@media (prefers-color-scheme:dark){body{background:#0a121b;color:#e7edf3}.card{background:#111b26;box-shadow:inset 0 0 0 1px #1f2b39}
p.sub,.hint{color:#9aa7b5}input,textarea,select{background:#0a121b;border-color:#263445}.urgent{background:#3b1c1a;color:#e6b7b2}}`;

const page = (title: string, body: string) => `<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow">
<title>${esc(title)}</title><link rel="icon" href="/brand/favicon.svg">
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600&family=Newsreader:opsz,wght@6..72,500&display=swap" rel="stylesheet">
<style>${PAGE_CSS}</style></head><body><div class="wrap">
<div class="head"><img src="/brand/favicon.svg" alt=""><b>Chisti &amp; Co.</b></div>${body}</div></body></html>`;

/** Short, recognisable name for the home: first part of the address. */
const homeName = (p: { name: string; address: string | null }) => (p.address ?? p.name).split(",")[0].trim() || p.name;

// A light brake on the public form: a handful of reports per address per hour.
const recent = new Map<string, number[]>();
function tooMany(key: string): boolean {
  const now = Date.now();
  const list = (recent.get(key) ?? []).filter((t) => now - t < 3_600_000);
  if (list.length >= 6) return true;
  list.push(now);
  recent.set(key, list);
  return false;
}

function registerRepairs(app: AnyApp) {
  // Signed-in: the link and QR code for a home.
  app.get("/api/properties/:id/report-link", async (c) => {
    const id = intId(c);
    const t = id ? await tokenFor(id) : null;
    if (!t) return c.json({ error: "Unknown property" }, 404);
    return c.json({ url: `${new URL(c.req.url).origin}/r/${t}` });
  });

  app.post("/api/properties/:id/report-link/reset", async (c) => {
    const id = intId(c);
    const t = id ? await tokenFor(id, true) : null;
    if (!t) return c.json({ error: "Unknown property" }, 404);
    return c.json({ url: `${new URL(c.req.url).origin}/r/${t}` });
  });

  app.get("/properties/:id/qr.svg", async (c) => {
    const id = intId(c);
    const t = id ? await tokenFor(id) : null;
    if (!t) return c.text("Unknown property", 404);
    const lib = qrLib();
    if (!lib) return c.text("QR codes aren't available on this server.", 503);
    const svg = await lib.toString(`${new URL(c.req.url).origin}/r/${t}`, { type: "svg", margin: 1, errorCorrectionLevel: "M", color: { dark: "#0e2133", light: "#ffffff" } });
    return c.body(svg, 200, { "Content-Type": "image/svg+xml", "Cache-Control": "private, no-store" });
  });

  /** A printable A4 poster to stick up in the home. */
  app.get("/properties/:id/repair-poster", async (c) => {
    const id = intId(c);
    const p = id ? await get<{ id: number; name: string; address: string | null }>("SELECT id, name, address FROM properties WHERE id = ?", [id]) : undefined;
    const t = p ? await tokenFor(p.id) : null;
    if (!p || !t) return c.text("Unknown property", 404);
    const url = `${new URL(c.req.url).origin}/r/${t}`;
    return c.html(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Repair poster · ${esc(homeName(p))}</title>
<link href="https://fonts.googleapis.com/css2?family=Figtree:wght@400;600&family=Newsreader:opsz,wght@6..72,500&display=swap" rel="stylesheet">
<style>@page{size:A4;margin:18mm}body{margin:0;font-family:Figtree,sans-serif;color:#13202e;text-align:center}
.bar{background:#0e2133;color:#fff;padding:18px;border-radius:14px;display:flex;align-items:center;justify-content:center;gap:12px}
.bar img{width:44px;height:44px;border-radius:9px}.bar b{font-family:Newsreader,serif;font-weight:500;font-size:28px}
h1{font-family:Newsreader,serif;font-weight:500;font-size:46px;margin:34px 0 8px}p{font-size:19px;color:#3d4a59;margin:6px 0}
.qr{width:300px;height:300px;margin:28px auto 12px}.url{font-size:13px;color:#5b6878;word-break:break-all}
.steps{margin:28px auto 0;max-width:460px;text-align:left;font-size:17px;line-height:1.7}
.em{margin-top:30px;padding:14px;border:2px solid #e1363a;border-radius:12px;font-size:16px}
.print{margin:20px;font:inherit;padding:10px 16px;border:0;border-radius:8px;background:#0b7cc2;color:#fff;cursor:pointer}
@media print{.print{display:none}}</style></head><body>
<button class="print" onclick="window.print()">Print poster</button>
<div class="bar"><img src="/brand/favicon.svg" alt=""><b>Chisti &amp; Co.</b></div>
<h1>Something needs fixing?</h1><p>${esc(homeName(p))}</p>
<img class="qr" src="/properties/${p.id}/qr.svg" alt="QR code to report a repair">
<p><b>Scan with your phone camera</b> to tell us about a repair and send photos.</p>
<div class="url">${esc(url)}</div>
<ol class="steps"><li>Point your phone camera at the code and tap the link.</li><li>Tell us what's wrong and where.</li><li>Add a photo if you can, then press Send.</li></ol>
<div class="em"><b>Gas smell, no electricity, flooding or fire?</b> Call the emergency number in your tenancy pack straight away: don't wait for a reply here.</div>
</body></html>`);
  });

  // Public: the form a tenant fills in.
  app.get("/r/:token", async (c) => {
    const p = await get<{ id: number; name: string; address: string | null }>("SELECT id, name, address FROM properties WHERE report_token = ?", [c.req.param("token")]);
    if (!p) return c.html(page("Link not recognised", `<div class="card"><h1>This link isn't working</h1><p class="sub">Ask your landlord for the latest repair poster or link.</p></div>`), 404);
    return c.html(page(`Report a repair · ${homeName(p)}`, `<div class="card">
<h1>Report a repair</h1><p class="sub">${esc(homeName(p))}</p>
<form method="post" enctype="multipart/form-data">
<label for="what">What's the problem?</label>
<textarea id="what" name="description" required maxlength="3000" placeholder="e.g. The kitchen tap is dripping and won't turn off fully."></textarea>
<label for="where">Where in the home?</label>
<input id="where" name="location" maxlength="120" placeholder="e.g. Kitchen, Room 3, bathroom">
<label for="urg">How urgent is it?</label>
<select id="urg" name="priority"><option value="normal">It can wait a few days</option><option value="high">It needs doing soon</option><option value="urgent">It's urgent (no heating, hot water, leak…)</option></select>
<label for="photos">Photos (optional)</label>
<input id="photos" name="photos" type="file" accept="image/*" multiple>
<div class="hint">Up to 4 photos.</div>
<label for="name">Your name</label>
<input id="name" name="name" required maxlength="80" autocomplete="name">
<label for="contact">Phone or email</label>
<input id="contact" name="contact" required maxlength="120" autocomplete="tel" placeholder="So we can arrange a visit">
<input class="hp" name="website" tabindex="-1" autocomplete="off" aria-hidden="true">
<div class="urgent"><b>Gas smell, no electricity, flooding or fire?</b> Call the emergency number in your tenancy pack now.</div>
<button type="submit">Send to Chisti &amp; Co.</button>
</form></div>`));
  });

  app.post("/r/:token", async (c) => {
    const token = c.req.param("token");
    const p = await get<{ id: number; name: string; address: string | null }>("SELECT id, name, address FROM properties WHERE report_token = ?", [token]);
    if (!p) return c.html(page("Link not recognised", `<div class="card"><h1>This link isn't working</h1><p class="sub">Ask your landlord for the latest repair poster or link.</p></div>`), 404);
    const f = (await c.req.parseBody({ all: true }).catch(() => ({}))) as Record<string, unknown>;
    const one = (k: string) => String(Array.isArray(f[k]) ? (f[k] as unknown[])[0] : f[k] ?? "").trim();
    if (one("website")) return c.html(page("Sent", `<div class="card"><h1>Thanks</h1></div>`)); // a bot filled the hidden field
    const description = one("description").slice(0, 3000);
    const name = one("name").slice(0, 80);
    const contact = one("contact").slice(0, 120);
    if (!description || !name || !contact) {
      return c.html(page("Missing details", `<div class="card"><h1>A few details are missing</h1><p class="sub">Please go back and fill in the problem, your name and a phone number or email.</p></div>`), 400);
    }
    if (tooMany(`${token}|${c.req.header("x-forwarded-for") ?? ""}`)) {
      return c.html(page("Please wait", `<div class="card"><h1>We've had a few reports already</h1><p class="sub">Please try again in an hour, or call us if it's urgent.</p></div>`), 429);
    }
    const location = one("location").slice(0, 120);
    const priority = ["normal", "high", "urgent"].includes(one("priority")) ? one("priority") : "normal";
    const title = `${location ? `${location}: ` : ""}${description.replace(/\s+/g, " ").slice(0, 80)}${description.length > 80 ? "…" : ""}`;
    const r = await run(
      `INSERT INTO work_orders (property_id, title, description, priority, status, source, reported_by, reporter_contact)
       VALUES (?, ?, ?, ?, 'open', 'tenant', ?, ?)`,
      [p.id, title, description, priority, name, contact],
    );
    const files = (Array.isArray(f.photos) ? f.photos : [f.photos]).filter((x): x is File => x instanceof File && x.size > 0).slice(0, 4);
    let saved = 0;
    for (const file of files) {
      const res = await saveUpload(file, { property_id: p.id, kind: "repair", work_order_id: r.lastInsertRowid, label: name, uploaded_by: `Tenant: ${name}` }, { maxBytes: 10 * 1024 * 1024, imagesOnly: true });
      if (res.ok) saved++;
    }
    console.log(`Repair request from a tenant at property ${p.id} (work order ${r.lastInsertRowid}, ${saved} photo(s)).`);
    return c.html(page("Sent", `<div class="card"><h1>Thanks, ${esc(name.split(" ")[0])}</h1>
<p class="sub">We've got your report${saved ? ` and ${saved} photo${saved === 1 ? "" : "s"}` : ""} for ${esc(homeName(p))}. We'll be in touch on ${esc(contact)} to arrange it.</p>
${files.length > saved ? `<p class="hint">${files.length - saved} photo(s) couldn't be added (too large or not a photo).</p>` : ""}</div>`));
  });

  // Signed-in: photos sent with a repair request.
  app.get("/api/work-orders/:id/photos", async (c) => {
    const id = intId(c);
    const rows = id ? await query<DocRow>("SELECT * FROM compliance_documents WHERE work_order_id = ? ORDER BY id", [id]) : [];
    return c.json({ photos: rows.map(publicRow) });
  });
}

export function registerExtras(app: AnyApp) {
  registerAccess(app);
  registerVoids(app);
  registerRepairs(app);
}
