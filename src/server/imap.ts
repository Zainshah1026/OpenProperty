// IMAP mail provider for the Node server.
//
// imapflow and mailparser are installed at build time into ./server-deps
// (see the "build:mail-deps" script) and loaded from there at runtime, so the
// main lockfile stays unchanged. If they are missing, the inbox reports that
// instead of crashing the server.

import { createRequire } from "node:module";
import { resolve } from "node:path";
import type { MailMessage, MailProvider, MailSummary } from "./mail";

/* eslint-disable @typescript-eslint/no-explicit-any */

interface Account {
  user: string;
  pass: string;
}

function accountsFromEnv(env: NodeJS.ProcessEnv): Account[] {
  const out: Account[] = [];
  const first = { user: env.MAIL_USER?.trim(), pass: env.MAIL_PASSWORD };
  if (first.user && first.pass) out.push(first as Account);
  for (let i = 2; i <= 5; i++) {
    const user = env[`MAIL_USER_${i}`]?.trim();
    const pass = env[`MAIL_PASSWORD_${i}`];
    if (user && pass) out.push({ user, pass });
  }
  return out;
}

let libs: { ImapFlow: any; simpleParser: any } | null | undefined;

function loadLibs(): { ImapFlow: any; simpleParser: any } | null {
  if (libs !== undefined) return libs;
  const tryRequire = (req: NodeRequire) => {
    const { ImapFlow } = req("imapflow");
    const { simpleParser } = req("mailparser");
    return { ImapFlow, simpleParser };
  };
  try {
    libs = tryRequire(createRequire(resolve(process.cwd(), "server-deps", "package.json")));
  } catch {
    try {
      libs = tryRequire(createRequire(resolve(process.cwd(), "package.json")));
    } catch (err) {
      console.error("Inbox: imapflow/mailparser not installed:", (err as Error).message);
      libs = null;
    }
  }
  return libs;
}

const addr = (list: any): string =>
  (list ?? [])
    .map((a: any) => (a?.name ? `${a.name} <${a.address ?? ""}>` : a?.address ?? ""))
    .filter(Boolean)
    .join(", ");

const parsedAddr = (field: any): string => (field?.text as string | undefined) ?? "";

function hasAttachment(struct: any): boolean {
  if (!struct) return false;
  if (struct.disposition === "attachment") return true;
  return Array.isArray(struct.childNodes) && struct.childNodes.some(hasAttachment);
}

function toSummary(m: any): MailSummary {
  const env = m.envelope ?? {};
  const from = env.from?.[0];
  return {
    uid: m.uid,
    from: from?.name || from?.address || "(unknown sender)",
    from_address: from?.address ?? "",
    to: addr(env.to),
    subject: env.subject || "(no subject)",
    date: (env.date ?? m.internalDate)?.toISOString?.() ?? null,
    seen: m.flags?.has?.("\\Seen") ?? false,
    has_attachments: hasAttachment(m.bodyStructure),
  };
}

export function createImapProvider(env: NodeJS.ProcessEnv): MailProvider {
  const accounts = accountsFromEnv(env);
  const host = env.MAIL_HOST?.trim() || "imap.one.com";
  const port = Number(env.MAIL_PORT || 993);

  async function withClient<T>(account: number, fn: (client: any) => Promise<T>): Promise<T> {
    const l = loadLibs();
    if (!l) throw new Error("Mail libraries are not installed on the server (server-deps).");
    const acc = accounts[account];
    if (!acc) throw new Error("No such mailbox.");
    const client = new l.ImapFlow({
      host,
      port,
      secure: port === 993,
      auth: { user: acc.user, pass: acc.pass },
      logger: false,
      socketTimeout: 30_000,
    });
    // Without a listener, a dropped or timed-out connection to the mail
    // server is an unhandled 'error' event that takes the whole app down.
    client.on("error", (err: Error) => console.error(`Inbox connection error (${acc.user}): ${err?.message ?? err}`));
    await client.connect();
    try {
      return await fn(client);
    } finally {
      await client.logout().catch(() => client.close());
    }
  }

  return {
    accounts: () => accounts.map((a) => a.user),

    async folders(account) {
      return withClient(account, async (client) => {
        const list = await client.list();
        return list
          .filter((f: any) => !f.flags?.has?.("\\Noselect"))
          .map((f: any) => ({ path: f.path, name: f.name, special: f.specialUse ?? null }));
      });
    },

    async list(account, folder, { page, pageSize, query }) {
      return withClient(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          let uids: number[];
          if (query) {
            const found = await client.search(
              { or: [{ subject: query }, { from: query }, { to: query }, { body: query }] },
              { uid: true },
            );
            uids = (found || []) as number[];
          } else {
            const all = await client.search({ all: true }, { uid: true });
            uids = (all || []) as number[];
          }
          uids.sort((a, b) => b - a); // newest first
          const total = uids.length;
          const slice = uids.slice((page - 1) * pageSize, page * pageSize);
          const messages: MailSummary[] = [];
          if (slice.length) {
            for await (const m of client.fetch(slice.join(","), { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true })) {
              messages.push(toSummary(m));
            }
          }
          messages.sort((a, b) => b.uid - a.uid);
          return { total, messages };
        } finally {
          lock.release();
        }
      });
    },

    async read(account, folder, uid, opts = {}) {
      const l = loadLibs();
      return withClient(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const meta = await client.fetchOne(String(uid), { uid: true, envelope: true, flags: true, bodyStructure: true, internalDate: true }, { uid: true });
          if (!meta) return null;
          const dl = await client.download(String(uid), undefined, { uid: true });
          if (!dl?.content) return null;
          const parsed = await l!.simpleParser(dl.content);
          const summary = toSummary(meta);
          if (opts.markSeen) {
            await client.messageFlagsAdd(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
          } else if (!summary.seen) {
            // Reading the body can set \Seen on some servers; put it back as unread.
            await client.messageFlagsRemove(String(uid), ["\\Seen"], { uid: true }).catch(() => {});
          }
          const msg: MailMessage = {
            ...summary,
            seen: opts.markSeen ? true : summary.seen,
            cc: parsedAddr(parsed.cc),
            reply_to: parsedAddr(parsed.replyTo),
            text: (parsed.text as string | undefined) ?? "",
            html: typeof parsed.html === "string" ? parsed.html : null,
            attachments: (parsed.attachments ?? [])
              .map((a: any, index: number) => ({ a, index }))
              .filter(({ a }: any) => a.contentDisposition !== "inline" || !a.contentId)
              .map(({ a, index }: any) => ({
                index,
                filename: a.filename || `attachment-${index + 1}`,
                content_type: a.contentType || "application/octet-stream",
                size: a.size ?? a.content?.length ?? 0,
              })),
          };
          return msg;
        } finally {
          lock.release();
        }
      });
    },

    async attachment(account, folder, uid, index) {
      const l = loadLibs();
      return withClient(account, async (client) => {
        const lock = await client.getMailboxLock(folder);
        try {
          const dl = await client.download(String(uid), undefined, { uid: true });
          if (!dl?.content) return null;
          const parsed = await l!.simpleParser(dl.content);
          const a = parsed.attachments?.[index];
          if (!a) return null;
          return { filename: a.filename || `attachment-${index + 1}`, content_type: a.contentType || "application/octet-stream", content: new Uint8Array(a.content) };
        } finally {
          lock.release();
        }
      });
    },
  };
}
