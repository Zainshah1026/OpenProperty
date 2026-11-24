// Letters & contracts: arrears letters, eviction cover letters, tenancy and
// company-let agreements made from templates in the app (the templates live
// in the client, src/client/components/letters/templates.ts), plus signed
// copies uploaded against them. The finished text is stored as HTML so it can
// be edited, printed or saved as PDF later exactly as it was sent.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";
import { getUser } from "./auth";
import { getMailer, signatureFor, signatureHtml } from "./lead-email";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

const CATEGORIES = ["tenancy", "company", "arrears"] as const;
const STATUSES = ["draft", "sent", "signed", "void"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();

const LetterInput = z.object({
  template: z.string().min(1).max(60),
  category: z.enum(CATEGORIES),
  title: z.string().min(1).max(200),
  property_id: z.number().int().optional().nullable(),
  tenant_id: z.number().int().optional().nullable(),
  room: z.string().max(100).optional().nullable(),
  body: z.string().max(400_000).optional().nullable(),
  fields: z.record(z.string(), z.unknown()).optional().nullable(),
  status: z.enum(STATUSES).optional(),
  sent_on: isoDate,
  signed_on: isoDate,
});

/**
 * Letters are written by signed-in staff, but the text is shown back as HTML,
 * so anything that could run code is removed before it is stored.
 */
export function cleanHtml(html: string): string {
  return html
    .replace(/<\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*>[\s\S]*?<\s*\/\s*\1\s*>/gi, "")
    .replace(/<\s*\/?\s*(script|style|iframe|object|embed|link|meta|base|form|input|button|textarea|select)\b[^>]*>/gi, "")
    .replace(/\son[a-z]+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "")
    .replace(/(href|src)\s*=\s*("|')\s*(javascript|data|vbscript):[^"']*\2/gi, '$1="#"');
}

const intId = (c: Context) => {
  const n = parseInt(c.req.param("id") ?? "", 10);
  return Number.isFinite(n) ? n : null;
};

const SELECT = `
  SELECT l.id, l.template, l.category, l.title, l.property_id, l.tenant_id, l.room, l.status, l.sent_on, l.signed_on,
         l.created_by, l.created_at, l.updated_at,
         p.name AS property_name, p.ref AS property_ref,
         CASE WHEN t.tenant_type = 'company' AND COALESCE(t.company_name, '') != '' THEN t.company_name
              ELSE TRIM(COALESCE(t.first_name, '') || ' ' || COALESCE(t.last_name, '')) END AS tenant_name,
         (SELECT COUNT(*) FROM compliance_documents d WHERE d.letter_id = l.id) AS file_count
  FROM letters l
  LEFT JOIN properties p ON p.id = l.property_id
  LEFT JOIN tenants t ON t.id = l.tenant_id`;

// Same look as the printed letter (kept in step with LETTER_CSS in the client templates).
const EMAIL_LETTER_CSS = `
.letter-doc { font-family: Georgia, "Times New Roman", serif; font-size: 15px; line-height: 1.55; color: #16202b; }
.letter-doc h1 { font-size: 24px; margin: 0 0 6px; font-weight: 600; }
.letter-doc h2 { font-size: 17px; margin: 22px 0 8px; font-weight: 600; }
.letter-doc h3 { font-size: 15px; margin: 18px 0 6px; font-weight: 600; }
.letter-doc p { margin: 0 0 10px; }
.letter-doc .center { text-align: center; }
.letter-doc .muted { color: #5b6876; font-size: 13px; }
.letter-doc .lh { border-bottom: 2px solid #0e2133; padding-bottom: 10px; margin-bottom: 18px; text-align: right; }
.letter-doc .lh-name { font-size: 22px; font-weight: 600; color: #0e2133; }
.letter-doc .lh-addr { font-size: 12.5px; color: #5b6876; font-family: Arial, sans-serif; }
.letter-doc .meta .date { text-align: right; }
.letter-doc .indent { padding-left: 18px; border-left: 3px solid #d7dde4; }
.letter-doc .box { border: 1px solid #d7dde4; background: #f6f8fa; padding: 10px 14px; margin: 14px 0; font-size: 13.5px; }
.letter-doc table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 14px; }
.letter-doc table.facts th { text-align: left; vertical-align: top; width: 34%; padding: 6px 10px 6px 0; color: #3b4754; border-bottom: 1px solid #e3e7ec; }
.letter-doc table.facts td { padding: 6px 0; border-bottom: 1px solid #e3e7ec; }
.letter-doc table.sched th, .letter-doc table.sched td { border-bottom: 1px solid #e3e7ec; padding: 5px 8px; text-align: left; }
.letter-doc table.sigs td { padding: 26px 12px 6px 0; vertical-align: bottom; font-size: 13.5px; }
.letter-doc table.sigs .line { border-bottom: 1px solid #16202b; height: 26px; margin-bottom: 4px; }
.letter-doc .gap { display: inline-block; border-bottom: 1px dotted #8a96a3; min-width: 60px; }
.letter-doc .pagebreak { height: 1px; border-top: 1px dashed #d7dde4; margin: 28px 0; }
`;

const esc = (s: string) => s.replace(/[&<>"]/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[ch]!);
const htmlToText = (html: string) =>
  html.replace(/<\s*br\s*\/?>/gi, "\n").replace(/<\/(p|div|h[1-6]|li|tr)>/gi, "\n").replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

/** Who a letter would normally go to: the tenant, else the home's or room's email. */
async function defaultRecipient(letter: { tenant_id: number | null; property_id: number | null; room: string | null }) {
  if (letter.tenant_id) {
    const t = await get<{ email: string | null }>("SELECT email FROM tenants WHERE id = ?", [letter.tenant_id]);
    if (t?.email) return t.email;
  }
  if (letter.property_id && letter.room) {
    const r = await get<{ tenant_email: string | null }>("SELECT tenant_email FROM rooms WHERE property_id = ? AND LOWER(room) = LOWER(?) AND tenant_email IS NOT NULL", [letter.property_id, letter.room]);
    if (r?.tenant_email) return r.tenant_email;
  }
  if (letter.property_id) {
    const p = await get<{ tenant_email: string | null }>("SELECT tenant_email FROM properties WHERE id = ?", [letter.property_id]);
    if (p?.tenant_email) return p.tenant_email;
  }
  return "";
}

const EmailInput = z.object({
  to: z.string().trim().email("That email address doesn't look right."),
  from: z.string().trim().email().optional(),
  subject: z.string().trim().min(1).max(200),
  message: z.string().max(5000).optional().nullable(),
});

export function registerLetters(app: AnyApp) {
  app.get("/api/letters/:id/email", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const l = await get<{ title: string; tenant_id: number | null; property_id: number | null; room: string | null }>("SELECT title, tenant_id, property_id, room FROM letters WHERE id = ?", [id]);
    if (!l) return c.json({ error: "Not found" }, 404);
    const senders = getMailer()?.senders() ?? [];
    const me = getUser(c)?.mailboxes?.[0]?.toLowerCase();
    const from = senders.find((s) => s.toLowerCase() === me) ?? senders.find((s) => /^zain@/i.test(s)) ?? senders[0] ?? null;
    return c.json({ to: await defaultRecipient(l), from, senders, subject: l.title });
  });

  app.post("/api/letters/:id/email", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = EmailInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const mailer = getMailer();
    const senders = mailer?.senders() ?? [];
    if (!mailer || !senders.length) return c.json({ error: "No company mailbox is connected for sending." }, 400);
    const d = parsed.data;
    const from = d.from && senders.some((s) => s.toLowerCase() === d.from!.toLowerCase()) ? d.from : senders.find((s) => /^zain@/i.test(s)) ?? senders[0];
    const l = await get<{ body: string | null; status: string; sent_on: string | null }>("SELECT body, status, sent_on FROM letters WHERE id = ?", [id]);
    if (!l) return c.json({ error: "Not found" }, 404);
    if (!l.body?.trim()) return c.json({ error: "This letter has no text to send." }, 400);
    const letterHtml = cleanHtml(l.body);
    const note = d.message?.trim() ?? "";
    const sig = signatureFor(from, getUser(c)?.name ?? undefined);
    const html = `<!doctype html><html><head><meta charset="utf-8"><style>${EMAIL_LETTER_CSS}</style></head><body style="margin:0;padding:16px;background:#ffffff">
${note ? `<div style="font-family:Arial,sans-serif;font-size:14px;line-height:1.5;color:#16202b;margin-bottom:20px">${esc(note).replace(/\n/g, "<br>")}${signatureHtml(from, sig)}</div><hr style="border:0;border-top:1px solid #d7dde4;margin:0 0 24px">` : ""}
<div class="letter-doc" style="max-width:720px">${letterHtml}</div></body></html>`;
    const text = `${note ? `${note}\n\n${sig.name}${sig.title ? `\n${sig.title}` : ""}\n\n----------\n\n` : ""}${htmlToText(letterHtml)}`;
    try {
      await mailer.send({ from, fromName: sig.name, to: d.to, subject: d.subject, html, text });
    } catch (err) {
      return c.json({ error: `Couldn't send: ${(err as Error).message}` }, 502);
    }
    const today = new Date().toISOString().slice(0, 10);
    await run(
      `UPDATE letters SET status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_on = COALESCE(sent_on, ?), updated_at = datetime('now') WHERE id = ?`,
      [today, id],
    );
    console.log(`Letter ${id} emailed to ${d.to} from ${from}.`);
    return c.json({ ok: true, from, to: d.to, letter: await get(`${SELECT} WHERE l.id = ?`, [id]) });
  });

  app.get("/api/letters", async (c) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const pid = parseInt(c.req.query("property_id") ?? "", 10);
    if (Number.isFinite(pid)) { where.push("l.property_id = ?"); params.push(pid); }
    const tid = parseInt(c.req.query("tenant_id") ?? "", 10);
    if (Number.isFinite(tid)) { where.push("l.tenant_id = ?"); params.push(tid); }
    const rows = await query(`${SELECT} ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY l.updated_at DESC, l.id DESC`, params)
      .catch(() => []);
    return c.json({ letters: rows });
  });

  app.get("/api/letters/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const row = await get<Record<string, unknown>>(`${SELECT.replace("l.created_by,", "l.created_by, l.body, l.fields,")} WHERE l.id = ?`, [id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    let fields: unknown = null;
    try { fields = row.fields ? JSON.parse(String(row.fields)) : null; } catch { /* keep null */ }
    return c.json({ letter: { ...row, fields } });
  });

  app.post("/api/letters", async (c) => {
    const parsed = LetterInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const d = parsed.data;
    const r = await run(
      `INSERT INTO letters (template, category, title, property_id, tenant_id, room, body, fields, status, sent_on, signed_on, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        d.template, d.category, d.title, d.property_id ?? null, d.tenant_id ?? null, d.room ?? null,
        d.body ? cleanHtml(d.body) : null, d.fields ? JSON.stringify(d.fields) : null,
        d.status ?? "draft", d.sent_on ?? null, d.signed_on ?? null, getUser(c)?.name ?? null,
      ],
    );
    const row = await get(`${SELECT} WHERE l.id = ?`, [r.lastInsertRowid]);
    return c.json({ letter: row }, 201);
  });

  app.put("/api/letters/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = LetterInput.partial().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const [k, v] of Object.entries(parsed.data)) {
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(k === "body" && typeof v === "string" ? cleanHtml(v) : k === "fields" && v ? JSON.stringify(v) : v);
    }
    if (!sets.length) return c.json({ error: "No changes" }, 400);
    sets.push("updated_at = datetime('now')");
    const r = await run(`UPDATE letters SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    return c.json({ letter: await get(`${SELECT} WHERE l.id = ?`, [id]) });
  });

  app.delete("/api/letters/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const files = await get<{ n: number }>("SELECT COUNT(*) AS n FROM compliance_documents WHERE letter_id = ?", [id]);
    if (files && Number(files.n) > 0) return c.json({ error: "Delete the attached signed copies first." }, 409);
    const r = await run("DELETE FROM letters WHERE id = ?", [id]);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    return c.json({ ok: true });
  });
}
