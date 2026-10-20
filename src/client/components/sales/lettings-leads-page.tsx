import { useCallback, useEffect, useMemo, useState } from "react";
import { Copy, KeyRound, Mail, Phone, Plus, Search } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate } from "@/lib/utils";
import type { LettingsLead, LettingsStatus } from "@/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { SyncBanner } from "@/components/sync-banner";

export const LETTINGS_STATUS: { value: LettingsStatus; label: string; tone: "neutral" | "info" | "warning" | "success" | "brand" }[] = [
  { value: "new", label: "New", tone: "brand" },
  { value: "contacted", label: "Contacted", tone: "info" },
  { value: "viewing", label: "Viewing booked", tone: "info" },
  { value: "offer_sent", label: "Offer sent", tone: "warning" },
  { value: "signed", label: "Signed", tone: "success" },
  { value: "not_interested", label: "Not interested", tone: "neutral" },
];
const STATUS = Object.fromEntries(LETTINGS_STATUS.map((s) => [s.value, s])) as Record<LettingsStatus, (typeof LETTINGS_STATUS)[number]>;

type Source = "all" | "guaranteed" | "form";
const isGuaranteed = (l: LettingsLead) => /landlords ad|guaranteed/i.test(l.source ?? "");
const isForm = (l: LettingsLead) => /chisti/i.test(l.source ?? "");
/** Soonest first: these are the landlords to ring first. */
const URGENCY: Record<string, number> = { immediately: 0, now: 0, "within 30 days": 1, "1–3 months": 2, "just exploring": 3 };

const selectCls = "h-9 rounded-lg border border-input bg-card px-2.5 text-sm";

