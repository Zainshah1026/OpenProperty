import { useCallback, useEffect, useMemo, useState } from "react";
import { ExternalLink, FileText, Plus, Send, Sparkles, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney, toIsoDate } from "@/lib/utils";
import type { Invoice, InvoiceItem, InvoiceStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { RentReady } from "./rent-ready";

const LAST_FROM_KEY = "invoice-last-from";

function readLastFrom(): string {
  try { return localStorage.getItem(LAST_FROM_KEY) ?? ""; } catch { return ""; }
}
function saveLastFrom(v: string) {
  try { localStorage.setItem(LAST_FROM_KEY, v); } catch { /* private mode */ }
}

const STATUS: Record<InvoiceStatus, { label: string; tone: "neutral" | "info" | "success" | "warning" }> = {
  draft: { label: "Draft", tone: "warning" },
  sent: { label: "Sent", tone: "info" },
  paid: { label: "Paid", tone: "success" },
  void: { label: "Void", tone: "neutral" },
};

export function InvoicesPage() {
  const { settings, setError } = useApp();
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState<Invoice | null | undefined>(undefined); // null = new

  const load = useCallback(async () => {
    try {
      const d = await api<{ invoices: Invoice[] }>("GET", "/api/invoices");
      setInvoices(d.invoices);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [setError]);

  useEffect(() => {
    load();
    // The assistant may create drafts while this page is open.
    const onChange = () => load();
    window.addEventListener("invoices-changed", onChange);
    return () => window.removeEventListener("invoices-changed", onChange);
  }, [load]);

  const money = (n: number) => formatMoney(n, settings.currency);
  const today = toIsoDate(new Date());
  const outstanding = invoices.filter((i) => i.status === "sent").reduce((a, i) => a + i.total, 0);
  const overdue = invoices.filter((i) => i.status === "sent" && i.due_date < today);

  return (
    <PageShell
      title="Invoices"
      meta={`${invoices.length} invoices · ${money(outstanding)} awaiting payment${overdue.length ? ` · ${overdue.length} overdue` : ""}`}
      actions={<Button onClick={() => setOpen(null)}><Plus className="h-4 w-4" /> New invoice</Button>}
    >
      <RentReady onChanged={load} />
      {loading ? (
        <div className="py-16 text-center text-muted-foreground">Loading invoices…</div>
      ) : invoices.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <FileText className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No invoices yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">
            Create one here, or ask the assistant, e.g. "invoice NACCS for October's rent at 27 Reeves Avenue". Drafts are never sent until you press Send.
          </p>
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-[0.8125rem] text-muted-foreground">
                <tr>
                  <th className="h-10 px-3 font-medium">Number</th>
                  <th className="h-10 px-3 font-medium">Billed to</th>
                  <th className="h-10 px-3 font-medium">Property</th>
                  <th className="h-10 px-3 font-medium">Issued</th>
                  <th className="h-10 px-3 font-medium">Due</th>
                  <th className="h-10 px-3 text-right font-medium">Total</th>
                  <th className="h-10 px-3 font-medium">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {invoices.map((i) => {
                  const late = i.status === "sent" && i.due_date < today;
                  return (
                    <tr key={i.id} className="cursor-pointer transition-colors duration-150 hover:bg-muted" onClick={() => setOpen(i)}>
                      <td className="px-3 py-2.5 font-medium tabular-nums">
                        {i.number}
                        {i.created_by === "assistant" && <Sparkles className="ml-1 inline size-3 text-primary" aria-label="Drafted by the assistant" />}
                        {i.created_by === "auto" && <span className="ml-1 text-[10px] font-normal uppercase tracking-wide text-muted-foreground">auto</span>}
                      </td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5">{i.bill_to_name}</td>
                      <td className="max-w-[14rem] truncate px-3 py-2.5 text-muted-foreground">{i.property_ref ? `${i.property_ref} · ` : ""}{i.property_name ?? "—"}</td>
                      <td className="px-3 py-2.5 tabular-nums">{formatDate(i.issue_date)}</td>
                      <td className={cn("px-3 py-2.5 tabular-nums", late && "font-medium text-destructive")}>{formatDate(i.due_date)}</td>
                      <td className="px-3 py-2.5 text-right font-medium tabular-nums">{money(i.total)}</td>
                      <td className="px-3 py-2.5"><Badge variant={late ? "destructive" : STATUS[i.status].tone}>{late ? "Overdue" : STATUS[i.status].label}</Badge></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <InvoiceDialog invoice={open} onClose={(changed) => { setOpen(undefined); if (changed) load(); }} />
    </PageShell>
  );
}

function InvoiceDialog({ invoice, onClose }: { invoice: Invoice | null | undefined; onClose: (changed: boolean) => void }) {
  const app = useApp();
  const open = invoice !== undefined;
  const editable = !invoice || invoice.status === "draft";
  const [propertyId, setPropertyId] = useState("none");
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [address, setAddress] = useState("");
  const [issue, setIssue] = useState("");
  const [due, setDue] = useState("");
  const [items, setItems] = useState<{ description: string; amount: string }[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [confirmSend, setConfirmSend] = useState(false);
  const [from, setFrom] = useState("");
  const [senders, setSenders] = useState<string[]>([]);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setPropertyId(invoice?.property_id ? String(invoice.property_id) : "none");
    setName(invoice?.bill_to_name ?? "");
    setEmail(invoice?.bill_to_email ?? "");
    setAddress(invoice?.bill_to_address ?? "");
    setIssue(invoice?.issue_date ?? toIsoDate(new Date()));
    setDue(invoice?.due_date ?? "");
    setItems(invoice?.items.map((i) => ({ description: i.description, amount: String(i.amount) })) ?? [{ description: "", amount: "" }]);
    setNotes(invoice?.notes ?? "");
    setMessage(null);
    setConfirmSend(false);
    api<{ senders: string[]; default: string | null }>("GET", "/api/invoices/senders")
      .then((d) => {
        setSenders(d.senders);
        setFrom(invoice?.sent_from || readLastFrom() || d.default || "");
      })
      .catch(() => setFrom(readLastFrom()));
  }, [open, invoice]);

  const total = useMemo(() => items.reduce((a, i) => a + (parseFloat(i.amount.replace(/[£,]/g, "")) || 0), 0), [items]);
  const money = (n: number) => formatMoney(n, app.settings.currency);

  function pickProperty(v: string) {
    setPropertyId(v);
    const p = app.properties.find((x) => String(x.id) === v);
    if (!p) return;
    if (!name && p.tenant_label) setName(p.tenant_label);
    if (!address && p.address) setAddress(`${p.address}${p.zip ? `\n${p.zip}` : ""}`);
    if (items.length === 1 && !items[0].description && p.rent_in) {
      const month = new Date().toLocaleDateString("en-GB", { month: "long", year: "numeric" });
      setItems([{ description: `Rent for ${month}, ${p.name}`, amount: String(p.rent_in) }]);
    }
  }

  async function save(): Promise<Invoice | null> {
    const cleanItems: InvoiceItem[] = items
      .filter((i) => i.description.trim())
      .map((i) => ({ description: i.description.trim(), amount: parseFloat(i.amount.replace(/[£,]/g, "")) || 0 }));
    if (!name.trim() || !cleanItems.length) {
      setMessage("Add who it's to and at least one line.");
      return null;
    }
    const payload = {
      property_id: propertyId === "none" ? null : Number(propertyId),
      bill_to_name: name.trim(),
      bill_to_email: email.trim() || null,
      bill_to_address: address.trim() || null,
      issue_date: issue || undefined,
      due_date: due || undefined,
      items: cleanItems,
      notes: notes.trim() || null,
    };
    const res = invoice
      ? await api<{ invoice: Invoice }>("PUT", `/api/invoices/${invoice.id}`, payload)
      : await api<{ invoice: Invoice }>("POST", "/api/invoices", payload);
    return res.invoice;
  }

  async function act(fn: () => Promise<void>) {
    setBusy(true);
    setMessage(null);
    try {
      await fn();
    } catch (err) {
      setMessage((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const doSave = () => act(async () => { if (await save()) onClose(true); });
  const doSend = () => act(async () => {
    const saved = editable ? await save() : invoice!;
    if (!saved) return;
    await api("POST", `/api/invoices/${saved.id}/send`, { to: email.trim(), from: from.trim() });
    saveLastFrom(from.trim());
    onClose(true);
  });
  const setStatus = (status: InvoiceStatus) => act(async () => {
    await api("PUT", `/api/invoices/${invoice!.id}`, { status });
    onClose(true);
  });
  const doDelete = () => act(async () => {
    await api("DELETE", `/api/invoices/${invoice!.id}`);
    onClose(true);
  });

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {invoice ? `Invoice ${invoice.number}` : "New invoice"}
              {invoice && <Badge variant={STATUS[invoice.status].tone} className="ml-2 align-middle">{STATUS[invoice.status].label}</Badge>}
            </DialogTitle>
          </DialogHeader>

          {invoice?.created_by === "assistant" && invoice.status === "draft" && (
            <p className="flex items-center gap-1.5 rounded-md bg-brand-tint px-3 py-2 text-xs text-brand-text">
              <Sparkles className="size-3.5" /> Drafted by the assistant. Check the details before sending.
            </p>
          )}
          {invoice?.created_by === "auto" && invoice.status === "draft" && (
            <p className="rounded-md bg-brand-tint px-3 py-2 text-xs text-brand-text">
              Drafted automatically ahead of the rent due date. Check it, then send it here or with "Send" on the rent invoices list.
            </p>
          )}
          {invoice?.sent_at && (
            <p className="text-xs text-muted-foreground">Sent to {invoice.sent_to}{invoice.sent_from ? ` from ${invoice.sent_from}` : ""} on {formatDate(invoice.sent_at)}{invoice.paid_at ? ` · paid ${formatDate(invoice.paid_at)}` : ""}</p>
          )}

          <fieldset disabled={!editable || busy} className="grid gap-3">
            <div>
              <Label className="mb-1 block">Property (optional)</Label>
              <Select value={propertyId} onValueChange={pickProperty}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No property</SelectItem>
                  {app.properties.map((p) => <SelectItem key={p.id} value={String(p.id)}>{p.ref ? `${p.ref} · ` : ""}{p.name}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div><Label className="mb-1 block">Bill to</Label><Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tenant, agent or leaseholder" /></div>
              <div><Label className="mb-1 block">Email</Label><Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="Where to send it" /></div>
            </div>
            <div><Label className="mb-1 block">Address</Label><Textarea rows={2} value={address} onChange={(e) => setAddress(e.target.value)} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div><Label className="mb-1 block">Issue date</Label><Input type="date" value={issue} onChange={(e) => setIssue(e.target.value)} /></div>
              <div><Label className="mb-1 block">Due date</Label><Input type="date" value={due} onChange={(e) => setDue(e.target.value)} placeholder="Uses your payment terms" /></div>
            </div>

            <div>
              <Label className="mb-1 block">Lines</Label>
              <div className="grid gap-2">
                {items.map((it, idx) => (
                  <div key={idx} className="flex gap-2">
                    <Input className="flex-1" value={it.description} placeholder="e.g. Rent for November 2026" onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, description: e.target.value } : x)))} />
                    <Input className="w-28" inputMode="decimal" value={it.amount} placeholder="£" onChange={(e) => setItems(items.map((x, i) => (i === idx ? { ...x, amount: e.target.value } : x)))} />
                    {editable && items.length > 1 && (
                      <Button type="button" variant="ghost" size="sm" aria-label="Remove line" onClick={() => setItems(items.filter((_, i) => i !== idx))}><Trash2 className="size-4" /></Button>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 flex items-center justify-between">
                {editable ? (
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setItems([...items, { description: "", amount: "" }])}>+ Add line</button>
                ) : <span />}
                <span className="text-sm">Total <b className="tabular-nums">{money(total)}</b></span>
              </div>
            </div>
            <div><Label className="mb-1 block">Note on the invoice</Label><Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
          </fieldset>

          {message && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{message}</p>}

          {confirmSend && (
            <div className="rounded-md border border-primary/40 bg-brand-tint p-3 text-sm">
              <Label htmlFor="inv-from" className="mb-1 block">Send from</Label>
              <Input
                id="inv-from"
                type="email"
                list="inv-from-options"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                placeholder="e.g. accounts@chistiandco.com"
                className="mb-1 bg-card"
              />
              <datalist id="inv-from-options">
                {senders.map((s) => <option key={s} value={s} />)}
              </datalist>
              <p className="mb-3 text-xs text-muted-foreground">
                Pick a saved address or type any address on a domain verified in Resend. Replies go to this address.
              </p>
              Send invoice{invoice ? ` ${invoice.number}` : ""} for <b>{money(total)}</b> to <b>{email || "(no email)"}</b>
              {from.trim() ? <> from <b>{from.trim()}</b></> : null}?
              <div className="mt-2 flex gap-2">
                <Button size="sm" onClick={doSend} disabled={busy || !email.trim() || !from.trim()}><Send className="h-4 w-4" /> Yes, send it</Button>
                <Button size="sm" variant="ghost" onClick={() => setConfirmSend(false)}>Cancel</Button>
              </div>
            </div>
          )}

          <DialogFooter className="mt-2 flex-wrap gap-2">
            {invoice && (
              <a href={`/invoices/${invoice.id}/print`} target="_blank" rel="noreferrer" className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline">
                <ExternalLink className="size-3.5" /> View / print
              </a>
            )}
            {invoice?.status === "draft" && <Button variant="ghost" onClick={() => setConfirmDelete(true)} disabled={busy}>Delete</Button>}
            {invoice && invoice.status === "sent" && <Button variant="outline" onClick={() => setStatus("paid")} disabled={busy}>Mark paid</Button>}
            {invoice && (invoice.status === "sent" || invoice.status === "paid") && <Button variant="ghost" onClick={() => setStatus("void")} disabled={busy}>Void</Button>}
            {editable && <Button variant="outline" onClick={doSave} disabled={busy}>{invoice ? "Save draft" : "Save as draft"}</Button>}
            {invoice?.status !== "void" && (
              <Button onClick={() => setConfirmSend(true)} disabled={busy || confirmSend}>
                <Send className="h-4 w-4" /> {invoice?.status === "sent" || invoice?.status === "paid" ? "Send again" : "Send"}
              </Button>
            )}
          </DialogFooter>
          {invoice?.status !== "draft" && invoice && (
            <p className="text-xs text-muted-foreground">Sent invoices can't be edited. Void it and create a new one if something's wrong.</p>
          )}
        </DialogContent>
      </Dialog>
      {invoice && (
        <ConfirmDelete open={confirmDelete} onOpenChange={setConfirmDelete} title={`Delete draft ${invoice.number}?`} description="This cannot be undone." onConfirm={doDelete} />
      )}
    </>
  );
}
