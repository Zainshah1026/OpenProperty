import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, ShieldAlert } from "lucide-react";
import { api } from "@/api";
import { addMonths, cn, currentPeriod, formatDate, formatMoney, formatPeriod, toIsoDate } from "@/lib/utils";
import type { CalendarData, CalendarEvent } from "@/types";
import { Card } from "@/components/ui/card";

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const KIND_STYLE: Record<CalendarEvent["kind"], { dot: string; text: string; label: string }> = {
  in: { dot: "bg-success-solid", text: "text-success", label: "Rent in" },
  out: { dot: "bg-cat-slate-solid", text: "text-foreground", label: "Going out" },
  compliance: { dot: "bg-destructive", text: "text-destructive", label: "Certificate expires" },
  tenancy: { dot: "bg-warning", text: "text-warning", label: "Tenancy ends" },
};

/** Compact £ for calendar cells: £1.2k, £950. */
function short(n: number): string {
  if (n >= 1000) return `£${(n / 1000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, "")}k`;
  return `£${Math.round(n)}`;
}

/**
 * Month view of the portfolio: which rents arrive and which mortgages and
 * landlord rents leave on each day, plus certificates and tenancies that end.
 * Click a day for the detail. Under it, certificates expired or due soon.
 */
export function CalendarCard({ navigate, currency, version }: { navigate: (to: string) => void; currency: string; version: number }) {
  const [month, setMonth] = useState(currentPeriod());
  const [data, setData] = useState<CalendarData | null>(null);
  const today = toIsoDate(new Date());
  const [selected, setSelected] = useState<string>(today);

  useEffect(() => {
    let cancelled = false;
    api<CalendarData>("GET", `/api/calendar?month=${month}`)
      .then((d) => { if (!cancelled) setData(d); })
      .catch(() => { if (!cancelled) setData(null); });
    return () => { cancelled = true; };
  }, [month, version]);

  const byDay = useMemo(() => {
    const m = new Map<string, CalendarEvent[]>();
    for (const e of data?.events ?? []) m.set(e.date, [...(m.get(e.date) ?? []), e]);
    return m;
  }, [data]);

  const [y, mo] = month.split("-").map(Number);
  const first = new Date(y, mo - 1, 1);
  const lead = (first.getDay() + 6) % 7; // Monday-first
  const days = data?.days_in_month ?? new Date(y, mo, 0).getDate();
  const cells: (string | null)[] = [
    ...Array.from({ length: lead }, () => null),
    ...Array.from({ length: days }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`),
  ];
  while (cells.length % 7) cells.push(null);

  const sel = selected.startsWith(month) ? selected : `${month}-01`;
  const selEvents = byDay.get(sel) ?? [];
  const money = (n: number) => formatMoney(n, currency);

  return (
    <Card className="p-5">
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <div className="mr-auto">
          <h2 className="text-sm font-semibold">Calendar</h2>
          <p className="text-xs text-muted-foreground">Rents in, mortgages and landlord rents out, and certificates that expire</p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Previous month" onClick={() => setMonth(addMonths(month, -1))} className="rounded-md p-1.5 hover:bg-muted">
            <ChevronLeft className="size-4" />
          </button>
          <button type="button" onClick={() => { setMonth(currentPeriod()); setSelected(today); }} className="min-w-[8.5rem] rounded-md px-2 py-1 text-sm font-medium hover:bg-muted">
            {formatPeriod(month)}
          </button>
          <button type="button" aria-label="Next month" onClick={() => setMonth(addMonths(month, 1))} className="rounded-md p-1.5 hover:bg-muted">
            <ChevronRight className="size-4" />
          </button>
        </div>
      </div>

      <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-success-solid" />In · <b className="font-semibold text-foreground">{money(data?.totals.in ?? 0)}</b></span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-cat-slate-solid" />Out · <b className="font-semibold text-foreground">{money(data?.totals.out ?? 0)}</b></span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-destructive" />Certificate expires</span>
        <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-warning" />Tenancy ends</span>
      </div>

      <div className="grid grid-cols-1 gap-5 xl:grid-cols-[1fr_20rem]">
        <div>
          <div className="grid grid-cols-7 gap-px overflow-hidden rounded-md border bg-border text-xs">
            {WEEKDAYS.map((d) => (
              <div key={d} className="bg-muted/60 py-1.5 text-center font-medium text-muted-foreground">{d}</div>
            ))}
            {cells.map((iso, i) => {
              if (!iso) return <div key={`e${i}`} className="min-h-[3.25rem] bg-card sm:min-h-[5.5rem]" />;
              const evs = byDay.get(iso) ?? [];
              const inSum = evs.filter((e) => e.kind === "in").reduce((a, e) => a + (e.amount ?? 0), 0);
              const outSum = evs.filter((e) => e.kind === "out").reduce((a, e) => a + (e.amount ?? 0), 0);
              const certs = evs.filter((e) => e.kind === "compliance").length;
              const ends = evs.filter((e) => e.kind === "tenancy").length;
              const isToday = iso === today;
              return (
                <button
                  key={iso}
                  type="button"
                  onClick={() => setSelected(iso)}
                  className={cn(
                    "flex min-h-[3.25rem] flex-col items-stretch gap-0.5 bg-card p-1 text-left transition-colors hover:bg-muted sm:min-h-[5.5rem] sm:p-1.5",
                    sel === iso && "bg-brand-tint hover:bg-brand-tint",
                  )}
                >
                  <span className={cn(
                    "self-start rounded px-1 text-[11px] font-medium tabular-nums",
                    isToday ? "bg-primary text-primary-foreground" : "text-muted-foreground",
                  )}>
                    {Number(iso.slice(8))}
                  </span>
                  {/* Phones: dots. Wider screens: amounts. */}
                  <span className="flex flex-wrap gap-0.5 sm:hidden">
                    {inSum > 0 && <span className="size-1.5 rounded-full bg-success-solid" />}
                    {outSum > 0 && <span className="size-1.5 rounded-full bg-cat-slate-solid" />}
                    {certs > 0 && <span className="size-1.5 rounded-full bg-destructive" />}
                    {ends > 0 && <span className="size-1.5 rounded-full bg-warning" />}
                  </span>
                  <span className="hidden flex-col gap-0.5 sm:flex">
                    {inSum > 0 && <span className="truncate rounded bg-success-tint px-1 text-[11px] font-medium tabular-nums text-success">+{short(inSum)}</span>}
                    {outSum > 0 && <span className="truncate rounded bg-muted px-1 text-[11px] font-medium tabular-nums text-foreground">−{short(outSum)}</span>}
                    {certs > 0 && <span className="truncate rounded bg-destructive-tint px-1 text-[11px] font-medium text-destructive">{certs} cert{certs > 1 ? "s" : ""}</span>}
                    {ends > 0 && <span className="truncate rounded bg-warning-tint px-1 text-[11px] font-medium text-warning">{ends} ending</span>}
                  </span>
                </button>
              );
            })}
          </div>
        </div>

        <div className="space-y-5">
          <div>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {formatDate(sel, { weekday: "long", day: "numeric", month: "long" })}
            </h3>
            {selEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing due this day.</p>
            ) : (
              <ul className="divide-y rounded-md border">
                {selEvents.map((e, i) => {
                  const k = KIND_STYLE[e.kind];
                  return (
                    <li key={i}>
                      <button type="button" onClick={() => navigate(`/properties/${e.property_id}`)} className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-muted">
                        <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", k.dot)} aria-hidden />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{e.title}</span>
                          <span className="block truncate text-xs text-muted-foreground">
                            {e.detail}{e.status === "in_arrears" ? " · in arrears" : ""}
                          </span>
                        </span>
                        {e.amount ? (
                          <span className={cn("shrink-0 text-sm font-semibold tabular-nums", k.text)}>
                            {e.kind === "in" ? "+" : "−"}{money(e.amount)}
                          </span>
                        ) : (
                          <span className={cn("shrink-0 text-xs font-medium", k.text)}>{k.label}</span>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            <h3 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              <ShieldAlert className="size-3.5" aria-hidden /> Certificates to renew
            </h3>
            {(data?.compliance_due.length ?? 0) === 0 ? (
              <p className="text-sm text-muted-foreground">
                Nothing expired or due in the next 60 days.
                {data?.compliance_missing ? ` ${data.compliance_missing} homes have no expiry dates entered yet — add them on the Compliance tab.` : ""}
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {data!.compliance_due.slice(0, 8).map((d, i) => (
                  <li key={i}>
                    <button type="button" onClick={() => navigate(`/properties/${d.property_id}`)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-muted">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-sm font-medium">{d.title}</span>
                        <span className="block text-xs text-muted-foreground">{d.detail}</span>
                      </span>
                      <span className={cn("shrink-0 text-xs font-semibold", d.expired ? "text-destructive" : "text-warning")}>
                        {d.expired ? "Expired " : "Due "}{formatDate(d.date, { day: "numeric", month: "short" })}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {(data?.compliance_due.length ?? 0) > 0 && (data?.compliance_missing ?? 0) > 0 && (
              <p className="mt-2 text-xs text-muted-foreground">{data!.compliance_missing} homes have no expiry dates entered yet.</p>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}
