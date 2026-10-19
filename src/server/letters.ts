// Letters & contracts: arrears letters, eviction cover letters, tenancy and
// company-let agreements made from templates in the app (the templates live
// in the client, src/client/components/letters/templates.ts), plus signed
// copies uploaded against them. The finished text is stored as HTML so it can
// be edited, printed or saved as PDF later exactly as it was sent.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";
import { getUser } from "./auth";

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

export function registerLetters(app: AnyApp) {
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
