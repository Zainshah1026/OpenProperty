import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, Inbox, Loader2, Paperclip, RefreshCw, Search } from "lucide-react";
import { api } from "@/api";
import { cn, formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PageShell } from "@/components/page-shell";

interface Summary {
  uid: number;
  from: string;
  from_address: string;
  to: string;
  subject: string;
  date: string | null;
  seen: boolean;
  has_attachments: boolean;
}

interface Message extends Summary {
  cc: string;
  reply_to: string;
  text: string;
  html: string | null;
  attachments: { index: number; filename: string; content_type: string; size: number }[];
}

interface Folder {
  path: string;
  name: string;
  special: string | null;
}

const PAGE_SIZE = 40;

function when(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (d.getFullYear() === now.getFullYear()) return d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
  return formatDate(iso);
}

function size(n: number): string {
  if (n > 1_000_000) return `${(n / 1_000_000).toFixed(1)} MB`;
  if (n > 1000) return `${Math.round(n / 1000)} KB`;
  return `${n} B`;
}

/** Email HTML shown in a locked-down frame: no scripts, links open in a new tab. */
function htmlDoc(html: string): string {
  return `<!doctype html><html><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'; font-src https: data:">
<base target="_blank"><style>body{font:14px/1.5 Arial,Helvetica,sans-serif;color:#14212b;margin:0;padding:12px;word-wrap:break-word}img{max-width:100%;height:auto}</style>
</head><body>${html}</body></html>`;
}

