import { useState } from "react";
import { Landmark, Percent, PiggyBank, Scale } from "lucide-react";
import { cn, formatDate } from "@/lib/utils";
import type { FinanceGroup, FinanceSummary } from "@/types";
import { Card } from "@/components/ui/card";

/** £1.24m, £350k, £900. */
export function compactMoney(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (a >= 1_000_000) return `${sign}£${(a / 1_000_000).toFixed(a >= 10_000_000 ? 1 : 2)}m`;
  if (a >= 10_000) return `${sign}£${Math.round(a / 1000)}k`;
  return `${sign}£${Math.round(a).toLocaleString("en-GB")}`;
}
const pct = (n: number | null | undefined, dp = 0) => (n === null || n === undefined ? "—" : `${(n * 100).toFixed(dp)}%`);
const ltvTone = (ltv: number | null) => (ltv === null ? "" : ltv >= 0.85 ? "text-destructive" : ltv >= 0.75 ? "text-warning" : "");

/**
 * The balance sheet: what the portfolio is worth, what is owed on it and
 * who it is owed to, by company, plus leases and fixed rates to keep an eye on.
 */
export function FinanceSection({ f, navigate }: { f: FinanceSummary; navigate: (to: string) => void }) {
  if (!f.valued && !f.debt) return null;
  const jv = Math.abs(f.our_equity - f.equity) > 1;

  return (
    <>
      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat
          icon={<Landmark className="h-4 w-4" />}
          label="Portfolio value"
          value={compactMoney(f.value)}
          sub={jv ? `${compactMoney(f.our_value)} our share` : `${f.valued} homes valued`}
        />
        <Stat
          icon={<Scale className="h-4 w-4" />}
          label="Mortgages"
          value={compactMoney(f.debt)}
          sub={`${pct(f.ltv)} loan to value${jv ? ` · ${compactMoney(f.our_debt)} our share` : ""}`}
          tone={f.ltv !== null && f.ltv >= 0.75 ? "warn" : "default"}
        />
        <Stat
          icon={<PiggyBank className="h-4 w-4" />}
          label={jv ? "Our equity" : "Equity"}
          value={compactMoney(jv ? f.our_equity : f.equity)}
          sub={jv ? `${compactMoney(f.equity)} including partners' shares` : `${f.unencumbered} homes mortgage-free`}
        />
        <Stat
          icon={<Percent className="h-4 w-4" />}
          label="Gross yield"
          value={pct(f.gross_yield, 1)}
          sub={`${pct(f.net_yield, 1)} after mortgages`}
        />
      </section>

      <section className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <Card className="p-5 xl:col-span-2">
          <Title title="Balance sheet by company" sub="Value, mortgage and equity for each company. Our equity applies our share of each joint venture." />
          <CompanyTable rows={f.by_company} />
          {f.missing_value > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {f.missing_value} {f.missing_value === 1 ? "home has" : "homes have"} no value yet. Add it in the Property Value column of the sheet or on the property page.
            </p>
          )}
        </Card>
        <Card className="p-5">
          <Title title="Lenders" sub="Who the mortgages are with" />
          <LenderBars rows={f.by_lender} total={f.debt} />
        </Card>
      </section>

      <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Card className="p-5">
          <Title title="Highest loan to value" sub="Least headroom to refinance" />
          <ul className="divide-y">
            {f.highest_ltv.map((r) => (
              <Row key={r.id} onClick={() => navigate(`/properties/${r.id}`)} title={r.name} sub={`${compactMoney(r.debt)} of ${compactMoney(r.value)}${r.lender ? ` · ${r.lender}` : ""}`}>
                <span className={cn("text-sm font-semibold tabular-nums", ltvTone(r.ltv))}>{pct(r.ltv)}</span>
              </Row>
            ))}
          </ul>
        </Card>
        <Card className="p-5">
          <Title title="Leases to watch" sub="Red under 50 years left, amber under 80. Under 80 gets costly to extend and harder to mortgage." />
          {f.leases.filter((l) => l.years_left < 80).length === 0 ? (
            <p className="text-sm text-muted-foreground">
              {f.leases.length ? `All ${f.leases.length} recorded leases have 80+ years left.` : "No lease lengths recorded yet."}
            </p>
          ) : (
            <ul className="divide-y">
              {f.leases.filter((l) => l.years_left < 80).map((l) => (
                <Row key={l.id} onClick={() => navigate(`/properties/${l.id}`)} title={l.name} sub={l.lease_end ? `Ends ${formatDate(l.lease_end)}` : "Years remaining from the sheet"}>
                  <span className={cn("text-sm font-semibold tabular-nums", l.years_left < 50 ? "text-destructive" : "text-warning")}>{Math.floor(l.years_left)} yrs</span>
                </Row>
              ))}
            </ul>
          )}
        </Card>
        <Card className="p-5">
          <Title title="Fixed rates ending" sub="Remortgage 3–6 months before a deal ends" />
          {f.fixed_rates.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No fixed-rate end dates yet. Open a property and add it under Finance to get a reminder here.
            </p>
          ) : (
            <ul className="divide-y">
              {f.fixed_rates.slice(0, 8).map((r) => (
                <Row key={r.id} onClick={() => navigate(`/properties/${r.id}`)} title={r.name} sub={[r.lender, compactMoney(r.mortgage_balance)].filter(Boolean).join(" · ")}>
                  <span className={cn("text-sm font-medium tabular-nums", monthsUntil(r.fixed_rate_end) <= 6 && "text-warning", monthsUntil(r.fixed_rate_end) < 0 && "text-destructive")}>
                    {formatDate(r.fixed_rate_end, { month: "short", year: "numeric" })}
                  </span>
                </Row>
              ))}
            </ul>
          )}
        </Card>
      </section>
    </>
  );
}

