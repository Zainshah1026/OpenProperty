import { useCallback, useEffect, useMemo, useState } from "react";
import { Mail, Phone, Plus, Search, Briefcase } from "lucide-react";
import { useApp } from "@/context";
import { formatMoney } from "@/lib/utils";
import { LEAD_STATUS, leadStatusLabel } from "@/lib/portfolio";
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
import type { LeadStatus, NewSalesLead, SalesLead } from "@/types";

const ALL = "__all";

const STATUS_TONE: Record<LeadStatus, "neutral" | "info" | "warning" | "success" | "brand"> = {
  new: "neutral",
  contacted: "info",
  viewing: "info",
  offer_made: "warning",
  under_offer: "brand",
  completed: "success",
  withdrawn: "neutral",
};

export function SalesPage() {
  const app = useApp();
  const [leads, setLeads] = useState<SalesLead[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState(ALL);
  const [editing, setEditing] = useState<SalesLead | null | undefined>(undefined); // null = new

  const { listLeads, setError } = app;
  const load = useCallback(async () => {
    try {
      setLeads(await listLeads());
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [listLeads, setError]);

  useEffect(() => { load(); }, [load]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return leads.filter((l) => {
      if (status !== ALL && l.status !== status) return false;
      if (!needle) return true;
      return [l.landlord_name, l.phone, l.email, l.location, l.address, l.postcode].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [leads, q, status]);

  const active = leads.filter((l) => !["completed", "withdrawn"].includes(l.status)).length;
  const money = (n: number | null) => (n ? formatMoney(n, app.settings.currency) : "—");

  return (
    <PageShell
      title="Sales leads"
      meta={`${leads.length} leads · ${active} active`}
      actions={<Button onClick={() => setEditing(null)}><Plus className="h-4 w-4" /> New lead</Button>}
    >
      {loading ? (
        <div className="py-16 text-center text-muted-foreground">Loading leads…</div>
      ) : leads.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Briefcase className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No leads yet</p>
          <p className="max-w-sm text-sm text-muted-foreground">Track landlords selling, what they're asking and where each deal is up to.</p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, phone, area…" className="pl-8" />
            </div>
            <Select value={status} onValueChange={setStatus}>
              <SelectTrigger className="h-9 w-auto min-w-[9rem]"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>Any status</SelectItem>
                {LEAD_STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}
              </SelectContent>
            </Select>
          </div>
          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[880px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-[0.8125rem] text-muted-foreground">
                  <tr>
                    <th className="h-10 px-3 font-medium">Landlord</th>
                    <th className="h-10 px-3 font-medium">Contact</th>
                    <th className="h-10 px-3 font-medium">Property</th>
                    <th className="h-10 px-3 text-right font-medium">Asking</th>
                    <th className="h-10 px-3 text-right font-medium">Offer</th>
                    <th className="h-10 px-3 font-medium">Status</th>
                    <th className="h-10 px-3 font-medium">Next action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((l) => (
                    <tr key={l.id} className="cursor-pointer transition-colors duration-150 hover:bg-muted" onClick={() => setEditing(l)}>
                      <td className="px-3 py-2.5 font-medium">{l.landlord_name}</td>
                      <td className="px-3 py-2.5 text-xs">
                        {l.phone && (
                          <a href={`tel:${l.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 hover:underline">
                            <Phone className="size-3" aria-hidden />{l.phone}
                          </a>
                        )}
                        {l.email && (
                          <a href={`mailto:${l.email}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 text-muted-foreground hover:underline">
                            <Mail className="size-3" aria-hidden />{l.email}
                          </a>
                        )}
                      </td>
                      <td className="max-w-[14rem] px-3 py-2.5">
                        <div className="truncate">{[l.address, l.location].filter(Boolean).join(", ") || "—"}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[l.property_type, l.bedrooms ? `${l.bedrooms} bed` : null, l.tenure].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(l.asking_price)}</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(l.offer_amount)}</td>
                      <td className="px-3 py-2.5"><Badge variant={STATUS_TONE[l.status]}>{leadStatusLabel(l.status)}</Badge></td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 text-muted-foreground">{l.next_action || "—"}</td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">No leads match.</td></tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}

      <LeadDialog lead={editing} onClose={(changed) => { setEditing(undefined); if (changed) load(); }} />
    </PageShell>
  );
}

const TEXT = ["landlord_name", "phone", "email", "location", "address", "postcode", "property_type", "tenure", "buyer_agent", "solicitor", "next_action", "notes"] as const;
const NUM = ["asking_price", "estimated_value", "offer_amount"] as const;
const INT = ["bedrooms", "bathrooms"] as const;

function LeadDialog({ lead, onClose }: { lead: SalesLead | null | undefined; onClose: (changed: boolean) => void }) {
  const app = useApp();
  const open = lead !== undefined;
  const [f, setF] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = { status: lead?.status ?? "new" };
    for (const k of [...TEXT, ...NUM, ...INT]) {
      const v = lead ? lead[k] : null;
      next[k] = v === null || v === undefined ? "" : String(v);
    }
    setF(next);
  }, [open, lead]);

  const bind = (k: string) => ({ value: f[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value })) });

  async function save() {
    if (!f.landlord_name?.trim()) return;
    setSaving(true);
    try {
      const payload: NewSalesLead = { landlord_name: f.landlord_name.trim() };
      const out = payload as unknown as Record<string, unknown>;
      for (const k of TEXT) if (k !== "landlord_name") out[k] = f[k]?.trim() || null;
      for (const k of NUM) out[k] = f[k] ? parseFloat(f[k].replace(/[£,]/g, "")) || null : null;
      for (const k of INT) { const n = parseInt(f[k], 10); out[k] = Number.isFinite(n) ? n : null; }
      payload.status = f.status as LeadStatus;
      if (lead) await app.updateLead(lead.id, payload);
      else await app.createLead(payload);
      onClose(true);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!lead) return;
    try {
      await app.deleteLead(lead.id);
      onClose(true);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{lead ? "Edit lead" : "New lead"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid grid-cols-3 gap-3">
              <F label="Landlord name" className="col-span-3 sm:col-span-1"><Input {...bind("landlord_name")} /></F>
              <F label="Phone"><Input {...bind("phone")} /></F>
              <F label="Email"><Input type="email" {...bind("email")} /></F>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Location"><Input {...bind("location")} /></F>
              <F label="Address"><Input {...bind("address")} /></F>
              <F label="Postcode"><Input {...bind("postcode")} /></F>
            </div>
            <div className="grid grid-cols-4 gap-3">
              <F label="Type"><Input {...bind("property_type")} placeholder="Flat" /></F>
              <F label="Beds"><Input type="number" min={0} {...bind("bedrooms")} /></F>
              <F label="Baths"><Input type="number" min={0} {...bind("bathrooms")} /></F>
              <F label="Tenure"><Input {...bind("tenure")} placeholder="Leasehold" /></F>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Asking price (£)"><Input inputMode="decimal" {...bind("asking_price")} /></F>
              <F label="Estimated value (£)"><Input inputMode="decimal" {...bind("estimated_value")} /></F>
              <F label="Offer (£)"><Input inputMode="decimal" {...bind("offer_amount")} /></F>
            </div>
            <div className="grid grid-cols-3 gap-3">
              <F label="Status">
                <Select value={f.status ?? "new"} onValueChange={(v) => setF((p) => ({ ...p, status: v }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>{LEAD_STATUS.map((s) => <SelectItem key={s.value} value={s.value}>{s.label}</SelectItem>)}</SelectContent>
                </Select>
              </F>
              <F label="Buyer / agent"><Input {...bind("buyer_agent")} /></F>
              <F label="Solicitor"><Input {...bind("solicitor")} /></F>
            </div>
            <F label="Next action"><Input {...bind("next_action")} /></F>
            <F label="Notes"><Textarea rows={3} {...bind("notes")} /></F>
          </div>
          <DialogFooter className="mt-2">
            {lead && <Button variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>Delete</Button>}
            <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
            <Button onClick={save} disabled={saving || !f.landlord_name?.trim()}>{lead ? "Save changes" : "Add lead"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {lead && (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete lead "${lead.landlord_name}"?`}
          description="This cannot be undone."
          onConfirm={remove}
        />
      )}
    </>
  );
}

function F({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1 block">{label}</Label>
      {children}
    </div>
  );
}