export function InboxPage() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [accounts, setAccounts] = useState<string[]>([]);
  const [account, setAccount] = useState(0);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [folder, setFolder] = useState("INBOX");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [list, setList] = useState<{ total: number; messages: Summary[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [openUid, setOpenUid] = useState<number | null>(null);
  const [message, setMessage] = useState<Message | null>(null);
  const [reading, setReading] = useState(false);

  useEffect(() => {
    api<{ enabled: boolean; accounts: string[] }>("GET", "/api/mail/accounts")
      .then((d) => { setEnabled(d.enabled); setAccounts(d.accounts); })
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    if (!enabled) return;
    api<{ folders: Folder[] }>("GET", `/api/mail/folders?account=${account}`)
      .then((d) => setFolders(d.folders))
      .catch(() => setFolders([]));
  }, [enabled, account]);

  const load = useCallback(async () => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ account: String(account), folder, page: String(page), size: String(PAGE_SIZE) });
      if (search) qs.set("q", search);
      setList(await api<{ total: number; messages: Summary[] }>("GET", `/api/mail/messages?${qs}`));
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [enabled, account, folder, page, search]);

  useEffect(() => { load(); }, [load]);

  async function open(uid: number) {
    setOpenUid(uid);
    setMessage(null);
    setReading(true);
    try {
      const qs = new URLSearchParams({ account: String(account), folder });
      const d = await api<{ message: Message }>("GET", `/api/mail/messages/${uid}?${qs}`);
      setMessage(d.message);
      setList((l) => l && { ...l, messages: l.messages.map((m) => (m.uid === uid ? { ...m, seen: true } : m)) });
    } catch (err) {
      setError((err as Error).message);
      setOpenUid(null);
    } finally {
      setReading(false);
    }
  }

  const unread = useMemo(() => list?.messages.filter((m) => !m.seen).length ?? 0, [list]);
  const pages = list ? Math.max(1, Math.ceil(list.total / PAGE_SIZE)) : 1;
  const folderLabel = (f: Folder) => (f.path === "INBOX" ? "Inbox" : f.name);

  if (enabled === false) {
    return (
      <PageShell title="Inbox">
        <Card className="mx-auto max-w-xl p-6">
          <div className="mb-2 flex items-center gap-2 font-semibold"><Inbox className="size-5 text-primary" /> Connect your email</div>
          <p className="text-sm text-muted-foreground">
            The inbox reads your One.com mailbox. In Render, open nabeel-portfolio → Environment and add:
          </p>
          <ul className="mt-3 space-y-1 text-sm">
            <li><code className="rounded bg-muted px-1">MAIL_USER</code> your full email address, e.g. nabeel@chistiandco.com</li>
            <li><code className="rounded bg-muted px-1">MAIL_PASSWORD</code> that mailbox's password</li>
          </ul>
          <p className="mt-3 text-xs text-muted-foreground">More mailboxes: add MAIL_USER_2 and MAIL_PASSWORD_2, up to _5. Save, and the inbox appears after the site restarts.</p>
        </Card>
      </PageShell>
    );
  }

  if (enabled && accounts.length === 0) {
    return (
      <PageShell title="Inbox">
        <Card className="mx-auto max-w-xl p-6 text-sm text-muted-foreground">
          No mailboxes are shared with you yet. Ask an admin to tick them for you under Settings → Users.
        </Card>
      </PageShell>
    );
  }

  const reader = openUid !== null && (
    <Card className="flex min-h-[60vh] flex-col overflow-hidden">
      <div className="flex items-center gap-2 border-b px-4 py-2 lg:hidden">
        <button type="button" onClick={() => { setOpenUid(null); setMessage(null); }} className="inline-flex items-center gap-1 text-sm font-medium text-primary">
          <ArrowLeft className="size-4" /> Back
        </button>
      </div>
      {reading || !message ? (
        <div className="flex flex-1 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Opening…</div>
      ) : (
        <>
          <div className="space-y-1 border-b px-5 py-4">
            <h2 className="text-lg font-semibold leading-snug">{message.subject}</h2>
            <div className="text-sm"><b>{message.from}</b> <span className="text-muted-foreground">&lt;{message.from_address}&gt;</span></div>
            <div className="text-xs text-muted-foreground">
              To {message.to}{message.cc ? ` · Cc ${message.cc}` : ""} · {message.date ? new Date(message.date).toLocaleString("en-GB", { dateStyle: "medium", timeStyle: "short" }) : ""}
            </div>
            {message.attachments.length > 0 && (
              <div className="flex flex-wrap gap-2 pt-2">
                {message.attachments.map((a) => (
                  <a
                    key={a.index}
                    href={`/api/mail/messages/${message.uid}/attachments/${a.index}?account=${account}&folder=${encodeURIComponent(folder)}`}
                    className="inline-flex items-center gap-1.5 rounded-md border px-2 py-1 text-xs hover:bg-muted"
                  >
                    <Paperclip className="size-3.5" /> {a.filename} <span className="text-muted-foreground">{size(a.size)}</span>
                  </a>
                ))}
              </div>
            )}
          </div>
          <div className="flex-1 overflow-auto">
            {message.html ? (
              <iframe
                title="Email"
                sandbox="allow-popups allow-popups-to-escape-sandbox"
                srcDoc={htmlDoc(message.html)}
                className="h-full min-h-[50vh] w-full bg-white"
              />
            ) : (
              <pre className="whitespace-pre-wrap break-words p-5 font-sans text-sm">{message.text || "(This email has no text.)"}</pre>
            )}
          </div>
          <div className="border-t px-5 py-3">
            <a
              href={`mailto:${encodeURIComponent(message.reply_to || message.from_address)}?subject=${encodeURIComponent(`Re: ${message.subject}`)}`}
              className="text-sm font-medium text-primary hover:underline"
            >
              Reply in your email app
            </a>
          </div>
        </>
      )}
    </Card>
  );

  return (
    <PageShell
      title="Inbox"
      meta={enabled === null ? "Connecting…" : `${accounts[account] ?? ""}${list ? ` · ${list.total} emails${unread ? ` · ${unread} unread on this page` : ""}` : ""}`}
      actions={
        <Button variant="outline" onClick={load} disabled={loading}>
          <RefreshCw className={cn("h-4 w-4", loading && "animate-spin")} /> Refresh
        </Button>
      }
      width="max-w-7xl"
    >
      <div className="flex flex-wrap items-center gap-2">
        {accounts.length > 1 && (
          <Select value={String(account)} onValueChange={(v) => { setAccount(Number(v)); setFolder("INBOX"); setPage(1); setOpenUid(null); }}>
            <SelectTrigger className="h-9 w-auto min-w-[12rem]"><SelectValue /></SelectTrigger>
            <SelectContent>{accounts.map((a, i) => <SelectItem key={a} value={String(i)}>{a}</SelectItem>)}</SelectContent>
          </Select>
        )}
        {folders.length > 0 && (
          <Select value={folder} onValueChange={(v) => { setFolder(v); setPage(1); setOpenUid(null); }}>
            <SelectTrigger className="h-9 w-auto min-w-[9rem]"><SelectValue /></SelectTrigger>
            <SelectContent>{folders.map((f) => <SelectItem key={f.path} value={f.path}>{folderLabel(f)}</SelectItem>)}</SelectContent>
          </Select>
        )}
        <form className="relative w-full sm:w-72" onSubmit={(e) => { e.preventDefault(); setPage(1); setSearch(query.trim()); }}>
          <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search sender, subject, text…" className="pl-8" />
        </form>
        {search && (
          <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => { setQuery(""); setSearch(""); setPage(1); }}>
            Clear search
          </button>
        )}
      </div>

      {error && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{error}</p>}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(20rem,26rem)_1fr]">
        <Card className={cn("overflow-hidden", openUid !== null && "hidden lg:block")}>
          {!list && loading ? (
            <div className="flex items-center justify-center py-16 text-muted-foreground"><Loader2 className="mr-2 size-4 animate-spin" /> Loading emails…</div>
          ) : list && list.messages.length === 0 ? (
            <div className="py-16 text-center text-sm text-muted-foreground">{search ? "No emails match." : "No emails here."}</div>
          ) : (
            <ul className="max-h-[70vh] divide-y overflow-y-auto">
              {list?.messages.map((m) => (
                <li key={m.uid}>
                  <button
                    type="button"
                    onClick={() => open(m.uid)}
                    className={cn("block w-full px-4 py-3 text-left transition-colors hover:bg-muted", openUid === m.uid && "bg-brand-tint hover:bg-brand-tint")}
                  >
                    <div className="flex items-baseline gap-2">
                      {!m.seen && <span className="size-2 shrink-0 rounded-full bg-primary" aria-label="Unread" />}
                      <span className={cn("min-w-0 flex-1 truncate text-sm", !m.seen ? "font-semibold" : "font-medium")}>{m.from}</span>
                      <span className="shrink-0 text-xs text-muted-foreground tabular-nums">{when(m.date)}</span>
                    </div>
                    <div className={cn("mt-0.5 flex items-center gap-1 truncate text-sm", !m.seen ? "text-foreground" : "text-muted-foreground")}>
                      {m.has_attachments && <Paperclip className="size-3 shrink-0" aria-label="Has attachments" />}
                      <span className="truncate">{m.subject}</span>
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list && pages > 1 && (
            <div className="flex items-center justify-between border-t px-4 py-2 text-xs">
              <button type="button" disabled={page <= 1 || loading} onClick={() => setPage(page - 1)} className="font-medium text-primary disabled:opacity-40">Newer</button>
              <span className="text-muted-foreground">Page {page} of {pages}</span>
              <button type="button" disabled={page >= pages || loading} onClick={() => setPage(page + 1)} className="font-medium text-primary disabled:opacity-40">Older</button>
            </div>
          )}
        </Card>

        {reader || (
          <Card className="hidden min-h-[60vh] items-center justify-center text-sm text-muted-foreground lg:flex">
            <Inbox className="mr-2 size-4" /> Pick an email to read it
          </Card>
        )}
      </div>
    </PageShell>
  );
}
