import { useCallback, useEffect, useMemo, useState } from "react";
import { Flame, Paperclip, Zap } from "lucide-react";
import { useApp } from "@/context";
import { cn, daysBetween, formatDate, toIsoDate } from "@/lib/utils";
import { CERTIFICATES, CERT_LABEL, CERT_TONE, ENERGY_LABEL, certNeeded, certState, complianceState, type CertState } from "@/lib/portfolio";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PropertyDialog } from "@/components/properties/property-dialog";
import { PageShell } from "@/components/page-shell";
import { SyncBanner } from "@/components/sync-banner";
import type { Property } from "@/types";
import { DocumentsDialog } from "./documents";

const CERT_DOC_KIND: Record<string, string> = { gas_expiry: "gas", epc_expiry: "epc", eicr_expiry: "eicr", licence_expiry: "licence", insurance_expiry: "insurance" };

type View = "attention" | "all" | CertState;

const CELL_TONE: Record<CertState, string> = {
  expired: "bg-destructive-tint text-destructive",
  due_soon: "bg-warning-tint text-warning",
  ok: "text-foreground",
  missing: "text-faint",
};

export function CompliancePage({ navigate }: { navigate: (to: string) => void }) {
  const { properties } = useApp();
  const [view, setView] = useState<View>("attention");
  const [editing, setEditing] = useState<Property | undefined>(undefined);
  const [docsFor, setDocsFor] = useState<Property | null>(null);
  const [docCounts, setDocCounts] = useState<Record<number, Record<string, number>>>({});

  const loadCounts = useCallback(() => {
    fetch("/api/documents/summary")
      .then((r) => r.json())
      .then((d: { counts: Record<number, Record<string, number>> }) => setDocCounts(d.counts ?? {}))
      .catch(() => {});
  }, []);
  useEffect(() => { loadCounts(); }, [loadCounts]);

  const counts = useMemo(() => {
    const c: Record<CertState, number> = { expired: 0, due_soon: 0, ok: 0, missing: 0 };
    for (const p of properties) c[complianceState(p)]++;
    return c;
  }, [properties]);

  const rows = useMemo(() => {
    const order: Record<CertState, number> = { expired: 0, due_soon: 1, missing: 2, ok: 3 };
    return properties
      .filter((p) => {
        const st = complianceState(p);
        if (view === "all") return true;
        if (view === "attention") return st !== "ok";
        return st === view;
      })
      .sort((a, b) => order[complianceState(a)] - order[complianceState(b)] || (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));
  }, [properties, view]);

  const today = toIsoDate(new Date());

  return (
    <PageShell
      title="Compliance"
      meta={`${counts.expired} expired · ${counts.due_soon} due within 60 days · ${counts.missing} with no dates recorded`}
    >
      <SyncBanner />
      <Tabs value={view} onValueChange={(v) => setView(v as View)}>
        <TabsList>
          <TabsTrigger value="attention">Needs action ({counts.expired + counts.due_soon + counts.missing})</TabsTrigger>
          <TabsTrigger value="expired">Expired ({counts.expired})</TabsTrigger>
          <TabsTrigger value="due_soon">Due soon ({counts.due_soon})</TabsTrigger>
          <TabsTrigger value="missing">No dates ({counts.missing})</TabsTrigger>
          <TabsTrigger value="all">All ({properties.length})</TabsTrigger>
        </TabsList>
      </Tabs>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="border-b bg-muted/40 text-left text-[0.8125rem] text-muted-foreground">
              <tr>
                <th className="h-10 px-3 font-medium">Property</th>
                <th className="h-10 px-3 font-medium">Energy</th>
                {CERTIFICATES.map((c) => <th key={c.key} className="h-10 px-3 font-medium">{c.label}</th>)}
                <th className="h-10 px-3 font-medium">Documents</th>
                <th className="h-10 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const st = complianceState(p);
                return (
                  <tr key={p.id} className="cursor-pointer transition-colors duration-150 hover:bg-muted" onClick={() => setDocsFor(p)}>
                    <td className="max-w-[16rem] px-3 py-2.5">
                      <button
                        type="button"
                        className="block max-w-full truncate text-left font-medium hover:underline"
                        onClick={(e) => { e.stopPropagation(); navigate(`/properties/${p.id}`); }}
                      >
                        {p.ref ? `${p.ref} · ` : ""}{p.name}
                      </button>
                      <div className="truncate text-xs text-muted-foreground">{p.owner || "—"}{p.hmo ? " · HMO" : ""}</div>
                    </td>
                    <td className="px-3 py-2.5">
                      {p.energy ? (
                        <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", p.energy === "all_electric" ? "bg-info-tint text-info" : "bg-warning-tint text-warning")}>
                          {p.energy === "all_electric" ? <Zap className="size-3.5" /> : <Flame className="size-3.5" />} {ENERGY_LABEL[p.energy]}
                        </span>
                      ) : (
                        <span className="text-xs text-faint" title="Fill in the Energy column in the sheet">Not set</span>
                      )}
                    </td>
                    {CERTIFICATES.map((c) => {
                      if (!certNeeded(p, c.key)) {
                        return (
                          <td key={c.key} className="px-2 py-2">
                            <span className="inline-block rounded px-1.5 py-0.5 text-xs text-muted-foreground" title="All electric: no gas safety certificate needed">Not needed</span>
                          </td>
                        );
                      }
                      const date = p[c.key];
                      const cs = certState(date);
                      const days = date ? daysBetween(today, date) : null;
                      return (
                        <td key={c.key} className="px-2 py-2">
                          <span
                            className={cn("inline-block rounded px-1.5 py-0.5 tabular-nums", CELL_TONE[cs])}
                            title={days === null ? "Not recorded" : days < 0 ? `Expired ${-days} days ago` : `${days} days left`}
                          >
                            {date ? formatDate(date) : "—"}
                          </span>
                          {docCounts[p.id]?.[CERT_DOC_KIND[c.key]] ? (
                            <Paperclip className="ml-1 inline size-3.5 text-primary" aria-label="Certificate uploaded" />
                          ) : null}
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5">
                      {(() => {
                        const n = Object.values(docCounts[p.id] ?? {}).reduce((a, b) => a + b, 0);
                        return (
                          <span className={cn("inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-medium", n ? "text-primary" : "text-muted-foreground")}>
                            <Paperclip className="size-3.5" /> {n ? n : "Add"}
                          </span>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2.5"><Badge variant={CERT_TONE[st]}>{CERT_LABEL[st]}</Badge></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">Nothing here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">Click a row to upload or open its certificates (gas safety, EICR, EPC, licence, insurance). A paperclip means a certificate is uploaded. Set Energy (All electric / Gas & electric) in the sheet; all-electric homes don't need a gas safety certificate. Licence only applies where the council requires one.</p>

      <DocumentsDialog
        property={docsFor}
        onClose={(changed) => { setDocsFor(null); if (changed) loadCounts(); }}
        onEditDates={(p) => { setDocsFor(null); setEditing(p); }}
      />
      <PropertyDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(undefined); }} property={editing} />
    </PageShell>
  );
}
