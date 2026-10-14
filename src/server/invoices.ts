// Invoices: drafts, a branded printable invoice, and sending by email.
//
// Nothing is ever emailed without a person pressing Send (POST
// /api/invoices/:id/send). The assistant can only create drafts.
// Email goes out through Resend (https://resend.com) when RESEND_API_KEY and
// INVOICE_FROM_EMAIL are set.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, initDB, query, run } from "./db";

export interface InvoiceEnv {
  RESEND_API_KEY?: string;
  INVOICE_FROM_EMAIL?: string;
}

export interface InvoiceItem {
  description: string;
  amount: number;
}

export interface InvoiceRow {
  id: number;
  number: string;
  property_id: number | null;
  bill_to_name: string;
  bill_to_email: string | null;
  bill_to_address: string | null;
  issue_date: string;
  due_date: string;
  items: string;
  notes: string | null;
  status: string;
  sent_at: string | null;
  sent_to: string | null;
  sent_from: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  property_name?: string | null;
  property_address?: string | null;
  property_ref?: string | null;
}

export const COMPANY_KEYS = [
  "company_name", "company_address", "company_email", "company_phone",
  "bank_account_name", "bank_name", "bank_sort_code", "bank_account_number",
  "invoice_prefix", "invoice_terms_days", "invoice_footer", "sender_emails",
] as const;

const COMPANY_DEFAULTS: Record<string, string> = {
  company_name: "Chisti & Co.",
  company_address: "Ilford",
  invoice_prefix: "CC-",
  invoice_terms_days: "14",
};

export async function companySettings(): Promise<Record<string, string>> {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings").catch(() => []);
  const out: Record<string, string> = { ...COMPANY_DEFAULTS };
  for (const r of rows) if ((COMPANY_KEYS as readonly string[]).includes(r.key)) out[r.key] = r.value;
  return out;
}

const INVOICE_SELECT = `
  SELECT i.*, p.name AS property_name, p.address AS property_address, p.ref AS property_ref
  FROM invoices i LEFT JOIN properties p ON p.id = i.property_id
`;

const today = () => new Date().toISOString().slice(0, 10);
const plusDays = (iso: string, days: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

function parseItems(raw: string): InvoiceItem[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.map((x) => ({ description: String(x.description ?? ""), amount: Number(x.amount) || 0 })) : [];
  } catch {
    return [];
  }
}

export function invoiceTotal(inv: InvoiceRow): number {
  return parseItems(inv.items).reduce((a, i) => a + i.amount, 0);
}

async function nextNumber(): Promise<string> {
  const { invoice_prefix } = await companySettings();
  const prefix = invoice_prefix || "CC-";
  const row = await get<{ n: number }>("SELECT COUNT(*) AS n FROM invoices");
  let n = Number(row?.n ?? 0) + 1;
  // Skip any number already used (e.g. after deletions).
  for (;;) {
    const candidate = `${prefix}${String(n).padStart(4, "0")}`;
    const clash = await get("SELECT id FROM invoices WHERE number = ?", [candidate]);
    if (!clash) return candidate;
    n++;
  }
}

export const InvoiceInput = z.object({
  property_id: z.number().int().nullable().optional(),
  bill_to_name: z.string().min(1),
  bill_to_email: z.string().email().optional().nullable().or(z.literal("")),
  bill_to_address: z.string().optional().nullable(),
  issue_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  due_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  items: z.array(z.object({ description: z.string().min(1), amount: z.number() })).min(1),
  notes: z.string().optional().nullable(),
});

export type InvoiceInputT = z.infer<typeof InvoiceInput>;

/** Create a draft. Used by the Invoices page and by the assistant. */
export async function createInvoiceDraft(d: InvoiceInputT, createdBy: "you" | "assistant"): Promise<InvoiceRow> {
  const { invoice_terms_days } = await companySettings();
  const issue = d.issue_date ?? today();
  const due = d.due_date ?? plusDays(issue, Number(invoice_terms_days) || 14);
  const number = await nextNumber();
  const r = await run(
    `INSERT INTO invoices (number, property_id, bill_to_name, bill_to_email, bill_to_address, issue_date, due_date, items, notes, status, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', ?)`,
    [number, d.property_id ?? null, d.bill_to_name, d.bill_to_email || null, d.bill_to_address ?? null, issue, due, JSON.stringify(d.items), d.notes ?? null, createdBy],
  );
  return (await get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [r.lastInsertRowid]))!;
}

