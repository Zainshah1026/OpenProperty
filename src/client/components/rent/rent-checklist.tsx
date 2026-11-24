import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney, formatPeriod } from "@/lib/utils";
import { Card } from "@/components/ui/card";

interface RentItem {
  key: string;
  property_id: number;
  ref: string | null;
  home: string;
  who: string;
  amount: number;
  due_date: string | null;
  paid: boolean;
  paid_amount: number | null;
  paid_on: string | null;
  ticked_by: string | null;
}

type Filter = "todo" | "all" | "paid";

/** Every rent expected this month, ticked off by hand as it arrives. */
export function RentChecklist({ month }: { month: string }) {
  const app = useApp();
  const [items, setItems] = useState<RentItem[]>([]);
  const [today, setToday] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [filter, setFilter] = useState<Filter>("todo");
  const money = (n: number) => formatMoney(n, app.settings.currency);

  useEffect(() => {
    let live = true;
    setLoading(true);
    api<{ items: RentItem[]; today: string }>("GET", `/api/rent-checklist?month=${month}`)
      .then((r) => { if (live) { setItems(r.items); setToday(r.today); } })
      .catch((err) => app.setError((err as Error).message))
      .finally(() => { if (live) setLoading(false); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [month]);

  async function toggle(it: RentItem) {
    setBusy(it.key);
    // Show the tick straight away; put it back if saving fails.
    setItems((xs) => xs.map((x) => (x.key === it.key ? { ...x, paid: !it.paid, paid_on: !it.paid ? today : null } : x)));
    try {
      const r = await api<{ item: RentItem | null }>("PUT", "/api/rent-checklist", { month, key: it.key, paid: !it.paid });
      if (r.item) setItems((xs) => xs.map((x) => (x.key === it.key ? r.item! : x)));
    } catch (err) {
      setItems((xs) => xs.map((x) => (x.key === it.key ? it : x)));
      app.setError((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const isLate = (it: RentItem) => !it.paid && !!it.due_date && it.due_date < today;
  const totals = useMemo(() => {
    const sum = (xs: RentItem[]) => xs.reduce((s, x) => s + (x.paid ? x.paid_amount ?? x.amount : x.amount), 0);
    const paid = items.filter((x) => x.paid);
    const late = items.filter(isLate);
    return { expected: sum(items), paid: sum(paid), paidN: paid.length, late: sum(late), lateN: late.length, left: sum(items.filter((x) => !x.paid)) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, today]);

  const shown = items.filter((x) => (filter === "all" ? true : filter === "paid" ? x.paid : !x.paid));

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Due this month" value={money(totals.expected)} sub={`${items.length} payments`} />
        <Stat label="Ticked off" value={money(totals.paid)} sub={`${totals.paidN} of ${items.length}`} tone="positive" />
        <Stat label="Still to come" value={money(totals.left)} sub={`${items.length - totals.paidN} payments`} />
        <Stat label="Late" value={money(totals.late)} sub={totals.lateN ? `${totals.lateN} past the due date` : "Nothing late"} tone={totals.lateN ? "danger" : "default"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Rent for {formatPeriod(month)}</h2>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-full bg-muted p-[0.1875rem] text-sm">
          {([["todo", "Not paid yet"], ["paid", "Paid"], ["all", "All"]] as const).map(([v, label]) => (
            <button
              key={v}
              type="button"
              role="radio"
              aria-checked={filter === v}
              onClick={() => setFilter(v)}
              className={cn("rounded-full px-3 py-1 font-medium transition-colors", filter === v ? "bg-card text-foreground shadow-raised" : "text-muted-foreground hover:text-foreground")}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <Card className="divide-y divide-border overflow-hidden" role="status" aria-label="Loading rent">
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="flex h-14 items-center gap-4 px-4" aria-hidden>
              <div className="size-6 animate-pulse rounded-md bg-muted" />
              <div className="h-2.5 w-40 animate-pulse rounded-full bg-muted" />
              <div className="ml-auto h-2.5 w-16 animate-pulse rounded-full bg-muted" />
            </div>
          ))}
        </Card>
      ) : shown.length === 0 ? (
        <div className="flex flex-col items-center gap-2 px-6 py-14 text-center">
          <CircleCheck className="size-7 text-success" aria-hidden />
          <p className="font-medium">
            {items.length === 0 ? "No rent set up for this month" : filter === "todo" ? "All rent for this month is ticked off" : "Nothing ticked off yet"}
          </p>
          {items.length === 0 && (
            <p className="max-w-sm text-sm text-muted-foreground">Add each home's rent and pay day, or each room's rent in a shared house, and it will show here.</p>
          )}
        </div>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {shown.map((it) => {
            const late = isLate(it);
            return (
              <button
                key={it.key}
                type="button"
                role="checkbox"
                aria-checked={it.paid}
                disabled={busy === it.key}
                onClick={() => toggle(it)}
                className={cn("flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none", it.paid && "bg-success-tint/40")}
              >
                <span
                  aria-hidden
                  className={cn(
                    "flex size-6 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                    it.paid ? "border-success bg-success text-white" : late ? "border-destructive" : "border-border",
                  )}
                >
                  {it.paid && <Check className="size-4" strokeWidth={3} />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {it.ref && <span className="text-muted-foreground">Ref {it.ref} · </span>}
                    {it.home}
                  </span>
                  <span className="block truncate text-xs text-muted-foreground">{it.who}</span>
                </span>
                <span className="shrink-0 text-right">
                  <span className={cn("block text-sm font-semibold tabular-nums", it.paid && "text-success")}>{money(it.paid ? it.paid_amount ?? it.amount : it.amount)}</span>
                  <span className={cn("block text-xs", late ? "font-medium text-destructive" : "text-muted-foreground")}>
                    {it.paid
                      ? `Paid ${it.paid_on ? formatDate(it.paid_on, { day: "numeric", month: "short" }) : ""}`
                      : it.due_date
                        ? `${late ? "Was due" : "Due"} ${formatDate(it.due_date, { day: "numeric", month: "short" })}`
                        : "No pay day set"}
                  </span>
                </span>
              </button>
            );
          })}
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Tap a payment to tick it off. If one is still not ticked 3 days after it was due, Jarvis sends you a notification.
      </p>
    </section>
  );
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "positive" | "danger" }) {
  return (
    <Card className="p-4">
      <div className="stat-label">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "positive" && "text-success", tone === "danger" && "text-destructive")}>{value}</div>
      {sub && <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
}
