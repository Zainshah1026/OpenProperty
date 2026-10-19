import { useCallback, useEffect, useMemo, useState } from "react";
import { AlarmClock, CalendarClock, Landmark, Paperclip, Percent, Plus, Scale, Search, Sparkles } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import type { Mortgage } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageShell } from "@/components/page-shell";
import { compactMoney } from "@/components/dashboard/finance-section";
import { MortgageDialog } from "./mortgage-dialog";
import {
  CHARGE_LABEL, DEAL_TONE, RATE_LABEL, REPAYMENT_LABEL, dealLabel, dealState, interestOnlyDue, ltvByProperty, monthsUntil,
  paymentAfterDeal, paymentNow, pct, share,
} from "./mortgage-math";

type Suggestion = { id: number; ref: string | null; name: string; lender: string | null; mortgage_balance: number | null; fixed_rate_end: string | null };
type Filter = "active" | "redeemed" | "all";

export function MortgagesPage({ navigate }: { navigate: (to: string) => void }) {
  const { setError, refreshLookups } = useApp();
  const [rows, setRows] = useState<Mortgage[] | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [editing, setEditing] = useState<Mortgage | null | undefined>(undefined);
  const [filter, setFilter] = useState<Filter>("active");
  const [q, setQ] = useState("");
  const [importing, setImporting] = useState(false);

  const load = useCallback(() => {
    api<{ mortgages: Mortgage[] }>("GET", "/api/mortgages").then((r) => setRows(r.mortgages)).catch((e) => setError((e as Error).message));
    api<{ properties: Suggestion[] }>("GET", "/api/mortgages/suggestions").then((r) => setSuggestions(r.properties)).catch(() => setSuggestions([]));
  }, [setError]);
  useEffect(load, [load]);

  async function importAll() {
    setImporting(true);
    try {
      await api("POST", "/api/mortgages/import", { property_ids: suggestions.map((s) => s.id) });
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting(false);
    }
  }

  const active = useMemo(() => (rows ?? []).filter((m) => m.status === "active"), [rows]);
  const ltv = useMemo(() => ltvByProperty(rows ?? []), [rows]);

  const totals = useMemo(() => {
    const debt = active.reduce((a, m) => a + (m.balance ?? 0), 0);
    const ourDebt = active.reduce((a, m) => a + (m.balance ?? 0) * share(m), 0);
    let monthly = 0;
    let estimated = false;
    for (const m of active) {
      const p = paymentNow(m);
      if (p.amount != null) monthly += p.amount;
      if (p.estimated && p.amount != null) estimated = true;
    }
    const rated = active.filter((m) => m.interest_rate != null && m.balance);
    const ratedDebt = rated.reduce((a, m) => a + (m.balance ?? 0), 0);
    const avgRate = ratedDebt ? rated.reduce((a, m) => a + (m.interest_rate ?? 0) * (m.balance ?? 0), 0) / ratedDebt : null;
    const ending = active.filter((m) => ["ended", "urgent", "soon"].includes(dealState(m)));
    const rent = new Map<number, number>();
    for (const m of active) if (m.property_id && m.rent_in) rent.set(m.property_id, m.rent_in);
    const rentIn = [...rent.values()].reduce((a, r) => a + r, 0);
    return { debt, ourDebt, monthly, estimated, avgRate, ending, rentIn, missingRate: active.length - rated.length };
  }, [active]);

  // Deals ending in the next 12 months (or already ended), and interest-only loans nearing the end of their term.
  const upcoming = useMemo(
    () =>
      active
        .filter((m) => {
          const s = dealState(m);
          return s === "ended" || ((monthsUntil(m.deal_end) ?? 99) < 12 && s !== "no_date") || interestOnlyDue(m);
        })
        .sort((a, b) => (a.deal_end ?? "9999").localeCompare(b.deal_end ?? "9999")),
    [active],
  );

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (rows ?? []).filter(
      (m) =>
        (filter === "all" || m.status === filter) &&
        (!needle || [m.lender, m.property_name, m.property_ref, m.property_address, m.borrower, m.account_ref].some((x) => x?.toLowerCase().includes(needle))),
    );
  }, [rows, filter, q]);

  const jv = Math.abs(totals.ourDebt - totals.debt) > 1;

  return (
    <PageShell
      title="Mortgages"
      meta={rows ? `${active.length} active loan${active.length === 1 ? "" : "s"} · ${compactMoney(totals.debt)} owed` : "Loading…"}
      actions={<Button onClick={() => setEditing(null)}><Plus /> Add mortgage</Button>}
    >
      {suggestions.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl bg-info-tint px-4 py-3 text-sm text-info">
          <Sparkles className="size-4 shrink-0" />
          <span className="min-w-0 flex-1">
            <strong>{suggestions.length} home{suggestions.length === 1 ? " has" : "s have"} a lender or balance on record</strong> but no mortgage entered yet
            {suggestions.length <= 4 ? ` (${suggestions.map((s) => s.name).join(", ")})` : ""}. Add them here, then fill in the rates and dates.
          </span>
          <Button size="sm" onClick={importAll} disabled={importing}>{importing ? "Adding…" : `Add ${suggestions.length}`}</Button>
        </div>
      )}

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat icon={<Scale className="size-4" />} label="Owed" value={compactMoney(totals.debt)} sub={jv ? `${compactMoney(totals.ourDebt)} our share` : `${active.length} loans`} />
        <Stat
          icon={<Landmark className="size-4" />}
          label="Monthly payments"
          value={formatMoney(totals.monthly)}
          sub={totals.rentIn ? `${formatMoney(totals.rentIn)} rent in on these homes${totals.estimated ? " · some estimated" : ""}` : totals.estimated ? "Some estimated from the rate" : ""}
        />
        <Stat
          icon={<Percent className="size-4" />}
          label="Average rate"
          value={pct(totals.avgRate)}
          sub={totals.missingRate ? `${totals.missingRate} loan${totals.missingRate === 1 ? "" : "s"} without a rate` : "Weighted by balance"}
        />
        <Stat
          icon={<AlarmClock className="size-4" />}
          label="Deals ending"
          value={String(totals.ending.length)}
          sub="Ended or within 6 months"
          tone={totals.ending.length ? "warn" : "default"}
        />
      </section>

      {upcoming.length > 0 && (
        <Card className="p-5">
          <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold"><CalendarClock className="size-4 text-primary" /> Coming up</h2>
          <p className="mb-3 mt-0.5 text-sm text-muted-foreground">Deals ending in the next 12 months, and interest-only loans that must be repaid within 5 years. Speak to your broker about 6 months before a deal ends.</p>
          <ul className="divide-y">
            {upcoming.map((m) => {
              const now = paymentNow(m).amount;
              const after = paymentAfterDeal(m);
              const rise = now != null && after != null ? after - now : null;
              return (
                <li key={m.id}>
                  <button type="button" onClick={() => setEditing(m)} className="flex w-full flex-wrap items-center gap-x-4 gap-y-1 py-2.5 text-left hover:bg-muted/50">
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-medium">{m.property_name ?? "Not linked to a home"}</span>
                      <span className="block text-xs text-muted-foreground">{m.lender} · {formatMoney(m.balance)}</span>
                    </span>
                    {interestOnlyDue(m) && <Badge variant="warning">Interest only: repay by {formatDate(m.term_end)}</Badge>}
                    {m.deal_end && <Badge variant={DEAL_TONE[dealState(m)]}>{dealLabel(m)} · {formatDate(m.deal_end)}</Badge>}
                    {rise != null && (
                      <span className={cn("text-sm tabular-nums", rise > 0 ? "text-destructive" : "text-muted-foreground")}>
                        {formatMoney(now)} → {formatMoney(after)}/mo{rise > 0 ? ` (+${formatMoney(rise)})` : ""}
                      </span>
                    )}
                  </button>
                </li>
              );
            })}
          </ul>
        </Card>
      )}

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {(["active", "redeemed", "all"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", filter === f ? "bg-card text-foreground shadow-edge" : "text-muted-foreground hover:text-foreground")}
              >
                {f === "active" ? "Active" : f === "redeemed" ? "Paid off" : "All"}
              </button>
            ))}
          </div>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Search home, lender…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search mortgages" />
          </div>
        </div>

        {rows === null ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : shown.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center">
            <Landmark className="size-7 text-faint" />
            <p className="font-medium">{rows.length ? "Nothing matches" : "No mortgages yet"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {rows.length
                ? "Try another filter."
                : "Add each loan with its rate, when the deal ends and the rate after. You'll see payments, loan to value and which deals need remortgaging soon."}
            </p>
            {!rows.length && <Button className="mt-2" onClick={() => setEditing(null)}><Plus /> Add mortgage</Button>}
          </Card>
        ) : (
          <MortgageTable rows={shown} ltv={ltv} onOpen={setEditing} navigate={navigate} />
        )}
      </section>

      <p className="text-xs text-muted-foreground">
        Payments marked "est." are worked out from the balance, rate and term; enter the lender's figure for an exact number. Saving a mortgage also updates the
        balance, lender and monthly payment on the property, so the dashboard's balance sheet matches.
      </p>

      <MortgageDialog
        mortgage={editing}
        onClose={(changed) => {
          setEditing(undefined);
          if (changed) {
            load();
            refreshLookups().catch(() => {});
          }
        }}
      />
    </PageShell>
  );
}