const monthsUntil = (iso: string) => (Date.parse(iso) - Date.now()) / (30.4 * 86_400_000);

function Title({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="mb-4">
      <h2 className="text-[1.0625rem] font-semibold">{title}</h2>
      {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Row({ title, sub, onClick, children }: { title: string; sub: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <li>
      <button type="button" onClick={onClick} className="flex w-full items-center justify-between gap-3 py-2.5 text-left hover:bg-muted">
        <span className="min-w-0">
          <span className="block truncate text-sm font-medium">{title}</span>
          <span className="block truncate text-xs text-muted-foreground">{sub}</span>
        </span>
        <span className="shrink-0">{children}</span>
      </button>
    </li>
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

function CompanyTable({ rows }: { rows: FinanceGroup[] }) {
  const tot = rows.reduce(
    (a, r) => ({ count: a.count + r.count, value: a.value + r.value, debt: a.debt + r.debt, equity: a.equity + r.equity, our: a.our + r.our_equity, rent: a.rent + r.rent_in }),
    { count: 0, value: 0, debt: 0, equity: 0, our: 0, rent: 0 },
  );
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th className="pb-2 font-medium">Company</th>
            <th className="pb-2 text-right font-medium">Homes</th>
            <th className="pb-2 text-right font-medium">Our share</th>
            <th className="pb-2 text-right font-medium">Value</th>
            <th className="pb-2 text-right font-medium">Mortgages</th>
            <th className="pb-2 pl-4 font-medium">LTV</th>
            <th className="pb-2 text-right font-medium">Our equity</th>
            <th className="pb-2 text-right font-medium">Rent / mo</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.key}>
              <td className="max-w-[11rem] truncate py-2 pr-2 font-medium">{r.key}</td>
              <td className="py-2 text-right tabular-nums">{r.count}</td>
              <td className="py-2 text-right tabular-nums text-muted-foreground">{r.share === null ? "mixed" : `${Math.round(r.share)}%`}</td>
              <td className="py-2 text-right tabular-nums">{r.value ? compactMoney(r.value) : "—"}</td>
              <td className="py-2 text-right tabular-nums">{r.debt ? compactMoney(r.debt) : "—"}</td>
              <td className="py-2 pl-4">
                {r.ltv === null || !r.debt ? <span className="text-faint">{r.value ? "No mortgage" : "—"}</span> : (
                  <div className="flex items-center gap-2">
                    <div className="h-1.5 w-16 overflow-hidden rounded-full bg-muted" aria-hidden>
                      <div className={cn("h-full rounded-full", r.ltv >= 0.85 ? "bg-destructive" : r.ltv >= 0.75 ? "bg-warning" : "bg-cat-teal-solid")} style={{ width: `${Math.min(100, r.ltv * 100)}%` }} />
                    </div>
                    <span className={cn("tabular-nums", ltvTone(r.ltv))}>{pct(r.ltv)}</span>
                  </div>
                )}
              </td>
              <td className="py-2 text-right font-medium tabular-nums">{r.value ? compactMoney(r.our_equity) : "—"}</td>
              <td className="py-2 text-right tabular-nums">{compactMoney(r.rent_in)}</td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr className="border-t text-sm font-semibold">
            <td className="pt-2">Total</td>
            <td className="pt-2 text-right tabular-nums">{tot.count}</td>
            <td />
            <td className="pt-2 text-right tabular-nums">{compactMoney(tot.value)}</td>
            <td className="pt-2 text-right tabular-nums">{compactMoney(tot.debt)}</td>
            <td className="pt-2 pl-4 tabular-nums">{tot.value ? pct(tot.debt / tot.value) : "—"}</td>
            <td className="pt-2 text-right tabular-nums">{compactMoney(tot.our)}</td>
            <td className="pt-2 text-right tabular-nums">{compactMoney(tot.rent)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

function LenderBars({ rows, total }: { rows: FinanceGroup[]; total: number }) {
  const max = Math.max(1, ...rows.map((r) => r.debt));
  const [all, setAll] = useState(false);
  const shown = all ? rows : rows.slice(0, 9);
  return (
    <>
    <ul className="space-y-2.5">
      {shown.map((r) => (
        <li key={r.key}>
          <div className="flex items-baseline justify-between gap-2 text-sm">
            <span className="truncate font-medium">{r.key}</span>
            <span className="shrink-0 tabular-nums">{compactMoney(r.debt)} <span className="text-xs text-muted-foreground">· {r.count} · {total ? Math.round((r.debt / total) * 100) : 0}%</span></span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>
            <div className="h-full rounded-full bg-cat-slate-solid" style={{ width: `${(r.debt / max) * 100}%` }} />
          </div>
        </li>
      ))}
    </ul>
    {rows.length > 9 && (
      <button type="button" onClick={() => setAll(!all)} className="mt-3 text-xs font-medium text-primary hover:underline">
        {all ? "Show fewer" : `Show all ${rows.length} lenders`}
      </button>
    )}
    </>
  );
}