// ── The invoice itself, as HTML (print view and email body) ────────

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const gbp = (n: number) => new Intl.NumberFormat("en-GB", { style: "currency", currency: "GBP" }).format(n);
const ukDate = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

export function renderInvoiceHtml(inv: InvoiceRow, co: Record<string, string>, opts: { forEmail?: boolean; logoUrl?: string } = {}): string {
  const items = parseItems(inv.items);
  const total = items.reduce((a, i) => a + i.amount, 0);
  const lines = (s: string | null | undefined) => esc(s).replace(/\n/g, "<br>");
  const bank = [
    co.bank_account_name && `Account name: ${esc(co.bank_account_name)}`,
    co.bank_name && `Bank: ${esc(co.bank_name)}`,
    co.bank_sort_code && `Sort code: ${esc(co.bank_sort_code)}`,
    co.bank_account_number && `Account number: ${esc(co.bank_account_number)}`,
    `Reference: ${esc(inv.number)}`,
  ].filter(Boolean).join("<br>");
  const property = inv.property_address || inv.property_name;
  const body = `
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:680px;margin:0 auto;background:#ffffff;border:1px solid #d9e3ea;border-radius:10px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#14212b">
  <tr><td style="background:#0b7cc2;padding:22px 28px;color:#ffffff">
    <table role="presentation" width="100%"><tr>
      <td style="vertical-align:middle">
        ${opts.logoUrl ? `<img src="${esc(opts.logoUrl)}" alt="${esc(co.company_name)}" height="64" style="display:block;border-radius:6px">` : `<div style="font-family:Georgia,serif;font-size:26px">${esc(co.company_name)}</div>`}
      </td>
      <td style="text-align:right;vertical-align:middle">
        <div style="font-size:22px;font-weight:bold;letter-spacing:1px">INVOICE</div>
        <div style="font-size:14px;opacity:.9">${esc(inv.number)}</div>
      </td>
    </tr></table>
  </td></tr>
  <tr><td style="padding:24px 28px">
    <table role="presentation" width="100%" style="font-size:14px;line-height:1.5"><tr>
      <td style="vertical-align:top;width:50%">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5c6b77">Billed to</div>
        <div style="font-weight:bold">${esc(inv.bill_to_name)}</div>
        ${inv.bill_to_address ? `<div>${lines(inv.bill_to_address)}</div>` : ""}
        ${inv.bill_to_email ? `<div style="color:#5c6b77">${esc(inv.bill_to_email)}</div>` : ""}
      </td>
      <td style="vertical-align:top;text-align:right">
        <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5c6b77">From</div>
        <div style="font-weight:bold">${esc(co.company_name)}</div>
        ${co.company_address ? `<div>${lines(co.company_address)}</div>` : ""}
        ${co.company_email ? `<div style="color:#5c6b77">${esc(co.company_email)}</div>` : ""}
        ${co.company_phone ? `<div style="color:#5c6b77">${esc(co.company_phone)}</div>` : ""}
      </td>
    </tr></table>
    <table role="presentation" width="100%" style="margin-top:18px;font-size:14px;background:#eef4f9;border-radius:8px"><tr>
      <td style="padding:10px 14px"><span style="color:#5c6b77">Issued</span><br><b>${ukDate(inv.issue_date)}</b></td>
      <td style="padding:10px 14px"><span style="color:#5c6b77">Due</span><br><b>${ukDate(inv.due_date)}</b></td>
      ${property ? `<td style="padding:10px 14px"><span style="color:#5c6b77">Property</span><br><b>${esc(property)}</b></td>` : ""}
    </tr></table>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:20px;font-size:14px;border-collapse:collapse">
      <tr>
        <th align="left" style="padding:8px 0;border-bottom:2px solid #14212b;font-size:12px;text-transform:uppercase;letter-spacing:1px">Description</th>
        <th align="right" style="padding:8px 0;border-bottom:2px solid #14212b;font-size:12px;text-transform:uppercase;letter-spacing:1px">Amount</th>
      </tr>
      ${items.map((i) => `<tr><td style="padding:10px 0;border-bottom:1px solid #d9e3ea">${esc(i.description)}</td><td align="right" style="padding:10px 0;border-bottom:1px solid #d9e3ea;white-space:nowrap">${gbp(i.amount)}</td></tr>`).join("")}
      <tr><td align="right" style="padding:14px 0 0;font-weight:bold">Total due</td><td align="right" style="padding:14px 0 0;font-size:20px;font-weight:bold;color:#0b7cc2;white-space:nowrap">${gbp(total)}</td></tr>
    </table>
    <div style="margin-top:24px;padding:14px;border:1px solid #d9e3ea;border-radius:8px;font-size:13px;line-height:1.6">
      <div style="font-size:11px;text-transform:uppercase;letter-spacing:1px;color:#5c6b77;margin-bottom:4px">How to pay</div>
      ${bank}
    </div>
    ${inv.notes ? `<p style="margin-top:18px;font-size:13px;line-height:1.6">${lines(inv.notes)}</p>` : ""}
    ${co.invoice_footer ? `<p style="margin-top:18px;font-size:12px;color:#5c6b77">${lines(co.invoice_footer)}</p>` : ""}
  </td></tr>
</table>`;
  if (opts.forEmail) {
    return `<!doctype html><html><body style="margin:0;padding:24px 12px;background:#eef4f9">${body}</body></html>`;
  }
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(inv.number)} · ${esc(co.company_name)}</title>
<style>body{margin:0;padding:24px 12px;background:#eef4f9}.bar{max-width:680px;margin:0 auto 12px;text-align:right;font-family:Arial,sans-serif}
.bar button{background:#0b7cc2;color:#fff;border:0;border-radius:6px;padding:8px 14px;font-size:14px;cursor:pointer}
@media print{body{background:#fff;padding:0}.bar{display:none}table{border:0!important}}</style></head>
<body><div class="bar"><button onclick="window.print()">Print / save as PDF</button></div>${body}</body></html>`;
}

// ── Email ──────────────────────────────────────────────────────────

const EMAIL_RE = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
const domainOf = (email: string) => email.split("@")[1]?.toLowerCase() ?? "";

/** Addresses offered in the From box: the saved list, then the default. */
export async function senderOptions(env: InvoiceEnv): Promise<{ senders: string[]; default: string | null }> {
  const { sender_emails } = await companySettings();
  const saved = (sender_emails ?? "")
    .split(/[\n,;]+/)
    .map((s) => s.trim())
    .filter((s) => EMAIL_RE.test(s));
  const def = env.INVOICE_FROM_EMAIL?.trim() || saved[0] || null;
  const all = [...new Set([...(def ? [def] : []), ...saved])];
  return { senders: all, default: def };
}

/**
 * Email an invoice from `from`. Resend only sends from domains verified in
 * your Resend account, so `from` must be on one of those (e.g. any
 * @chistiandco.com address once chistiandco.com is verified).
 */
export async function sendInvoiceEmail(env: InvoiceEnv, inv: InvoiceRow, to: string, from: string, logoUrl: string): Promise<void> {
  if (!env.RESEND_API_KEY) {
    throw new Error("Email isn't set up yet: add RESEND_API_KEY in Render.");
  }
  const co = await companySettings();
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from: `${co.company_name} <${from}>`,
      to: [to],
      // Replies go back to whoever it was sent from.
      reply_to: from,
      subject: `Invoice ${inv.number} from ${co.company_name} · ${gbp(invoiceTotal(inv))} due ${ukDate(inv.due_date)}`,
      html: renderInvoiceHtml(inv, co, { forEmail: true, logoUrl }),
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    if (/domain/i.test(text) && /verif/i.test(text)) {
      throw new Error(`Can't send from ${from}: the domain ${domainOf(from)} isn't verified in Resend. Use an address on a verified domain, or add ${domainOf(from)} in Resend → Domains.`);
    }
    throw new Error(`The email service refused it (${res.status}): ${text.slice(0, 200)}`);
  }
}

// ── Routes ─────────────────────────────────────────────────────────

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerInvoiceRoutes(app: Hono<any>) {
  const intId = (c: Context) => {
    const n = parseInt(c.req.param("id") ?? "", 10);
    return Number.isFinite(n) ? n : null;
  };

  app.get("/api/invoices", async (c) => {
    const rows = await query<InvoiceRow>(`${INVOICE_SELECT} ORDER BY i.id DESC`).catch(() => [] as InvoiceRow[]);
    return c.json({ invoices: rows.map((r) => ({ ...r, items: parseItems(r.items), total: invoiceTotal(r) })) });
  });

  app.get("/api/invoices/senders", async (c) => c.json(await senderOptions(c.env as InvoiceEnv)));

  app.get("/api/invoices/:id", async (c) => {
    const id = intId(c);
    const r = id ? await get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [id]) : undefined;
    if (!r) return c.json({ error: "Not found" }, 404);
    return c.json({ invoice: { ...r, items: parseItems(r.items), total: invoiceTotal(r) } });
  });

  app.post("/api/invoices", async (c) => {
    const parsed = InvoiceInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    const inv = await createInvoiceDraft(parsed.data, "you");
    return c.json({ invoice: { ...inv, items: parseItems(inv.items), total: invoiceTotal(inv) } }, 201);
  });

  app.put("/api/invoices/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const body = await c.req.json().catch(() => null);
    const Patch = InvoiceInput.partial().extend({ status: z.enum(["draft", "sent", "paid", "void"]).optional() });
    const parsed = Patch.safeParse(body);
    if (!parsed.success) return c.json({ error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, 400);
    const d = parsed.data;
    const sets: string[] = [];
    const params: unknown[] = [];
    const put = (col: string, v: unknown) => { sets.push(`${col} = ?`); params.push(v); };
    if (d.property_id !== undefined) put("property_id", d.property_id);
    if (d.bill_to_name !== undefined) put("bill_to_name", d.bill_to_name);
    if (d.bill_to_email !== undefined) put("bill_to_email", d.bill_to_email || null);
    if (d.bill_to_address !== undefined) put("bill_to_address", d.bill_to_address);
    if (d.issue_date !== undefined) put("issue_date", d.issue_date);
    if (d.due_date !== undefined) put("due_date", d.due_date);
    if (d.items !== undefined) put("items", JSON.stringify(d.items));
    if (d.notes !== undefined) put("notes", d.notes);
    if (d.status !== undefined) {
      put("status", d.status);
      if (d.status === "paid") put("paid_at", new Date().toISOString());
    }
    if (!sets.length) return c.json({ error: "No fields" }, 400);
    params.push(id);
    const r = await run(`UPDATE invoices SET ${sets.join(", ")} WHERE id = ?`, params);
    if (!r.changes) return c.json({ error: "Not found" }, 404);
    const inv = (await get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [id]))!;
    return c.json({ invoice: { ...inv, items: parseItems(inv.items), total: invoiceTotal(inv) } });
  });

  app.delete("/api/invoices/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const r = await run("DELETE FROM invoices WHERE id = ? AND status = 'draft'", [id]);
    if (!r.changes) return c.json({ error: "Only drafts can be deleted. Mark a sent invoice as void instead." }, 400);
    return c.json({ ok: true });
  });

  /** The one route that emails anything. Only a person pressing Send reaches it. */
  app.post("/api/invoices/:id/send", async (c) => {
    const id = intId(c);
    const inv = id ? await get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [id]) : undefined;
    if (!inv) return c.json({ error: "Not found" }, 404);
    if (inv.status === "void") return c.json({ error: "This invoice is void." }, 400);
    const body = (await c.req.json().catch(() => ({}))) as { to?: string; from?: string };
    const to = (body.to || inv.bill_to_email || "").trim();
    if (!EMAIL_RE.test(to)) return c.json({ error: "Add a valid email address to send to." }, 400);
    const from = (body.from || (await senderOptions(c.env as InvoiceEnv)).default || "").trim();
    if (!EMAIL_RE.test(from)) return c.json({ error: "Add the email address to send from." }, 400);
    try {
      const origin = new URL(c.req.url).origin;
      await sendInvoiceEmail(c.env as InvoiceEnv, inv, to, from, `${origin}/brand/chisti-logo.jpg`);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 502);
    }
    await run(
      "UPDATE invoices SET status = CASE WHEN status = 'paid' THEN 'paid' ELSE 'sent' END, sent_at = ?, sent_to = ?, sent_from = ? WHERE id = ?",
      [new Date().toISOString(), to, from, inv.id],
    );
    const updated = (await get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [inv.id]))!;
    return c.json({ invoice: { ...updated, items: parseItems(updated.items), total: invoiceTotal(updated) } });
  });

  /** Printable invoice (behind the login, like everything else). */
  app.get("/invoices/:id/print", async (c) => {
    initDB(c.env as { DB?: D1Database });
    const id = intId(c);
    const inv = id ? await get<InvoiceRow>(`${INVOICE_SELECT} WHERE i.id = ?`, [id]) : undefined;
    if (!inv) return c.text("Invoice not found", 404);
    return c.html(renderInvoiceHtml(inv, await companySettings(), { logoUrl: "/brand/chisti-logo.jpg" }));
  });
}
