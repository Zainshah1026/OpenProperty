import { useCallback, useEffect, useState } from "react";
import { CalendarClock, Send } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { formatDate, formatMoney } from "@/lib/utils";
import type { Invoice } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";

interface Ready {
  from: string;
  invoices: Invoice[];
}

/**
 * Rent invoices the app drafted ahead of each due date, waiting for someone
 * to check them and press Send. `compact` is the dashboard version: a one-line
 * prompt that links to the Invoices page.
 */
export function RentReady({ compact, navigate, onChanged }: { compact?: boolean; navigate?: (to: string) => void; onChanged?: () => void }) {
  const { settings, setError } = useApp();
  const [data, setData] = useState<Ready | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await api<Ready>("GET", "/api/invoices/rent-ready"));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [setError]);

  useEffect(() => {
    load();
    const onChange = () => load();
    window.addEventListener("invoices-changed", onChange);
    return () => window.removeEventListener("invoices-changed", onChange);
  }, [load]);

  if (!data || data.invoices.length === 0) {
    return result ? <p className="mb-3 rounded-md bg-success-tint px-3 py-2 text-sm text-success" role="status">{result}</p> : null;
  }

  const money = (n: number) => formatMoney(n, settings.currency);
  const sendable = data.invoices.filter((i) => i.bill_to_email);
  const noEmail = data.invoices.length - sendable.length;
  const total = sendable.reduce((a, i) => a + i.total, 0);

  if (compact) {
    return (
      <button
        type="button"
        onClick={() => navigate?.("/invoices")}
        className="mb-4 flex w-full items-center gap-3 rounded-lg border border-primary/40 bg-brand-tint px-4 py-3 text-left text-sm hover:bg-muted"
      >
        <CalendarClock className="size-5 shrink-0 text-primary" aria-hidden />
        <span className="flex-1">
          <b>{data.invoices.length} rent invoice{data.invoices.length === 1 ? "" : "s"} ready to send</b>
          <span className="text-muted-foreground"> · rent due within the next {settings.rent_invoice_days_before || 7} days{noEmail ? ` · ${noEmail} missing an email` : ""}</span>
        </span>
        <span className="font-medium text-primary">Review</span>
      </button>
    );
  }

  async function sendAll() {
    setBusy(true);
    setResult(null);
    try {
      const r = await api<{ sent: number; results: { number: string; ok: boolean; error?: string }[] }>("POST", "/api/invoices/send-batch", {
        ids: sendable.map((i) => i.id),
        from: data!.from,
      });
      const failed = r.results.filter((x) => !x.ok);
      setResult(
        `Sent ${r.sent} rent invoice${r.sent === 1 ? "" : "s"} from ${data!.from}.` +
          (failed.length ? ` Not sent: ${failed.map((f) => `${f.number} (${f.error})`).join("; ")}` : ""),
      );
      setConfirming(false);
      await load();
      onChanged?.();
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mb-4 border-primary/40 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-2 text-sm font-semibold">
            <CalendarClock className="size-4 text-primary" aria-hidden /> Rent invoices ready to send
          </h2>
          <p className="text-xs text-muted-foreground">
            Drafted automatically {settings.rent_invoice_days_before || 7} days before each rent is due. Check them, then send. Click an invoice in the list below to change it.
          </p>
        </div>
        {sendable.length > 0 && !confirming && (
          <Button size="sm" onClick={() => setConfirming(true)}><Send className="h-4 w-4" /> Send {sendable.length}</Button>
        )}
      </div>

      <ul className="mt-3 divide-y text-sm">
        {data.invoices.map((i) => (
          <li key={i.id} className="flex flex-wrap items-center gap-x-3 gap-y-0.5 py-2">
            <span className="w-20 font-medium tabular-nums">{i.number}</span>
            <span className="min-w-0 flex-1 truncate">{i.bill_to_name} · <span className="text-muted-foreground">{i.items[0]?.description}</span></span>
            <span className="text-xs text-muted-foreground">due {formatDate(i.due_date)}</span>
            <span className="w-20 text-right font-medium tabular-nums">{money(i.total)}</span>
            {i.bill_to_email ? (
              <span className="w-full truncate text-xs text-muted-foreground sm:w-56">{i.bill_to_email}</span>
            ) : (
              <span className="w-full text-xs text-warning sm:w-56">No email: add one in the sheet's Tenant Email column</span>
            )}
          </li>
        ))}
      </ul>

      {confirming && (
        <div className="mt-3 rounded-md border border-primary/40 bg-brand-tint p-3 text-sm">
          Send <b>{sendable.length}</b> rent invoice{sendable.length === 1 ? "" : "s"} totalling <b>{money(total)}</b> from <b>{data.from}</b>, each to the tenant's email above?
          {noEmail > 0 && <> {noEmail} without an email will stay as drafts.</>}
          <div className="mt-2 flex gap-2">
            <Button size="sm" onClick={sendAll} disabled={busy}><Send className="h-4 w-4" /> {busy ? "Sending…" : "Yes, send them"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      )}
      {result && <p className="mt-3 text-sm" role="status">{result}</p>}
    </Card>
  );
}
