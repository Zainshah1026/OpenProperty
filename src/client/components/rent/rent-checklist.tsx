import { useEffect, useMemo, useState } from "react";
import { Check, CircleCheck, Pencil } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney, formatPeriod } from "@/lib/utils";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

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
  const [editing, setEditing] = useState<RentItem | null>(null);
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

  async function save(it: RentItem, body: { paid: boolean; amount?: number | null; paid_on?: string | null }) {
    setBusy(it.key);
    try {
      const r = await api<{ item: RentItem | null }>("PUT", "/api/rent-checklist", { month, key: it.key, ...body });
      if (r.item) setItems((xs) => xs.map((x) => (x.key === it.key ? r.item! : x)));
      return true;
    } catch (err) {
      app.setError((err as Error).message);
      return false;
    } finally {
      setBusy(null);
    }
  }

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
    const got = (x: RentItem) => (x.paid ? x.paid_amount ?? x.amount : 0);
    const owed = (x: RentItem) => Math.max(0, x.amount - got(x));
    const paid = items.filter((x) => x.paid);
    const late = items.filter(isLate);
    const short = paid.filter((x) => owed(x) > 0);
    return {
      expected: items.reduce((s, x) => s + x.amount, 0),
      paid: items.reduce((s, x) => s + got(x), 0),
      paidN: paid.length,
      late: late.reduce((s, x) => s + x.amount, 0) + short.reduce((s, x) => s + owed(x), 0),
      lateN: late.length + short.length,
      left: items.reduce((s, x) => s + owed(x), 0),
      leftN: items.length - paid.length + short.length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, today]);

  const owes = (x: RentItem) => !x.paid || (x.paid_amount != null && x.paid_amount < x.amount);
  const shown = items.filter((x) => (filter === "all" ? true : filter === "paid" ? x.paid : owes(x)));

  return (
    <section className="space-y-4">
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <Stat label="Due this month" value={money(totals.expected)} sub={`${items.length} payments`} />
        <Stat label="Ticked off" value={money(totals.paid)} sub={`${totals.paidN} of ${items.length}`} tone="positive" />
        <Stat label="Still to come" value={money(totals.left)} sub={`${totals.leftN} payments`} />
        <Stat label="Late" value={money(totals.late)} sub={totals.lateN ? `${totals.lateN} late or short` : "Nothing late"} tone={totals.lateN ? "danger" : "default"} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-base font-semibold">Rent for {formatPeriod(month)}</h2>
        <div role="radiogroup" aria-label="Show" className="inline-flex rounded-full bg-muted p-[0.1875rem] text-sm">
          {([["todo", "Still owed"], ["paid", "Paid"], ["all", "All"]] as const).map(([v, label]) => (
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
            {items.length === 0 ? "No rent set up for this month" : filter === "todo" ? "All rent for this month is paid in full" : "Nothing ticked off yet"}
          </p>
          {items.length === 0 && (
            <p className="max-w-sm text-sm text-muted-foreground">Add each home's rent and pay day, or each room's rent in a shared house, and it will show here.</p>
          )}
        </div>
      ) : (
        <Card className="divide-y divide-border overflow-hidden">
          {shown.map((it) => {
            const late = isLate(it);
            const got = it.paid ? it.paid_amount ?? it.amount : 0;
            const short = it.paid && got < it.amount;
            return (
              <div key={it.key} className={cn("flex items-center", it.paid && (short ? "bg-warning-tint/40" : "bg-success-tint/40"))}>
                <button
                  type="button"
                  role="checkbox"
                  aria-checked={it.paid}
                  aria-label={`${it.paid ? "Untick" : "Tick off"} ${it.home} ${it.who}`}
                  disabled={busy === it.key}
                  onClick={() => toggle(it)}
                  className="flex self-stretch items-center pl-4 pr-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <span
                    aria-hidden
                    className={cn(
                      "flex size-7 shrink-0 items-center justify-center rounded-md border-2 transition-colors",
                      it.paid ? (short ? "border-warning bg-warning text-white" : "border-success bg-success text-white") : late ? "border-destructive" : "border-border",
                    )}
                  >
                    {it.paid && <Check className="size-4" strokeWidth={3} />}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(it)}
                  className="flex min-w-0 flex-1 items-center gap-3 py-3 pl-1 pr-4 text-left hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:outline-none"
                  aria-label={`Change what was paid for ${it.home} ${it.who}`}
                >
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">
                      {it.ref && <span className="text-muted-foreground">Ref {it.ref} · </span>}
                      {it.home}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">{it.who}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className={cn("block text-sm font-semibold tabular-nums", it.paid && (short ? "text-warning" : "text-success"))}>
                      {it.paid ? money(got) : money(it.amount)}
                      {short && <span className="font-normal text-muted-foreground"> of {money(it.amount)}</span>}
                    </span>
                    <span className={cn("block text-xs", late ? "font-medium text-destructive" : short ? "font-medium text-warning" : "text-muted-foreground")}>
                      {short
                        ? `${money(it.amount - got)} short`
                        : it.paid
                          ? `Paid ${it.paid_on ? formatDate(it.paid_on, { day: "numeric", month: "short" }) : ""}`
                          : it.due_date
                            ? `${late ? "Was due" : "Due"} ${formatDate(it.due_date, { day: "numeric", month: "short" })}`
                            : "No pay day set"}
                    </span>
                  </span>
                  <Pencil className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
                </button>
              </div>
            );
          })}
        </Card>
      )}
      <p className="text-xs text-muted-foreground">
        Tap the box to tick off the full rent. Tap the rest of the row to put in a smaller amount if a tenant paid less. If rent is still not ticked 3 days after it was due, Jarvis sends you a notification.
      </p>
      <PaidDialog
        item={editing}
        today={today}
        busy={!!editing && busy === editing.key}
        money={money}
        onClose={() => setEditing(null)}
        onSave={async (body) => { if (editing && (await save(editing, body))) setEditing(null); }}
      />
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

function PaidDialog({ item, today, busy, money, onClose, onSave }: {
  item: RentItem | null;
  today: string;
  busy: boolean;
  money: (n: number) => string;
  onClose: () => void;
  onSave: (body: { paid: boolean; amount?: number | null; paid_on?: string | null }) => void;
}) {
  const [amount, setAmount] = useState("");
  const [date, setDate] = useState(today);
  useEffect(() => {
    if (!item) return;
    setAmount(String(item.paid ? item.paid_amount ?? item.amount : item.amount));
    setDate(item.paid_on ?? today);
  }, [item, today]);
  if (!item) return null;
  const n = Number(amount.replace(/[£,\s]/g, ""));
  const valid = amount.trim() !== "" && Number.isFinite(n) && n >= 0;
  const short = valid && n < item.amount;
  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{item.ref ? `Ref ${item.ref} · ` : ""}{item.home}</DialogTitle>
        </DialogHeader>
        <p className="text-sm text-muted-foreground">{item.who} · rent {money(item.amount)}</p>
        <form
          className="space-y-4"
          onSubmit={(e) => { e.preventDefault(); if (valid) onSave({ paid: true, amount: n === item.amount ? null : n, paid_on: date }); }}
        >
          <div className="space-y-1.5">
            <Label htmlFor="rent-paid-amount">Amount paid</Label>
            <Input id="rent-paid-amount" inputMode="decimal" autoFocus value={amount} onChange={(e) => setAmount(e.target.value)} />
            {short && <p className="text-xs font-medium text-warning">{money(item.amount - n)} short of the full rent</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="rent-paid-date">Date paid</Label>
            <Input id="rent-paid-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <DialogFooter className="gap-2">
            {item.paid && (
              <Button type="button" variant="ghost" disabled={busy} onClick={() => onSave({ paid: false })}>
                Mark not paid
              </Button>
            )}
            <Button type="submit" disabled={!valid || busy}>Save</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
