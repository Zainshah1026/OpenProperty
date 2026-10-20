// Emailing lettings leads: one personal email per landlord ("Hi Narendra"),
// sent from a company mailbox with that person's signature, one at a time
// with a pause between each so the mail host doesn't treat it as bulk mail.
//
// Every send is recorded in lead_emails, so a campaign never goes to the same
// address twice (even if the server restarts mid-way), and landlords marked
// "do not email" are always skipped.

import type { Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";
import { getUser } from "./auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

export interface OutgoingMail {
  from: string;
  fromName?: string;
  to: string;
  subject: string;
  text: string;
  html: string;
  headers?: Record<string, string>;
}
export interface LeadMailer {
  senders(): string[];
  send(mail: OutgoingMail): Promise<void>;
}

let mailer: LeadMailer | null = null;
export function setLeadMailer(m: LeadMailer) { mailer = m; }

// ── Signatures ──────────────────────────────────────────────────────

interface Signature { name: string; title: string; phone: string }
const SIGNATURES: Record<string, Signature> = {
  "zain@chistiandco.com": { name: "Zain Shahid", title: "Lettings", phone: "07946 313320" },
  "nabeel@chistiandco.com": { name: "Nabeel Shahid", title: "Property Investor", phone: "07587 007048" },
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function signatureFor(from: string, fallbackName?: string): Signature {
  return SIGNATURES[from.toLowerCase()] ?? { name: fallbackName || "Chisti & Co.", title: "", phone: "" };
}

/** The light-blue panel signature with the Chisti & Co. logo (sent as an inline image). */
export function signatureHtml(from: string, sig: Signature): string {
  const f = "font-family:Helvetica,Arial,sans-serif;";
  const tel = sig.phone ? `+44${sig.phone.replace(/\s/g, "").replace(/^0/, "")}` : "";
  return `<table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:separate;${f}"><tr><td bgcolor="#E6F2FB" style="background-color:#E6F2FB;border-radius:12px;padding:18px 22px;"><table cellpadding="0" cellspacing="0" border="0" role="presentation" style="border-collapse:collapse;"><tr><td valign="middle" style="padding-right:28px;${f}"><div style="font-size:17px;font-weight:bold;color:#13222C;line-height:22px;">${esc(sig.name)}</div><div style="font-size:13px;color:#46565D;line-height:20px;">${sig.title ? `${esc(sig.title)} · ` : ""}Chisti &amp; Co.</div>${sig.phone ? `<div style="font-size:13px;color:#46565D;line-height:20px;padding-top:10px;"><a href="tel:${tel}" style="color:#46565D;text-decoration:none;">${esc(sig.phone)}</a></div>` : ""}<div style="font-size:13px;line-height:20px;"><a href="mailto:${esc(from)}" style="color:#0B6FAE;text-decoration:none;">${esc(from)}</a> <span style="color:#9AAAB4;">·</span> <a href="https://chistiandco.com" style="color:#0B6FAE;text-decoration:none;">chistiandco.com</a></div></td><td valign="middle"><img src="cid:chisti-logo" alt="Chisti &amp; Co. Ilford" width="140" height="87" style="display:block;width:140px;height:87px;border:0;border-radius:8px;"></td></tr></table></td></tr></table>`;
}

// ── The message ─────────────────────────────────────────────────────

const HONORIFIC = /^(mr|mrs|ms|miss|dr)\.?$/i;
const cap = (w: string) => (w === w.toLowerCase() || w === w.toUpperCase() ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w);

/** "narendra patel" → "Narendra"; "mr Shah" → "Mr Shah"; a handle like "SirNick_4" → null (use "Hello"). */
export function firstName(full: string): string | null {
  const parts = full.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  if (HONORIFIC.test(parts[0]) && parts[1]) return `${cap(parts[0].replace(/\.$/, ""))} ${cap(parts[parts.length - 1])}`;
  const w = parts[0];
  if (!/^[\p{L}'-]{2,}$/u.test(w)) return null;
  return cap(w);
}

const STOP_LINE = `If you'd rather not hear from us again, reply "stop" and we'll remove your details.`;

/** Plain text with blank-line paragraphs and "- " bullets → simple, email-safe HTML. */
function bodyHtml(text: string): string {
  const p = "margin:0 0 14px;font-family:Helvetica,Arial,sans-serif;font-size:15px;line-height:22px;color:#13222C;";
  return text
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split("\n");
      if (lines.every((l) => /^\s*[-•]\s+/.test(l))) {
        return `<ul style="${p}padding-left:22px;">${lines.map((l) => `<li style="margin:0 0 6px;">${esc(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>`;
      }
      const lead = lines.filter((l) => !/^\s*[-•]\s+/.test(l));
      const items = lines.filter((l) => /^\s*[-•]\s+/.test(l));
      const para = lead.length ? `<p style="${p}">${lead.map(esc).join("<br>")}</p>` : "";
      const list = items.length ? `<ul style="${p}padding-left:22px;">${items.map((l) => `<li style="margin:0 0 6px;">${esc(l.replace(/^\s*[-•]\s+/, ""))}</li>`).join("")}</ul>` : "";
      return para + list;
    })
    .join("");
}

export function composeLeadEmail(opts: { from: string; to: string; name: string; subject: string; body: string; senderName?: string }): OutgoingMail {
  const sig = signatureFor(opts.from, opts.senderName);
  const fn = firstName(opts.name);
  const greeting = fn ? `Hi ${fn},` : "Hello,";
  const body = opts.body.replace(/^\s*(hi|hello|dear)\s*\[first name\],?\s*/i, "").replace(/\[first name\]/gi, fn ?? "there").trim();
  const textSig = [sig.name, `${sig.title ? `${sig.title}, ` : ""}Chisti & Co.`, sig.phone, opts.from, "chistiandco.com"].filter(Boolean).join("\n");
  const text = `${greeting}\n\n${body}\n\n${textSig}\n\n${STOP_LINE}\n`;
  const html = `<!doctype html><html><body style="margin:0;padding:24px 16px;background:#ffffff;"><div style="max-width:600px;">${bodyHtml(`${greeting}\n\n${body}`)}<div style="margin-top:18px;">${signatureHtml(opts.from, sig)}</div><p style="margin:18px 0 0;font-family:Helvetica,Arial,sans-serif;font-size:12px;line-height:18px;color:#6E7E89;">${esc(STOP_LINE)}</p></div></body></html>`;
  return {
    from: opts.from,
    fromName: sig.name === "Chisti & Co." ? "Chisti & Co." : `${sig.name} | Chisti & Co.`,
    to: opts.to,
    subject: opts.subject,
    text,
    html,
    headers: { "List-Unsubscribe": `<mailto:${opts.from}?subject=stop>` },
  };
}

// ── The sending job ─────────────────────────────────────────────────

interface Job {
  campaign: string;
  from: string;
  total: number;
  sent: number;
  failed: number;
  skipped: number;
  current: string | null;
  running: boolean;
  cancelled: boolean;
  started_at: string;
  finished_at: string | null;
  error: string | null;
  failures: { name: string; email: string; error: string }[];
}
let job: Job | null = null;

const PAUSE_MS = Math.max(2000, Number(process.env.LEAD_EMAIL_PAUSE_MS || 10_000));
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const validEmail = (e: string | null) => !!e && /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e);

interface Recipient { id: number; name: string; email: string; first_name: string | null }

async function recipients(campaign: string, ids?: number[]): Promise<{ list: Recipient[]; already: number; no_email: number; opted_out: number }> {
  const rows = await query<{ id: number; name: string; email: string | null; do_not_email: number | null; status: string }>(
    "SELECT id, name, email, do_not_email, status FROM lettings_leads ORDER BY COALESCE(enquired_on, created_at) DESC, id DESC",
  );
  const sent = new Set(
    (await query<{ email: string }>("SELECT lower(email) AS email FROM lead_emails WHERE campaign = ? AND status = 'sent'", [campaign])).map((r) => r.email),
  );
  const seen = new Set<string>();
  const list: Recipient[] = [];
  let already = 0, noEmail = 0, optedOut = 0;
  for (const r of rows) {
    if (ids && !ids.includes(r.id)) continue;
    if (r.do_not_email || r.status === "not_interested") { optedOut++; continue; }
    if (!validEmail(r.email)) { noEmail++; continue; }
    const e = r.email!.trim().toLowerCase();
    if (sent.has(e)) { already++; continue; }
    if (seen.has(e)) continue; // same person twice in the list
    seen.add(e);
    list.push({ id: r.id, name: r.name, email: r.email!.trim(), first_name: firstName(r.name) });
  }
  return { list, already, no_email: noEmail, opted_out: optedOut };
}

const Compose = z.object({
  campaign: z.string().trim().min(1).max(80),
  from: z.string().trim().email(),
  subject: z.string().trim().min(1, "Add a subject").max(200),
  body: z.string().trim().min(1, "Write the email").max(20_000),
  ids: z.array(z.number().int()).max(2000).optional(),
});

export function registerLeadEmail(app: AnyApp) {
  app.get("/api/lettings-leads/email/status", async (c) => {
    const campaign = c.req.query("campaign") || "";
    const sentRows = await query<{ lead_id: number; email: string; sent_at: string; campaign: string }>(
      "SELECT lead_id, email, sent_at, campaign FROM lead_emails WHERE status = 'sent' ORDER BY sent_at DESC",
    ).catch(() => []);
    const r = campaign ? await recipients(campaign).catch(() => null) : null;
    return c.json({
      enabled: !!mailer,
      senders: mailer?.senders() ?? [],
      job,
      sent: sentRows,
      ...(r ? { to_send: r.list.length, already: r.already, no_email: r.no_email, opted_out: r.opted_out, recipients: r.list } : {}),
    });
  });

  app.post("/api/lettings-leads/email/test", async (c) => {
    if (!mailer) return c.json({ error: "Email sending isn't set up on this server." }, 503);
    const parsed = Compose.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const d = parsed.data;
    const me = getUser(c);
    const sample = (await recipients(d.campaign)).list[0];
    try {
      await mailer.send({
        ...composeLeadEmail({ from: d.from, to: d.from, name: sample?.name ?? me?.name ?? "", subject: `[Test] ${d.subject}`, body: d.body, senderName: me?.name }),
      });
    } catch (err) {
      return c.json({ error: `Couldn't send the test: ${(err as Error).message}` }, 502);
    }
    return c.json({ ok: true, sent_to: d.from, sample_name: sample?.name ?? null });
  });

  app.post("/api/lettings-leads/email/send", async (c) => {
    if (!mailer) return c.json({ error: "Email sending isn't set up on this server." }, 503);
    if (job?.running) return c.json({ error: "Emails are already being sent. Wait for that to finish." }, 409);
    const parsed = Compose.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const d = parsed.data;
    if (!mailer.senders().map((s) => s.toLowerCase()).includes(d.from.toLowerCase())) {
      return c.json({ error: `${d.from} isn't connected to the app.` }, 400);
    }
    const { list } = await recipients(d.campaign, d.ids);
    if (!list.length) return c.json({ error: "Everyone on the list has already been sent this email." }, 400);
    const me = getUser(c);
    job = {
      campaign: d.campaign, from: d.from, total: list.length, sent: 0, failed: 0, skipped: 0, current: null,
      running: true, cancelled: false, started_at: new Date().toISOString(), finished_at: null, error: null, failures: [],
    };
    const j = job;
    console.log(`Lead email "${d.campaign}": sending to ${list.length} from ${d.from} (started by ${me?.name ?? "unknown"})`);
    (async () => {
      let inARow = 0;
      for (const r of list) {
        if (j.cancelled) break;
        j.current = r.name;
        // Re-check just before sending, in case it went out from another tab.
        const dup = await get("SELECT id FROM lead_emails WHERE campaign = ? AND lower(email) = lower(?) AND status = 'sent'", [d.campaign, r.email]);
        if (dup) { j.skipped++; continue; }
        const mail = composeLeadEmail({ from: d.from, to: r.email, name: r.name, subject: d.subject, body: d.body, senderName: me?.name });
        let error: string | null = null;
        for (let attempt = 1; attempt <= 2; attempt++) {
          try { await mailer!.send(mail); error = null; break; } catch (err) {
            error = (err as Error).message;
            if (attempt === 1) await sleep(60_000); // the host may be rate-limiting: wait a minute, try once more
          }
        }
        await run("INSERT INTO lead_emails (lead_type, lead_id, campaign, email, status, error, sent_by) VALUES ('lettings', ?, ?, ?, ?, ?, ?)",
          [r.id, d.campaign, r.email, error ? "failed" : "sent", error, me?.name ?? null]);
        if (error) {
          j.failed++; inARow++;
          j.failures.push({ name: r.name, email: r.email, error });
          if (inARow >= 3) { j.error = `Stopped after 3 failures in a row: ${error}`; break; }
        } else {
          j.sent++; inARow = 0;
        }
        await sleep(PAUSE_MS);
      }
      j.running = false;
      j.current = null;
      j.finished_at = new Date().toISOString();
      console.log(`Lead email "${d.campaign}": ${j.sent} sent, ${j.failed} failed, ${j.skipped} skipped${j.cancelled ? " (stopped)" : ""}${j.error ? `. ${j.error}` : ""}`);
    })().catch((err) => {
      j.running = false;
      j.error = (err as Error).message;
      console.error(`Lead email "${d.campaign}" crashed: ${j.error}`);
    });
    return c.json({ job: j }, 202);
  });

  app.post("/api/lettings-leads/email/stop", (c) => {
    if (job?.running) job.cancelled = true;
    return c.json({ job });
  });
}
