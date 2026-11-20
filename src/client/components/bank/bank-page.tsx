import { useEffect, useState } from "react";
import { Landmark, Link2, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

interface Account {
  id: string;
  account_type?: string;
  account_identifiers?: { type: string; sort_code?: string; account_number?: string; iban?: string }[];
  account_holder_names?: string[];
}
interface Connection { id: number; status: string; accounts: Account[]; last_sync_at: string | null; error: string | null; created_by: string | null }
interface Tx { id: string; date: string; description: string; amount: number; status: string | null; match_label: string | null }
interface BankState {
  configured: boolean;
  mode: "live" | "sandbox";
  redirect_uri: string;
  connections: Connection[];
  transactions: Tx[];
  month: { in: number; out: number; matched: number };
}

const money = (n: number) => `${n < 0 ? "−" : ""}£${Math.abs(n).toLocaleString("en-GB", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const day = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const when = (s: string | null) => (s ? new Date(s.replace(" ", "T") + "Z").toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const accountLabel = (a: Account) => {
  const sc = a.account_identifiers?.find((i) => i.type === "sort_code_account_number");
  const num = sc ? `${sc.sort_code?.replace(/(\d\d)(\d\d)(\d\d)/, "$1-$2-$3")} ••••${sc.account_number?.slice(-4)}` : a.account_identifiers?.[0]?.iban ?? a.id.slice(0, 8);
  return `${a.account_holder_names?.[0] ?? "Account"} · ${a.account_type ?? ""} · ${num}`;
};

export function BankPage() {
  const app = useApp();
  const [s, setS] = useState<BankState | null>(null);
  const [busy, setBusy] = useState<"connect" | "sync" | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "in" | "out" | "unmatched">("all");

  async function load() {
    try {
      const next = await api<BankState>("GET", "/api/bank");
      setS(next);
      return next;
    } catch (err) {
      app.setError((err as Error).message);
      return null;
    }
  }

  async function sync(quiet = false) {
    setBusy("sync");
    try {
      const r = await api<{ new_transactions?: number; matched?: number; errors?: string[]; skipped?: string }>("POST", "/api/bank/sync");
      if (!quiet || r.new_transactions) {
        setNote(r.errors?.length ? `Problem: ${r.errors[0]}` : r.skipped ? `Not synced: ${r.skipped}.` : `Synced: ${r.new_transactions ?? 0} new transactions, ${r.matched ?? 0} matched to rent or payments.`);
      }
    } catch (err) {
      setNote(`Problem: ${(err as Error).message}`);
    } finally {
      setBusy(null);
      await load();
    }
  }

  useEffect(() => {
    // Back from the bank with a one-time code: finish connecting, then show the transactions.
    const back = new URLSearchParams(window.location.search);
    const code = back.get("code");
    const state = back.get("state");
    const error = back.get("error");
    if (back.toString()) window.history.replaceState(null, "", "/bank");
    if (state && (code || error)) {
      setBusy("sync");
      setNote("Connecting your bank and fetching transactions…");
      api<{ new_transactions?: number; matched?: number; errors?: string[] }>("POST", "/api/bank/callback", { code, state, error })
        .then((r) => setNote(r.errors?.length ? `Connected, but: ${r.errors[0]}` : `Connected: ${r.new_transactions ?? 0} transactions fetched, ${r.matched ?? 0} matched to rent or payments.`))
        .catch((err) => setNote(`Problem: ${(err as Error).message}`))
        .finally(() => { setBusy(null); void load(); });
    } else {
      void load();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function remove(c: Connection) {
    if (!window.confirm(`Remove ${c.accounts.length === 1 ? "this account" : "these accounts"} and all ${c.accounts.length === 1 ? "its" : "their"} transactions from the app?`)) return;
    try {
      const r = await api<{ removed_transactions: number }>("POST", `/api/bank/connections/${c.id}/remove`);
      setNote(`Removed, along with ${r.removed_transactions} transactions.`);
    } catch (err) {
      setNote(`Problem: ${(err as Error).message}`);
    }
    await load();
  }

  async function connect() {
    setBusy("connect");
    try {
      const r = await api<{ url: string }>("POST", "/api/bank/connect");
      window.location.href = r.url;
    } catch (err) {
      setNote(`Problem: ${(err as Error).message}`);
      setBusy(null);
    }
  }

  const live = s?.connections.filter((c) => c.status === "active") ?? [];
  const txs = (s?.transactions ?? []).filter((t) =>
    filter === "in" ? t.amount > 0 : filter === "out" ? t.amount < 0 : filter === "unmatched" ? !t.match_label : true,
  );

  return (
    <PageShell
      title="Bank"
      meta={s ? (live.length ? `${live.reduce((n, c) => n + c.accounts.length, 0)} account(s) connected` : "Not connected") : "Loading…"}
      width="max-w-4xl"
      actions={
        live.length ? (
          <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => sync()}>
            <RefreshCw className={cn("size-4", busy === "sync" && "animate-spin")} /> Sync now
          </Button>
        ) : undefined
      }
    >
      <div className="space-y-6 pb-10">
        {s && !s.configured && (
          <Card className="space-y-2 p-4 text-sm">
            <p className="font-medium">Bank connection isn't switched on yet.</p>
            <p className="text-muted-foreground">
              In the TrueLayer Console, create an app and add <code className="rounded bg-muted px-1">{s.redirect_uri}</code> as a redirect URI. Then add
              TRUELAYER_CLIENT_ID and TRUELAYER_CLIENT_SECRET in Render.
            </p>
          </Card>
        )}

        {s?.configured && (
          <Card className="space-y-3 p-4">
            <div className="flex items-start gap-3">
              <Landmark className="mt-0.5 size-5 shrink-0 text-primary" />
              <div className="space-y-1 text-sm">
                <p>
                  Read-only access through TrueLayer: you sign in at your own bank, and nobody here sees your bank login. Jarvis matches money in to the
                  rent each home expects and money out to mortgages, tells you when rent arrives, and warns you when something hasn't arrived a few days after
                  it was due.
                </p>
                {s.mode === "sandbox" && <Badge variant="secondary">Test mode: TrueLayer sandbox, not a real bank</Badge>}
              </div>
            </div>
            {live.map((c) => (
              <div key={c.id} className="rounded-md border p-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={c.status === "active" ? "secondary" : "outline"}>{c.status === "active" ? "Connected" : "Waiting for the bank"}</Badge>
                  <span className="text-xs text-muted-foreground">Last sync {when(c.last_sync_at)}</span>
                  <Button size="sm" variant="ghost" className="ml-auto" disabled={busy !== null} onClick={() => remove(c)}>
                    <Trash2 className="size-4" /> Remove
                  </Button>
                </div>
                {c.accounts.map((a) => <p key={a.id} className="mt-1">{accountLabel(a)}</p>)}
                {c.error && <p className="mt-1 text-xs text-destructive">{c.error}</p>}
              </div>
            ))}
            {s.connections.some((c) => c.status === "expired") && (
              <p className="text-sm text-destructive">A bank connection has expired. Banks ask you to renew access from time to time: tap Connect again.</p>
            )}
            <div className="flex flex-wrap gap-2">
              <Button size="sm" disabled={busy !== null} onClick={connect}>
                <Link2 className="size-4" /> {live.length ? "Connect another account" : "Connect your bank"}
              </Button>
            </div>
            {note && <p className="text-sm font-medium text-primary">{note}</p>}
          </Card>
        )}

        {!!s?.transactions.length && (
          <>
            <div className="grid grid-cols-3 gap-3 text-sm">
              <Card className="p-3"><p className="text-xs text-muted-foreground">In this month</p><p className="text-lg font-semibold">{money(s.month.in)}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Out this month</p><p className="text-lg font-semibold">{money(s.month.out)}</p></Card>
              <Card className="p-3"><p className="text-xs text-muted-foreground">Matched this month</p><p className="text-lg font-semibold">{s.month.matched}</p></Card>
            </div>
            <section className="space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {(["all", "in", "out", "unmatched"] as const).map((f) => (
                  <Button key={f} size="sm" variant={filter === f ? "default" : "ghost"} onClick={() => setFilter(f)}>
                    {f === "all" ? "All" : f === "in" ? "Money in" : f === "out" ? "Money out" : "Not matched"}
                  </Button>
                ))}
              </div>
              <div className="divide-y rounded-md border">
                {txs.map((t) => (
                  <div key={t.id} className="flex items-start justify-between gap-3 px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <p className="truncate">{t.description || "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {day(t.date)}{t.status === "pending" ? " · pending" : ""}
                        {t.match_label ? <span className="text-success"> · {t.match_label}</span> : null}
                      </p>
                    </div>
                    <span className={cn("shrink-0 font-medium tabular-nums", t.amount > 0 ? "text-success" : "")}>{money(t.amount)}</span>
                  </div>
                ))}
                {!txs.length && <p className="px-3 py-4 text-sm text-muted-foreground">Nothing to show.</p>}
              </div>
            </section>
          </>
        )}
      </div>
    </PageShell>
  );
}
