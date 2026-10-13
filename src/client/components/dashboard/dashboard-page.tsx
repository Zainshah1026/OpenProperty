import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Building2, CheckCircle2, PoundSterling, ShieldAlert, TrendingUp } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { cn, formatMoney } from "@/lib/utils";
import { dealLabel, occupancyLabel, occupancyTone, ordinal } from "@/lib/portfolio";
import type { PortfolioGroup, PortfolioSummary } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";
import { SyncBanner } from "@/components/sync-banner";
import { CalendarCard } from "./calendar-card";

export function DashboardPage({ navigate }: { navigate: (to: string) => void }) {
  const { settings, setError } = useApp();
  const [s, setS] = useState<PortfolioSummary | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let cancelled = false;
    api<PortfolioSummary>("GET", "/api/portfolio/summary")
      .then((d) => { if (!cancelled) setS(d); })
      .catch((err) => { if (!cancelled) setError((err as Error).message); });
    return () => { cancelled = true; };
  }, [setError, version]);

  const money = (n: number) => formatMoney(n, settings.currency);

  if (!s) {
    return <div className="flex flex-1 items-center justify-center text-muted-foreground">Loading portfolio…</div>;
  }

  if (s.properties === 0) {
    return (
      <PageShell title="Dashboard">
        <SyncBanner onSynced={() => setVersion((v) => v + 1)} />
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Building2 className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No properties yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Add properties one by one, or import your portfolio spreadsheet (see the README).
          </p>
          <button type="button" onClick={() => navigate("/properties")} className="mt-2 text-sm font-medium text-primary hover:underline">
            Go to properties
          </button>
        </div>
      </PageShell>
    );
  }

  const compliancePending = s.compliance.expired + s.compliance.due_soon;

  return (
    <PageShell
      title="Dashboard"
      meta={`${s.properties} properties · ${s.occupied} let · rents per calendar month`}
    >
      <SyncBanner onSynced={() => setVersion((v) => v + 1)} />
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Kpi
          label="Rent in"
          value={money(s.rent_in)}
          sub={`${money(s.rent_out + s.other_costs)} out`}
          icon={<PoundSterling className="h-4 w-4" />}
        />
        <Kpi
          label="Net profit"
          value={money(s.net)}
          sub={s.costs_missing ? `${s.costs_missing} homes have no costs entered` : `${s.rent_in ? Math.round((s.net / s.rent_in) * 100) : 0}% margin`}
          icon={<TrendingUp className="h-4 w-4" />}
          tone={s.costs_missing ? "warn" : "default"}
        />
        <Kpi
          label="Arrears"
          value={money(s.arrears_total)}
          sub={`${s.arrears_count} ${s.arrears_count === 1 ? "home" : "homes"} behind`}
          icon={<AlertTriangle className="h-4 w-4" />}
          tone={s.arrears_total > 0 ? "danger" : "default"}
          onClick={() => navigate("/properties?status=in_arrears")}
        />
        <Kpi
          label="Compliance"
          value={compliancePending ? `${compliancePending} due` : s.compliance.missing ? `${s.compliance.missing} unknown` : "All clear"}
          sub={`${s.compliance.expired} expired · ${s.compliance.missing} with no dates`}
          icon={<ShieldAlert className="h-4 w-4" />}
          tone={s.compliance.expired ? "danger" : s.compliance.due_soon || s.compliance.missing ? "warn" : "default"}
          onClick={() => navigate("/compliance")}
        />
      </section>

      <CalendarCard navigate={navigate} currency={settings.currency} version={version} />

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5 lg:col-span-2">
          <CardTitle title="Cashflow through the month" sub="Rent arriving and rent / mortgage going out, by day of the month" />
          <CashflowChart days={s.cashflow_days} money={money} />
        </Card>

        <Card className="p-5">
          <CardTitle title="Needs attention" action={{ label: "All properties", onClick: () => navigate("/properties") }} />
          {s.attention.length === 0 && s.arrears.length === 0 ? (
            <Empty title="Nothing outstanding" message="Every home is let and paying." />
          ) : (
            <ul className="divide-y">
              {s.attention.map((a) => (
                <li key={`a${a.id}`}>
                  <button type="button" onClick={() => navigate(`/properties/${a.id}`)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">{a.owner || "—"}</span>
                    </span>
                    <Badge variant={occupancyTone(a.occupancy)}>{occupancyLabel(a.occupancy)}</Badge>
                  </button>
                </li>
              ))}
              {s.arrears.slice(0, 8).map((a) => (
                <li key={`r${a.id}`}>
                  <button type="button" onClick={() => navigate(`/properties/${a.id}`)} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted">
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium">{a.name}</span>
                      <span className="block truncate text-xs text-muted-foreground">
                        {[a.tenant_label, a.months_arrears ? `${a.months_arrears} mo behind` : null].filter(Boolean).join(" · ") || a.owner}
                      </span>
                    </span>
                    <span className="shrink-0 text-sm font-semibold tabular-nums text-destructive">{money(a.arrears_amount)}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card className="p-5">
          <CardTitle title="By owner" sub="Monthly totals for each company" />
          <GroupTable rows={s.by_owner} label={(k) => k} money={money} />
        </Card>
        <Card className="p-5">
          <CardTitle title="Ours vs rent to rent" sub="Homes we own (with joint ventures) and homes we manage for landlords" />
          <GroupTable rows={s.by_section ?? []} label={(k) => (k === "managed" ? "Rent to rent (managed)" : "Our properties")} money={money} />
          <div className="mt-5">
            <CardTitle title="By deal type" sub="Owned, joint venture, rent to rent, ground rent" />
            <GroupTable rows={s.by_deal} label={dealLabel} money={money} />
          </div>
        </Card>
      </section>
    </PageShell>
  );
}

function CardTitle({ title, sub, action }: { title: string; sub?: string; action?: { label: string; onClick: () => void } }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-sm font-semibold">{title}</h2>
        {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
      </div>
      {action && (
        <button type="button" onClick={action.onClick} className="shrink-0 text-xs font-medium text-primary hover:underline">
          {action.label}
        </button>
      )}
    </div>
  );
}

function Kpi({
  label, value, sub, icon, tone = "default", onClick,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
  tone?: "default" | "warn" | "danger";
  onClick?: () => void;
}) {
  return (
    <Card
      className={cn(
        "relative px-3 py-2.5",
        tone === "warn" && "bg-warning-tint",
        tone === "danger" && "bg-destructive-tint",
        onClick && "cursor-pointer transition-colors duration-150 hover:bg-muted",
      )}
      onClick={onClick}
    >
      <span className={cn("absolute right-3 top-2.5 opacity-60", tone === "warn" ? "text-warning" : tone === "danger" ? "text-destructive" : "text-muted-foreground")} aria-hidden>
        {icon}
      </span>
      <div className={cn("data text-[1.375rem] font-semibold leading-tight tracking-[-0.01em]", tone === "danger" && "text-destructive", tone === "warn" && "text-warning")}>
        {value}
      </div>
      <div className="section-label mt-0.5">{label}</div>
      <div className="mt-1 h-4 truncate text-xs text-muted-foreground">{sub}</div>
    </Card>
  );
}

/**
 * Money in above the line, money out below it, one bar pair per day. One
 * axis, one scale; hover any day for the exact figures.
 */
function CashflowChart({ days, money }: { days: PortfolioSummary["cashflow_days"]; money: (n: number) => string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = useMemo(() => Math.max(1, ...days.map((d) => Math.max(d.money_in, d.money_out))), [days]);
  const H = 180; // total plot height in px; half above, half below the baseline
  const half = H / 2;
  const active = hover !== null ? days[hover] : null;
  const totalIn = days.reduce((a, d) => a + d.money_in, 0);
  const totalOut = days.reduce((a, d) => a + d.money_out, 0);

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-success-solid" aria-hidden />Rent in · {money(totalIn)}</span>
        <span className="flex items-center gap-1.5"><span className="size-2.5 rounded-sm bg-cat-slate-solid" aria-hidden />Rent / mortgage out · {money(totalOut)}</span>
        <span className="ml-auto h-4 tabular-nums text-foreground">
          {active ? `${ordinal(active.day)}: ${money(active.money_in)} in · ${money(active.money_out)} out` : "Hover a day for detail"}
        </span>
      </div>
      <div className="relative" style={{ height: H }} onMouseLeave={() => setHover(null)} role="img" aria-label="Rent in and out by day of month">
        <div className="absolute inset-x-0 border-t border-border" style={{ top: half }} />
        <div className="absolute inset-0 flex gap-[2px]">
          {days.map((d, i) => (
            <div
              key={d.day}
              className={cn("relative flex-1 cursor-default rounded-sm", hover === i && "bg-muted")}
              onMouseEnter={() => setHover(i)}
            >
              {d.money_in > 0 && (
                <div className="absolute inset-x-[15%] rounded-t-[4px] bg-success-solid" style={{ bottom: half, height: Math.max(2, (d.money_in / max) * (half - 4)) }} />
              )}
              {d.money_out > 0 && (
                <div className="absolute inset-x-[15%] rounded-b-[4px] bg-cat-slate-solid" style={{ top: half, height: Math.max(2, (d.money_out / max) * (half - 4)) }} />
              )}
            </div>
          ))}
        </div>
      </div>
      <div className="mt-1 flex gap-[2px] text-[10px] text-muted-foreground">
        {days.map((d) => (
          <span key={d.day} className="flex-1 text-center tabular-nums">{d.day === 1 || d.day % 5 === 0 ? d.day : ""}</span>
        ))}
      </div>
    </div>
  );
}

function GroupTable({ rows, label, money }: { rows: PortfolioGroup[]; label: (k: string) => string; money: (n: number) => string }) {
  const max = Math.max(1, ...rows.map((r) => r.rent_in));
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Name</th>
            <th className="pb-2 text-right font-medium">Homes</th>
            <th className="pb-2 pl-3 font-medium">Rent in</th>
            <th className="pb-2 text-right font-medium">Net</th>
            <th className="pb-2 text-right font-medium">Arrears</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-[10rem] truncate py-2 pr-2 font-medium">{label(r.key)}</td>
              <td className="py-2 text-right tabular-nums">{r.count}</td>
              <td className="py-2 pl-3">
                <div className="flex items-center gap-2">
                  <div className="h-2 min-w-[2px] rounded-r-[4px] bg-cat-teal-solid" style={{ width: `${(r.rent_in / max) * 70}%` }} aria-hidden />
                  <span className="tabular-nums">{money(r.rent_in)}</span>
                </div>
              </td>
              <td className="py-2 text-right tabular-nums">{money(r.net)}</td>
              <td className={cn("py-2 text-right tabular-nums", r.arrears > 0 && "text-destructive")}>{r.arrears ? money(r.arrears) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function Empty({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-1 py-8 text-center">
      <CheckCircle2 className="h-5 w-5 text-muted-foreground" />
      <p className="text-sm font-medium">{title}</p>
      <p className="text-xs text-muted-foreground">{message}</p>
    </div>
  );
}
