import { useMemo, useState } from "react";
import { useApp } from "@/context";
import { cn, daysBetween, formatDate, toIsoDate } from "@/lib/utils";
import { CERTIFICATES, CERT_LABEL, CERT_TONE, certState, complianceState, type CertState } from "@/lib/portfolio";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { PropertyDialog } from "@/components/properties/property-dialog";
import { PageShell } from "@/components/page-shell";
import type { Property } from "@/types";

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
                {CERTIFICATES.map((c) => <th key={c.key} className="h-10 px-3 font-medium">{c.label}</th>)}
                <th className="h-10 px-3 font-medium">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {rows.map((p) => {
                const st = complianceState(p);
                return (
                  <tr key={p.id} className="cursor-pointer transition-colors duration-150 hover:bg-muted" onClick={() => setEditing(p)}>
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
                    {CERTIFICATES.map((c) => {
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
                        </td>
                      );
                    })}
                    <td className="px-3 py-2.5"><Badge variant={CERT_TONE[st]}>{CERT_LABEL[st]}</Badge></td>
                  </tr>
                );
              })}
              {rows.length === 0 && (
                <tr><td colSpan={7} className="px-3 py-10 text-center text-muted-foreground">Nothing here.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>
      <p className="text-xs text-muted-foreground">Click a row to enter or update its expiry dates. Licence only applies where the council requires one.</p>

      <PropertyDialog open={!!editing} onOpenChange={(o) => { if (!o) setEditing(undefined); }} property={editing} />
    </PageShell>
  );
}