export function LettingsLeadsPage() {
  const { setError } = useApp();
  const [leads, setLeads] = useState<LettingsLead[] | null>(null);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState<string>("open");
  const [source, setSource] = useState<Source>("all");
  const [when, setWhen] = useState<string>("all");
  const [editing, setEditing] = useState<LettingsLead | null | undefined>(undefined);

  const load = useCallback(() => {
    api<{ leads: LettingsLead[] }>("GET", "/api/lettings-leads").then((r) => setLeads(r.leads)).catch((e) => setError((e as Error).message));
  }, [setError]);
  useEffect(load, [load]);

  const all = leads ?? [];
  const counts = useMemo(() => {
    const by = (s: LettingsStatus) => all.filter((l) => l.status === s).length;
    return {
      total: all.length,
      fresh: by("new"),
      working: by("contacted") + by("viewing") + by("offer_sent"),
      signed: by("signed"),
      ready: all.filter((l) => l.status === "new" && (URGENCY[(l.when_to_let ?? "").toLowerCase()] ?? 9) <= 1).length,
      guaranteed: all.filter(isGuaranteed).length,
      form: all.filter(isForm).length,
    };
  }, [all]);

  const whenOptions = useMemo(() => Array.from(new Set<string>(all.map((l) => l.when_to_let).filter((x): x is string => !!x))).sort((a: string, b: string) => (URGENCY[a.toLowerCase()] ?? 9) - (URGENCY[b.toLowerCase()] ?? 9)), [all]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return all.filter((l) => {
      if (status === "open" && ["signed", "not_interested"].includes(l.status)) return false;
      if (status !== "open" && status !== "all" && l.status !== status) return false;
      if (source === "guaranteed" && !isGuaranteed(l)) return false;
      if (source === "form" && !isForm(l)) return false;
      if (when !== "all" && l.when_to_let !== when) return false;
      if (!needle) return true;
      return [l.name, l.phone, l.email, l.location, l.postcode, l.notes].some((v) => v?.toLowerCase().includes(needle));
    });
  }, [all, q, status, source, when]);

  return (
    <PageShell
      title="Lettings leads"
      meta={leads ? `${counts.total} landlords · ${counts.fresh} new · ${counts.signed} signed` : "Loading…"}
      actions={<Button onClick={() => setEditing(null)}><Plus /> New lead</Button>}
    >
      <SyncBanner onSynced={load} />

      <section className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat label="New, not contacted" value={counts.fresh} sub={`${counts.ready} ready to let now or within 30 days`} tone={counts.ready ? "warn" : "default"} />
        <Stat label="In progress" value={counts.working} sub="Contacted, viewing booked or offer sent" />
        <Stat label="Signed" value={counts.signed} sub="Taken on" />
        <Stat label="Where they came from" value={counts.total} sub={`${counts.guaranteed} guaranteed rent ad · ${counts.form} lead form`} />
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {([["all", "All sources"], ["guaranteed", "Guaranteed rent ad"], ["form", "Chisti & Co form"]] as [Source, string][]).map(([v, label]) => (
              <button
                key={v}
                type="button"
                onClick={() => setSource(v)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", source === v ? "bg-card text-foreground shadow-edge" : "text-muted-foreground hover:text-foreground")}
              >
                {label}
              </button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={selectCls} aria-label="Status">
            <option value="open">Still open</option>
            <option value="all">Any status</option>
            {LETTINGS_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>
          <select value={when} onChange={(e) => setWhen(e.target.value)} className={selectCls} aria-label="When they want to let">
            <option value="all">Any timing</option>
            {whenOptions.map((w) => <option key={w} value={w}>{w}</option>)}
          </select>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Search name, phone, area…" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search lettings leads" />
          </div>
        </div>

        {leads === null ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : rows.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center">
            <KeyRound className="size-7 text-faint" />
            <p className="font-medium">{leads.length ? "Nothing matches" : "No lettings leads yet"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {leads.length ? "Try another filter." : "Landlords who want to let to you appear here from the Lettings Leads tab in your sheet, or add one yourself."}
            </p>
          </Card>
        ) : (
          <Card className="overflow-hidden p-0">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-[0.8125rem] text-muted-foreground">
                  <tr>
                    <th className="h-10 px-3 font-medium">Landlord</th>
                    <th className="h-10 px-3 font-medium">Contact</th>
                    <th className="h-10 px-3 font-medium">Property</th>
                    <th className="h-10 px-3 font-medium">Wants to let</th>
                    <th className="h-10 px-3 font-medium">Enquired</th>
                    <th className="h-10 px-3 font-medium">Status</th>
                    <th className="h-10 px-3 font-medium">Next action</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((l) => (
                    <tr key={l.id} className="cursor-pointer transition-colors duration-150 hover:bg-muted" onClick={() => setEditing(l)}>
                      <td className="max-w-[12rem] px-3 py-2.5">
                        <button type="button" className="block truncate text-left font-medium hover:underline" onClick={(e) => { e.stopPropagation(); setEditing(l); }}>{l.name}</button>
                        <span className="block truncate text-xs text-muted-foreground">{isGuaranteed(l) && isForm(l) ? "Ad + form" : isGuaranteed(l) ? "Guaranteed rent ad" : isForm(l) ? "Chisti & Co form" : l.source ?? ""}</span>
                      </td>
                      <td className="px-3 py-2.5 text-xs">
                        {l.phone && (
                          <a href={`tel:${l.phone.replace(/\s/g, "")}`} onClick={(e) => e.stopPropagation()} className="flex items-center gap-1 whitespace-nowrap hover:underline">
                            <Phone className="size-3" aria-hidden />{l.phone}
                          </a>
                        )}
                        {l.email && (
                          <a href={`mailto:${l.email}`} onClick={(e) => e.stopPropagation()} className="flex max-w-[14rem] items-center gap-1 truncate text-muted-foreground hover:underline">
                            <Mail className="size-3 shrink-0" aria-hidden /><span className="truncate">{l.email}</span>
                          </a>
                        )}
                      </td>
                      <td className="max-w-[14rem] px-3 py-2.5">
                        <div className="truncate">{[l.location, l.postcode].filter(Boolean).join(" ") || <span className="text-faint">Area not given</span>}</div>
                        <div className="truncate text-xs text-muted-foreground">
                          {[l.property_type, l.bedrooms ? `${l.bedrooms}${/\d/.test(l.bedrooms) ? " bed" : ""}` : null, l.properties_owned ? `owns ${l.properties_owned}` : null].filter(Boolean).join(" · ")}
                        </div>
                      </td>
                      <td className={cn("whitespace-nowrap px-3 py-2.5", (URGENCY[(l.when_to_let ?? "").toLowerCase()] ?? 9) === 0 && "font-medium text-success")}>{l.when_to_let || <span className="text-faint">—</span>}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 tabular-nums text-muted-foreground">{l.enquired_on ? formatDate(l.enquired_on, { day: "numeric", month: "short" }) : "—"}</td>
                      <td className="px-3 py-2.5"><Badge variant={STATUS[l.status]?.tone ?? "neutral"}>{STATUS[l.status]?.label ?? l.status}</Badge></td>
                      <td className="max-w-[12rem] truncate px-3 py-2.5 text-muted-foreground">{l.next_action || "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Card>
        )}
        {leads && rows.length > 0 && <p className="mt-2 text-xs text-muted-foreground">Showing {rows.length} of {leads.length}. Changes you make here stay until someone edits the same cell in the sheet.</p>}
      </section>

      <LettingsLeadDialog lead={editing} onClose={(changed) => { setEditing(undefined); if (changed) load(); }} />
    </PageShell>
  );
}

const FIELDS = ["name", "phone", "email", "location", "postcode", "bedrooms", "property_type", "properties_owned", "when_to_let", "source", "enquired_on", "next_action", "notes"] as const;

function LettingsLeadDialog({ lead, onClose }: { lead: LettingsLead | null | undefined; onClose: (changed: boolean) => void }) {
  const open = lead !== undefined;
  const [f, setF] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!open) return;
    const next: Record<string, string> = { status: lead?.status ?? "new" };
    for (const k of FIELDS) next[k] = lead?.[k] ?? "";
    setF(next);
    setMsg(null);
    setCopied(false);
  }, [open, lead]);

  const bind = (k: string) => ({
    id: `ll-${k}`,
    value: f[k] ?? "",
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((p) => ({ ...p, [k]: e.target.value })),
  });

  async function save() {
    if (!f.name?.trim()) return setMsg("Add the landlord's name.");
    setBusy(true);
    setMsg(null);
    try {
      const body: Record<string, unknown> = { status: f.status };
      for (const k of FIELDS) body[k] = f[k]?.trim() || null;
      body.name = f.name.trim();
      if (lead) await api("PUT", `/api/lettings-leads/${lead.id}`, body);
      else await api("POST", "/api/lettings-leads", body);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api("DELETE", `/api/lettings-leads/${lead!.id}`);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  function copyContact() {
    const text = [f.name, f.phone, f.email].filter(Boolean).join("\n");
    navigator.clipboard?.writeText(text).then(() => setCopied(true), () => {});
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{lead ? lead.name : "New lettings lead"}</DialogTitle></DialogHeader>
          <div className="grid gap-3">
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="Landlord name" k="name"><Input {...bind("name")} /></F>
              <F label="Phone" k="phone"><Input {...bind("phone")} /></F>
              <F label="Email" k="email"><Input type="email" {...bind("email")} /></F>
            </div>
            {lead && (f.phone || f.email) && (
              <div className="flex flex-wrap items-center gap-2 text-sm">
                {f.phone && <a className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 hover:bg-muted/70" href={`tel:${f.phone.replace(/\s/g, "")}`}><Phone className="size-3.5" /> Call</a>}
                {f.email && <a className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 hover:bg-muted/70" href={`mailto:${f.email}`}><Mail className="size-3.5" /> Email</a>}
                <button type="button" onClick={copyContact} className="inline-flex items-center gap-1 rounded-lg bg-muted px-2.5 py-1.5 hover:bg-muted/70"><Copy className="size-3.5" /> {copied ? "Copied" : "Copy details"}</button>
              </div>
            )}
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="Area" k="location"><Input {...bind("location")} /></F>
              <F label="Postcode" k="postcode"><Input {...bind("postcode")} /></F>
              <F label="When they want to let" k="when_to_let"><Input {...bind("when_to_let")} placeholder="Immediately" /></F>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <F label="Property type" k="property_type"><Input {...bind("property_type")} placeholder="House" /></F>
              <F label="Bedrooms" k="bedrooms"><Input {...bind("bedrooms")} placeholder="3–4" /></F>
              <F label="Properties they own" k="properties_owned"><Input {...bind("properties_owned")} placeholder="1" /></F>
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label className="mb-1 block" htmlFor="ll-status">Status</Label>
                <select id="ll-status" className={cn(selectCls, "w-full")} value={f.status ?? "new"} onChange={(e) => setF((p) => ({ ...p, status: e.target.value }))}>
                  {LETTINGS_STATUS.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                </select>
              </div>
              <F label="Enquired on" k="enquired_on"><Input type="date" {...bind("enquired_on")} /></F>
              <F label="Source" k="source"><Input {...bind("source")} placeholder="Guaranteed rent ad" /></F>
            </div>
            <F label="Next action" k="next_action"><Input {...bind("next_action")} placeholder="e.g. Call back Thursday, book viewing" /></F>
            <F label="Notes" k="notes"><Textarea rows={3} {...bind("notes")} /></F>
            {msg && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{msg}</p>}
          </div>
          <DialogFooter className="mt-2">
            {lead && <Button variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>Delete</Button>}
            <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : lead ? "Save changes" : "Add lead"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {lead && (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete ${lead.name}?`}
          description="They're removed from the app and won't come back from the sheet. To keep a record, set the status to Not interested instead."
          onConfirm={remove}
        />
      )}
    </>
  );
}

function F({ label, k, children }: { label: string; k: string; children: React.ReactNode }) {
  return (
    <div>
      <Label className="mb-1 block" htmlFor={`ll-${k}`}>{label}</Label>
      {children}
    </div>
  );
}

function Stat({ label, value, sub, tone = "default" }: { label: string; value: number; sub: string; tone?: "default" | "warn" }) {
  return (
    <Card className="flex flex-col items-start gap-1 p-5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className={cn("display data mt-1 text-[2rem] font-medium leading-none", tone === "warn" && "text-warning")}>{value}</span>
      <span className="mt-1 min-h-4 text-xs text-muted-foreground">{sub}</span>
    </Card>
  );
}
