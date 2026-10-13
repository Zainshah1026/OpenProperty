import { useMemo, useState } from "react";
import { Building2, Plus, Search } from "lucide-react";
import { useApp } from "@/context";
import { cn, formatMoney } from "@/lib/utils";
import {
  DEAL_TYPES, OCCUPANCY, RENT_STATUS,
  dealLabel, netProfit, occupancyLabel, occupancyTone, rentStatusLabel, rentStatusTone,
} from "@/lib/portfolio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PropertyDialog } from "./property-dialog";
import { PageShell } from "@/components/page-shell";
import { SyncBanner } from "@/components/sync-banner";

const ALL = "__all";

export function PropertiesList({ navigate }: { navigate: (to: string) => void }) {
  const { properties, settings } = useApp();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [q, setQ] = useState("");
  const [owner, setOwner] = useState(ALL);
  const [deal, setDeal] = useState(ALL);
  const [occ, setOcc] = useState(ALL);
  const [rent, setRent] = useState(() => new URLSearchParams(window.location.search).get("status") ?? ALL);

  const money = (n: number) => formatMoney(n, settings.currency);
  const owners = useMemo(
    () => [...new Set(properties.map((p) => p.owner).filter((o): o is string => !!o))].sort(),
    [properties],
  );

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return properties.filter((p) => {
      if (owner !== ALL && p.owner !== owner) return false;
      if (deal !== ALL && p.deal_type !== deal) return false;
      if (occ !== ALL && p.occupancy !== occ) return false;
      if (rent !== ALL && p.rent_status !== rent) return false;
      if (!needle) return true;
      return [p.ref, p.name, p.address, p.city, p.zip, p.owner, p.tenant_label]
        .some((v) => v?.toLowerCase().includes(needle));
    });
  }, [properties, q, owner, deal, occ, rent]);

  const totals = rows.reduce(
    (a, p) => ({ in: a.in + (p.rent_in || 0), net: a.net + netProfit(p), arrears: a.arrears + (p.arrears_amount || 0) }),
    { in: 0, net: 0, arrears: 0 },
  );
  const filtered = rows.length !== properties.length;

  return (
    <PageShell
      title="Properties"
      meta={`${filtered ? `${rows.length} of ` : ""}${properties.length} ${properties.length === 1 ? "home" : "homes"} · ${money(totals.in)} rent in · ${money(totals.net)} net`}
      actions={
        <Button onClick={() => setDialogOpen(true)}>
          <Plus className="h-4 w-4" /> New property
        </Button>
      }
    >
      <SyncBanner />
      {properties.length === 0 ? (
        <div className="flex flex-col items-center justify-center gap-2 px-6 py-20 text-center">
          <Building2 className="size-8 text-faint" aria-hidden />
          <p className="font-medium">No properties yet</p>
          <p className="max-w-sm text-sm leading-relaxed text-muted-foreground">
            Add your first home, or import the portfolio spreadsheet.
          </p>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="relative w-full sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search address, ref, tenant…" className="pl-8" />
            </div>
            <Filter value={owner} onChange={setOwner} placeholder="All owners" options={owners.map((o) => ({ value: o, label: o }))} />
            <Filter value={deal} onChange={setDeal} placeholder="All deal types" options={DEAL_TYPES} />
            <Filter value={occ} onChange={setOcc} placeholder="Any occupancy" options={OCCUPANCY} />
            <Filter value={rent} onChange={setRent} placeholder="Any rent status" options={RENT_STATUS} />
            {filtered && (
              <button
                type="button"
                className="text-xs font-medium text-primary hover:underline"
                onClick={() => { setQ(""); setOwner(ALL); setDeal(ALL); setOcc(ALL); setRent(ALL); }}
              >
                Clear filters
              </button>
            )}
          </div>

          <Card className="overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[960px] text-sm">
                <thead className="border-b bg-muted/40 text-left text-[0.8125rem] text-muted-foreground">
                  <tr>
                    <th className="h-10 px-3 font-medium">Ref</th>
                    <th className="h-10 px-3 font-medium">Property</th>
                    <th className="h-10 px-3 font-medium">Owner</th>
                    <th className="h-10 px-3 font-medium">Deal</th>
                    <th className="h-10 px-3 font-medium">Occupancy</th>
                    <th className="h-10 px-3 text-right font-medium">Rent in</th>
                    <th className="h-10 px-3 text-right font-medium">Out</th>
                    <th className="h-10 px-3 text-right font-medium">Net</th>
                    <th className="h-10 px-3 font-medium">Rent</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {rows.map((p) => {
                    const net = netProfit(p);
                    const costsKnown = p.rent_out > 0 || p.other_costs > 0 || p.deal_type === "ground_rent";
                    return (
                      <tr key={p.id} className="cursor-pointer transition-colors duration-150 hover:bg-muted" onClick={() => navigate(`/properties/${p.id}`)}>
                        <td className="px-3 py-2.5 tabular-nums text-muted-foreground">{p.ref || "—"}</td>
                        <td className="max-w-[18rem] px-3 py-2.5">
                          <div className="truncate font-medium">{p.name}</div>
                          <div className="truncate text-xs text-muted-foreground">
                            {[p.city, p.zip, p.bedrooms ? `${p.bedrooms} bed` : null, p.hmo ? "HMO" : null].filter(Boolean).join(" · ")}
                          </div>
                        </td>
                        <td className="max-w-[10rem] truncate px-3 py-2.5">{p.owner || "—"}</td>
                        <td className="px-3 py-2.5"><span className="chip">{dealLabel(p.deal_type)}</span></td>
                        <td className="px-3 py-2.5"><Badge variant={occupancyTone(p.occupancy)}>{occupancyLabel(p.occupancy)}</Badge></td>
                        <td className="px-3 py-2.5 text-right tabular-nums">{money(p.rent_in)}</td>
                        <td className="px-3 py-2.5 text-right tabular-nums text-muted-foreground">
                          {costsKnown ? money(p.rent_out + p.other_costs) : <span className="text-warning" title="No costs entered">—</span>}
                        </td>
                        <td className={cn("px-3 py-2.5 text-right font-medium tabular-nums", costsKnown && net < 0 && "text-destructive")}>
                          {costsKnown ? money(net) : "—"}
                        </td>
                        <td className="px-3 py-2.5">
                          {p.rent_status ? (
                            <Badge variant={rentStatusTone(p.rent_status)}>
                              {p.rent_status === "in_arrears" && p.arrears_amount ? `Arrears ${money(p.arrears_amount)}` : rentStatusLabel(p.rent_status)}
                            </Badge>
                          ) : <span className="text-muted-foreground">—</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {rows.length === 0 && (
                    <tr><td colSpan={9} className="px-3 py-10 text-center text-muted-foreground">No homes match these filters.</td></tr>
                  )}
                </tbody>
                {rows.length > 0 && (
                  <tfoot className="border-t bg-muted/40 text-sm font-medium">
                    <tr>
                      <td className="px-3 py-2.5" colSpan={5}>Total ({rows.length})</td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.in)}</td>
                      <td />
                      <td className="px-3 py-2.5 text-right tabular-nums">{money(totals.net)}</td>
                      <td className={cn("px-3 py-2.5 tabular-nums", totals.arrears > 0 && "text-destructive")}>
                        {totals.arrears ? `${money(totals.arrears)} arrears` : ""}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </Card>
        </>
      )}

      <PropertyDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </PageShell>
  );
}

function Filter({
  value, onChange, placeholder, options,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  options: { value: string; label: string }[];
}) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger className="h-9 w-auto min-w-[9rem]"><SelectValue placeholder={placeholder} /></SelectTrigger>
      <SelectContent>
        <SelectItem value={ALL}>{placeholder}</SelectItem>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
