// Sending email from the company mailboxes (Node server only).
//
// Uses the same MAIL_USER / MAIL_PASSWORD (and _2 … _5) logins as the inbox,
// over the mail host's SMTP server (one.com: send.one.com, port 465). Each
// message is also saved to that mailbox's Sent folder over IMAP, so it shows
// in the mailbox like any email sent by hand.
//
// nodemailer is installed at build time into ./server-deps alongside the
// inbox libraries (see "build:mail-deps" in package.json).

import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { LeadMailer, OutgoingMail } from "./lead-email";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Account { user: string; pass: string }

function accountsFromEnv(env: NodeJS.ProcessEnv): Account[] {
  const out: Account[] = [];
  if (env.MAIL_USER?.trim() && env.MAIL_PASSWORD) out.push({ user: env.MAIL_USER.trim(), pass: env.MAIL_PASSWORD });
  for (let i = 2; i <= 5; i++) {
    const user = env[`MAIL_USER_${i}`]?.trim();
    const pass = env[`MAIL_PASSWORD_${i}`];
    if (user && pass) out.push({ user, pass });
  }
  return out;
}

function load(name: string): any | null {
  for (const base of [resolve(process.cwd(), "server-deps", "package.json"), resolve(process.cwd(), "package.json")]) {
    try { return createRequire(base)(name); } catch { /* try next */ }
  }
  return null;
}

export function createSmtpMailer(env: NodeJS.ProcessEnv): LeadMailer {
  const accounts = accountsFromEnv(env);
  const smtpHost = env.MAIL_SMTP_HOST?.trim() || "send.one.com";
  const smtpPort = Number(env.MAIL_SMTP_PORT || 465);
  const imapHost = env.MAIL_HOST?.trim() || "imap.one.com";
  const imapPort = Number(env.MAIL_PORT || 993);
  const transports = new Map<string, any>();
  let logo: Buffer | null | undefined;

  const account = (from: string) => accounts.find((a) => a.user.toLowerCase() === from.toLowerCase());

  function transport(acc: Account) {
    let t = transports.get(acc.user);
    if (!t) {
      const nodemailer = load("nodemailer");
      if (!nodemailer) throw new Error("Email sending isn't installed on the server yet (nodemailer). Redeploy to install it.");
      t = nodemailer.createTransport({
        host: smtpHost, port: smtpPort, secure: smtpPort === 465,
        auth: { user: acc.user, pass: acc.pass },
        pool: true, maxConnections: 1, maxMessages: 50,
      });
      transports.set(acc.user, t);
    }
    return t;
  }

  function logoBytes(): Buffer | null {
    if (logo !== undefined) return logo;
    try { logo = readFileSync(resolve(process.env.STATIC_DIR || "./dist", "brand", "chisti-logo.jpg")); } catch { logo = null; }
    return logo;
  }

  async function build(mail: OutgoingMail): Promise<Buffer> {
    const Composer = load("nodemailer/lib/mail-composer");
    if (!Composer) throw new Error("Email sending isn't installed on the server yet (nodemailer).");
    const bytes = logoBytes();
    const message = new Composer({
      from: mail.fromName ? { name: mail.fromName, address: mail.from } : mail.from,
      to: mail.to,
      subject: mail.subject,
      text: mail.text,
      html: bytes ? mail.html : mail.html.replace(/<img[^>]*cid:chisti-logo[^>]*>/, ""),
      headers: mail.headers,
      attachments: bytes ? [{ filename: "chisti-logo.jpg", content: bytes, cid: "chisti-logo", contentType: "image/jpeg" }] : [],
    });
    return await new Promise<Buffer>((ok, fail) => message.compile().build((err: Error | null, out: Buffer) => (err ? fail(err) : ok(out))));
  }

  async function saveToSent(acc: Account, raw: Buffer) {
    const imap = load("imapflow");
    if (!imap) return;
    const client = new imap.ImapFlow({ host: imapHost, port: imapPort, secure: imapPort === 993, auth: { user: acc.user, pass: acc.pass }, logger: false, socketTimeout: 30_000 });
    client.on("error", () => {});
    try {
      await client.connect();
      const boxes = await client.list();
      const sent = boxes.find((b: any) => b.specialUse === "\\Sent") ?? boxes.find((b: any) => /^(sent|inbox\.sent|sent items|sent messages)$/i.test(b.path));
      if (sent) await client.append(sent.path, raw, ["\\Seen"]);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  return {
    senders: () => accounts.map((a) => a.user),
    async send(mail) {
      const acc = account(mail.from);
      if (!acc) throw new Error(`${mail.from} isn't connected. Add its login as MAIL_USER / MAIL_PASSWORD in Render.`);
      const raw = await build(mail);
      await transport(acc).sendMail({ envelope: { from: acc.user, to: [mail.to] }, raw });
      await saveToSent(acc, raw).catch((err) => console.error(`Couldn't save to Sent (${acc.user}): ${(err as Error).message}`));
    },
  };
}