export function MortgageTable({
  rows,
  ltv,
  onOpen,
  navigate,
  hideProperty,
}: {
  rows: Mortgage[];
  ltv: Map<number, number>;
  onOpen: (m: Mortgage) => void;
  navigate?: (to: string) => void;
  hideProperty?: boolean;
}) {
  return (
    <Card className="overflow-x-auto p-0">
      <table className="w-full min-w-[860px] text-sm">
        <thead>
          <tr className="border-b text-left text-xs text-muted-foreground">
            {!hideProperty && <th className="px-4 py-2.5 font-medium">Property</th>}
            <th className="px-4 py-2.5 font-medium">Lender</th>
            <th className="px-4 py-2.5 font-medium">Rate</th>
            <th className="px-4 py-2.5 font-medium">Deal</th>
            <th className="px-4 py-2.5 text-right font-medium">Balance</th>
            <th className="px-4 py-2.5 text-right font-medium">LTV</th>
            <th className="px-4 py-2.5 text-right font-medium">Monthly</th>
            <th className="px-4 py-2.5 text-right font-medium">After deal</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((m) => {
            const now = paymentNow(m);
            const after = paymentAfterDeal(m);
            const l = m.property_id && m.status === "active" ? ltv.get(m.property_id) ?? null : null;
            return (
              <tr key={m.id} className={cn("cursor-pointer hover:bg-muted/50", m.status === "redeemed" && "text-muted-foreground")} onClick={() => onOpen(m)}>
                {!hideProperty && (
                  <td className="max-w-[15rem] px-4 py-2.5">
                    {m.property_id && navigate ? (
                      <a
                        href={`/properties/${m.property_id}`}
                        className="block truncate font-medium hover:underline"
                        onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigate(`/properties/${m.property_id}`); }}
                      >
                        {m.property_name}
                      </a>
                    ) : (
                      <span className="block truncate font-medium">{m.property_name ?? "Not linked"}</span>
                    )}
                    <span className="block truncate text-xs text-muted-foreground">{m.borrower ?? m.property_owner ?? ""}</span>
                  </td>
                )}
                <td className="px-4 py-2.5">
                  <button type="button" className="inline-flex items-center gap-1.5 text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); onOpen(m); }}>
                    {m.lender}
                    {!!m.doc_count && (
                      <span className="inline-flex items-center gap-0.5 text-xs font-normal text-muted-foreground" title={`${m.doc_count} document${m.doc_count === 1 ? "" : "s"}`}>
                        <Paperclip className="size-3" />{m.doc_count}
                      </span>
                    )}
                  </button>
                  <span className="block text-xs text-muted-foreground">
                    {m.charge !== "first" ? `${CHARGE_LABEL[m.charge]} · ` : ""}{REPAYMENT_LABEL[m.repayment_type]}
                  </span>
                </td>
                <td className="px-4 py-2.5 tabular-nums">
                  {pct(m.interest_rate)}
                  <span className="block text-xs text-muted-foreground">{RATE_LABEL[m.rate_type]}</span>
                </td>
                <td className="px-4 py-2.5">
                  <Badge variant={DEAL_TONE[dealState(m)]}>{dealLabel(m)}</Badge>
                  {m.deal_end && <span className="mt-0.5 block text-xs text-muted-foreground">{formatDate(m.deal_end)}</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">{formatMoney(m.balance)}</td>
                <td className={cn("px-4 py-2.5 text-right tabular-nums", l !== null && l >= 0.85 ? "text-destructive" : l !== null && l >= 0.75 ? "text-warning" : "")}>
                  {l === null ? "—" : `${Math.round(l * 100)}%`}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {formatMoney(now.amount)}
                  {now.estimated && now.amount != null && <span className="ml-1 text-xs text-muted-foreground">est.</span>}
                </td>
                <td className="px-4 py-2.5 text-right tabular-nums">
                  {after == null ? <span className="text-faint">—</span> : (
                    <>
                      {formatMoney(after)}
                      {m.follow_on_rate != null && <span className="block text-xs text-muted-foreground">at {pct(m.follow_on_rate)}</span>}
                    </>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </Card>
  );
}

function Stat({ icon, label, value, sub, tone = "default" }: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: "default" | "warn" }) {
  return (
    <Card className="flex flex-col items-start gap-1 p-5">
      <span className="flex w-full items-center gap-2 text-sm text-muted-foreground">
        <span className={cn("inline-flex size-7 items-center justify-center rounded-full", tone === "warn" ? "bg-warning-tint text-warning" : "bg-brand-tint text-brand-text")} aria-hidden>
          {icon}
        </span>
        {label}
      </span>
      <span className="display data mt-2 text-[2rem] font-medium leading-none">{value}</span>
      <span className="mt-1 min-h-4 text-xs text-muted-foreground">{sub}</span>
    </Card>
  );
}
