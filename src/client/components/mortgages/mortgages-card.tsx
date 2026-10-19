import { useCallback, useEffect, useMemo, useState } from "react";
import { Landmark, Plus } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import type { Mortgage, Property } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { MortgageDialog } from "./mortgage-dialog";
import { MortgageTable } from "./mortgages-page";
import { ltvByProperty } from "./mortgage-math";

/** The loans on one home, on its property page. */
export function MortgagesCard({ property, onChanged }: { property: Property; onChanged?: () => void }) {
  const { refreshLookups } = useApp();
  const [rows, setRows] = useState<Mortgage[] | null>(null);
  const [editing, setEditing] = useState<Mortgage | null | undefined>(undefined);

  const load = useCallback(() => {
    api<{ mortgages: Mortgage[] }>("GET", `/api/mortgages?property_id=${property.id}`).then((r) => setRows(r.mortgages)).catch(() => setRows([]));
  }, [property.id]);
  useEffect(load, [load]);
  const ltv = useMemo(() => ltvByProperty(rows ?? []), [rows]);

  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold leading-tight"><Landmark className="size-4 text-primary" /> Mortgages</h2>
        <Button size="sm" onClick={() => setEditing(null)}><Plus /> Add</Button>
      </div>
      {rows === null ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">Loading…</Card>
      ) : rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          No mortgage entered for this home. Add the lender, rate and when the deal ends to get a reminder before it's time to remortgage.
        </Card>
      ) : (
        <MortgageTable rows={rows} ltv={ltv} onOpen={setEditing} hideProperty />
      )}
      <MortgageDialog
        mortgage={editing}
        propertyId={property.id}
        onClose={(changed) => {
          setEditing(undefined);
          if (changed) {
            load();
            refreshLookups().catch(() => {});
            onChanged?.();
          }
        }}
      />
    </section>
  );
}
