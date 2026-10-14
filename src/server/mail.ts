// Inbox: read the company's existing mailboxes over IMAP.
//
// The routes live here so both runtimes share them, but the IMAP client only
// exists on the Node server (src/server/node.ts installs it with
// setMailProvider). Mailboxes are configured with environment variables:
//
//   MAIL_USER, MAIL_PASSWORD            first mailbox (e.g. nabeel@chistiandco.com)
//   MAIL_USER_2, MAIL_PASSWORD_2 … _5   more mailboxes, optional
//   MAIL_HOST (default imap.one.com), MAIL_PORT (default 993)
//
// Read-only apart from marking a message as read when it is opened.

import type { Context, Hono } from "hono";
import { getUser } from "./auth";

export interface MailSummary {
  uid: number;
  from: string;
  from_address: string;
  to: string;
  subject: string;
  date: string | null;
  seen: boolean;
  has_attachments: boolean;
}

export interface MailMessage extends MailSummary {
  cc: string;
  reply_to: string;
  text: string;
  html: string | null;
  attachments: { index: number; filename: string; content_type: string; size: number }[];
}

export interface MailProvider {
  accounts(): string[];
  folders(account: number): Promise<{ path: string; name: string; special: string | null }[]>;
  list(account: number, folder: string, opts: { page: number; pageSize: number; query?: string }): Promise<{ total: number; messages: MailSummary[] }>;
  /** markSeen: true when a person opens it; the assistant reads without marking. */
  read(account: number, folder: string, uid: number, opts?: { markSeen?: boolean }): Promise<MailMessage | null>;
  attachment(account: number, folder: string, uid: number, index: number): Promise<{ filename: string; content_type: string; content: Uint8Array } | null>;
}

let provider: MailProvider | null = null;

export function setMailProvider(p: MailProvider): void {
  provider = p;
}

export function mailProvider(): MailProvider | null {
  return provider && provider.accounts().length ? provider : null;
}

/**
 * The mailboxes this person may read, in their own order, each mapped to the
 * provider's index. Nobody sees a mailbox that isn't on their list.
 */
export function allowedMailboxes(c: Context): { address: string; index: number }[] {
  const p = mailProvider();
  if (!p) return [];
  const mine = new Set(getUser(c)?.mailboxes ?? []);
  return p
    .accounts()
    .map((address, index) => ({ address, index }))
    .filter((m) => mine.has(m.address.toLowerCase()));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerMailRoutes(app: Hono<any>) {
  const num = (v: string | undefined, d: number) => {
    const n = parseInt(v ?? "", 10);
    return Number.isFinite(n) && n >= 0 ? n : d;
  };
  const notSetUp = { error: "The inbox isn't connected yet: add MAIL_USER and MAIL_PASSWORD in Render." };
  const noAccess = { error: "You don't have access to that mailbox." };

  /** ?account=N is an index into THIS person's allowed list, never the full list. */
  const resolveAccount = (c: Context): number | null => {
    const mine = allowedMailboxes(c);
    return mine[num(c.req.query("account"), 0)]?.index ?? null;
  };

  app.get("/api/mail/accounts", async (c) => {
    const p = mailProvider();
    return c.json({ enabled: !!p, accounts: allowedMailboxes(c).map((m) => m.address) });
  });

  app.get("/api/mail/folders", async (c) => {
    const p = mailProvider();
    if (!p) return c.json(notSetUp, 503);
    try {
      const acc = resolveAccount(c);
      if (acc === null) return c.json(noAccess, 403);
      return c.json({ folders: await p.folders(acc) });
    } catch (err) {
      return c.json({ error: friendly(err) }, 502);
    }
  });

  app.get("/api/mail/messages", async (c) => {
    const p = mailProvider();
    if (!p) return c.json(notSetUp, 503);
    try {
      const acc = resolveAccount(c);
      if (acc === null) return c.json(noAccess, 403);
      const out = await p.list(acc, c.req.query("folder") || "INBOX", {
        page: Math.max(1, num(c.req.query("page"), 1)),
        pageSize: Math.min(100, Math.max(10, num(c.req.query("size"), 40))),
        query: c.req.query("q")?.trim() || undefined,
      });
      return c.json(out);
    } catch (err) {
      return c.json({ error: friendly(err) }, 502);
    }
  });

  app.get("/api/mail/messages/:uid", async (c) => {
    const p = mailProvider();
    if (!p) return c.json(notSetUp, 503);
    try {
      const acc = resolveAccount(c);
      if (acc === null) return c.json(noAccess, 403);
      const msg = await p.read(acc, c.req.query("folder") || "INBOX", num(c.req.param("uid"), 0), { markSeen: true });
      if (!msg) return c.json({ error: "That email couldn't be found. It may have been moved or deleted." }, 404);
      return c.json({ message: msg });
    } catch (err) {
      return c.json({ error: friendly(err) }, 502);
    }
  });

  app.get("/api/mail/messages/:uid/attachments/:index", async (c) => {
    const p = mailProvider();
    if (!p) return c.json(notSetUp, 503);
    try {
      const acc = resolveAccount(c);
      if (acc === null) return c.json(noAccess, 403);
      const a = await p.attachment(
        acc,
        c.req.query("folder") || "INBOX",
        num(c.req.param("uid"), 0),
        num(c.req.param("index"), 0),
      );
      if (!a) return c.json({ error: "Attachment not found." }, 404);
      const safeName = a.filename.replace(/[^\w.\- ]+/g, "_") || "attachment";
      return new Response(a.content, {
        headers: {
          "Content-Type": a.content_type || "application/octet-stream",
          "Content-Disposition": `attachment; filename="${safeName}"`,
          "X-Content-Type-Options": "nosniff",
          "Cache-Control": "private, no-store",
        },
      });
    } catch (err) {
      return c.json({ error: friendly(err) }, 502);
    }
  });
}

function friendly(err: unknown): string {
  // imapflow puts the server's own words in responseText; "Command failed"
  // alone says nothing, so log the detail (never credentials) and use it.
  const e = err as { message?: string; responseText?: string; serverResponseCode?: string; authenticationFailed?: boolean; code?: string };
  console.error(
    `Inbox error: ${e?.message ?? err}` +
      (e?.responseText ? ` | server said: ${e.responseText}` : "") +
      (e?.serverResponseCode ? ` | code: ${e.serverResponseCode}` : "") +
      (e?.code ? ` | ${e.code}` : "") +
      (e?.authenticationFailed ? " | authentication failed" : ""),
  );
  if (e?.authenticationFailed || /AUTHENTICATIONFAILED/i.test(`${e?.serverResponseCode ?? ""} ${e?.responseText ?? ""}`)) {
    return "One.com refused the login for this mailbox. Check its MAIL_USER and MAIL_PASSWORD in Render (the full email address and the password you use for One.com webmail).";
  }
  const msg = [e?.message, e?.responseText].filter(Boolean).join(": ") || String(err);
  if (/auth|login|credential|password/i.test(msg)) {
    return "One.com refused the login. Check MAIL_USER and MAIL_PASSWORD in Render (the full email address and its mailbox password).";
  }
  if (/ENOTFOUND|ECONNREFUSED|ETIMEDOUT|timed out/i.test(msg)) {
    return "Couldn't reach the mail server. Check MAIL_HOST (imap.one.com) and try again.";
  }
  return `Mail server error: ${msg.slice(0, 200)}`;
}
