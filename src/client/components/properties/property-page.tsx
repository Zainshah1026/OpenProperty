import { useEffect, useState } from "react";
import { ArrowLeft, Building2, MapPin, Pencil, Plus, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { api } from "@/api";
import { cn, colorClasses, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { PropertyDialog } from "./property-dialog";
import { UnitDialog } from "./unit-dialog";
import { WorkOrderDialog } from "../maintenance/work-order-dialog";
import type { Property, Room, Unit, WorkOrder } from "@/types";
import { PageShell } from "@/components/page-shell";
import { DocumentsPanel } from "@/components/compliance/documents";
import { EnergyPicker } from "@/components/compliance/energy-picker";
import { TenantPicker } from "@/components/tenants/tenant-picker";
import { AccessCard, MediaCard, RepairQrCard, VoidsCard } from "./property-extras";
import { FinanceCard } from "./finance-card";
import { LettersCard } from "@/components/letters/letters-card";
import {
  CERTIFICATES, CERT_LABEL, CERT_TONE, ENERGY_LABEL, certNeeded, certState, dealLabel, netProfit,
  hasLeaseholdFigures, isFreehold, leaseholdNet, occupancyLabel, occupancyTone, ordinal, propertyTypeLabel, rentStatusLabel, rentStatusTone, tenureLabel,
} from "@/lib/portfolio";


const STATUS_TONE: Record<string, string> = {
  vacant: "bg-warning-tint text-warning",
  occupied: "bg-success-tint text-success",
  turnover: "bg-info-tint text-info",
  unavailable: "bg-muted text-muted-foreground",
};

export function PropertyPage({ id, navigate }: { id: number; navigate: (to: string) => void }) {
  const app = useApp();
  const [property, setProperty] = useState<Property | null>(null);
  const [units, setUnits] = useState<Unit[]>([]);
  const [workOrders, setWorkOrders] = useState<WorkOrder[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingProperty, setEditingProperty] = useState(false);
  const [editingUnit, setEditingUnit] = useState<Unit | undefined>(undefined);
  const [unitDialogOpen, setUnitDialogOpen] = useState(false);
  const [woDialogOpen, setWoDialogOpen] = useState(false);

  async function load() {
    try {
      setLoading(true);
      const [{ property: p }, ulist, wlist, rlist] = await Promise.all([
        api<{ property: Property }>("GET", `/api/properties/${id}`),
        app.listUnits(id),
        app.listWorkOrders({ property_id: id }),
        api<{ rooms: Room[] }>("GET", `/api/properties/${id}/rooms`).catch(() => ({ rooms: [] as Room[] })),
      ]);
      setProperty(p);
      setRooms(rlist.rooms);
      setUnits(ulist);
      setWorkOrders(wlist);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  if (loading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground">
        Loading property…
      </div>
    );
  }
  if (!property) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <p className="text-sm text-muted-foreground">Property not found.</p>
        <Button variant="outline" onClick={() => navigate("/properties")}>Back to properties</Button>
      </div>
    );
  }

  const palette = colorClasses(property.color);
  const openWorkOrders = workOrders.filter((w) => w.status !== "completed" && w.status !== "cancelled");

  return (
    <PageShell
      title={
        <button
          type="button"
          onClick={() => navigate("/properties")}
          className="inline-flex items-center gap-1.5 text-[1.375rem] font-semibold leading-tight tracking-[-0.01em] transition-colors duration-150 hover:text-muted-foreground"
        >
          <ArrowLeft className="size-4 text-muted-foreground" aria-hidden />
          Properties
        </button>
      }
      width="max-w-7xl"
    >
        <header className="flex items-start justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className={cn("flex size-12 items-center justify-center rounded-md", palette.bg, palette.text)}>
              <Building2 className="size-6" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-[1.375rem] font-semibold leading-tight tracking-[-0.01em]">{property.name}</h1>
                <span className="rounded-full border bg-muted/30 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                  {propertyTypeLabel(property.type)}
                </span>
              </div>
              {(property.address || property.city) && (
                <p className="mt-1 flex items-center gap-1 text-sm text-muted-foreground">
                  <MapPin className="h-3 w-3" />
                  {[property.address, property.zip].filter(Boolean).join(", ")}
                </p>
              )}
            </div>
          </div>
          <Button variant="outline" onClick={() => setEditingProperty(true)}>
            <Pencil className="mr-1 h-4 w-4" /> Edit property
          </Button>
        </header>

        <div className="flex flex-wrap items-center gap-2">
          {property.ref && <span className="chip">Ref {property.ref}</span>}
          <span className="chip">{dealLabel(property.deal_type)}</span>
          {property.tenure && <span className="chip">{tenureLabel(property.tenure)}</span>}
          {property.owner && <span className="chip">{property.owner}</span>}
          {property.bedrooms ? <span className="chip">{property.bedrooms} bed</span> : null}
          {property.hmo ? <span className="chip">HMO</span> : null}
          <Badge variant={occupancyTone(property.occupancy)}>{occupancyLabel(property.occupancy)}</Badge>
          {property.rent_status && (
            <Badge variant={rentStatusTone(property.rent_status)}>{rentStatusLabel(property.rent_status)}</Badge>
          )}
        </div>

        <section className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <SummaryCard label="Rent in" value={formatMoney(property.rent_in, app.settings.currency)} sub={property.rent_in_day ? `arrives on the ${ordinal(property.rent_in_day)}` : undefined} />
          <SummaryCard
            label="Rent / mortgage out"
            value={formatMoney(property.rent_out + property.other_costs, app.settings.currency)}
            sub={property.payment_out_day ? `leaves on the ${ordinal(property.payment_out_day)}` : property.rent_out || property.other_costs ? undefined : "no costs entered"}
          />
          <SummaryCard
            label="Net profit"
            value={formatMoney(netProfit(property), app.settings.currency)}
            sub={property.rent_in ? `${Math.round((netProfit(property) / property.rent_in) * 100)}% margin` : undefined}
            tone={netProfit(property) < 0 ? "warn" : "default"}
          />
          <SummaryCard
            label="Arrears"
            value={property.arrears_amount ? formatMoney(property.arrears_amount, app.settings.currency) : "None"}
            sub={property.months_arrears ? `${property.months_arrears} months behind` : undefined}
            tone={property.arrears_amount > 0 ? "warn" : "default"}
          />
        </section>

        <LeaseholdCard property={property} currency={app.settings.currency} />

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <Card className="p-5 lg:col-span-2">
            <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Compliance</h2>
              <EnergyPicker property={property} />
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {CERTIFICATES.map((c) => {
                if (!certNeeded(property, c.key)) {
                  return (
                    <div key={c.key} className="rounded-md border p-3">
                      <div className="stat-label">{c.label}</div>
                      <div className="mt-1 text-sm font-medium">Not needed</div>
                      <p className="mt-2 text-xs text-muted-foreground">All electric</p>
                    </div>
                  );
                }
                const date = property[c.key];
                const st = certState(date);
                return (
                  <div key={c.key} className="rounded-md border p-3">
                    <div className="stat-label">{c.label}</div>
                    <div className="mt-1 text-sm font-medium tabular-nums">{date ? formatDate(date) : "Not recorded"}</div>
                    <Badge variant={CERT_TONE[st]} className="mt-2">{CERT_LABEL[st]}</Badge>
                  </div>
                );
              })}
            </div>
            <h2 className="mb-3 mt-5 text-sm font-semibold">Certificates &amp; documents</h2>
            <DocumentsPanel property={property} />
          </Card>
          <Card className="p-5">
            <h2 className="mb-3 text-sm font-semibold">Letting</h2>
            <dl className="space-y-2 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <dt className="text-muted-foreground">Tenant</dt>
                <dd className="text-right">
                  <TenantPicker
                    value={property.tenant_id}
                    placeholder={property.tenant_label ? `${property.tenant_label} (from sheet)` : "Choose tenant…"}
                    onChange={async (tid) => {
                      await api("PUT", `/api/properties/${property.id}`, { tenant_id: tid });
                      const { property: p } = await api<{ property: Property }>("GET", `/api/properties/${property.id}`);
                      setProperty(p);
                    }}
                  />
                </dd>
              </div>
              {property.tenant_id && property.tenant_label && property.tenant_label !== property.tenant_name && (
                <div className="flex justify-between gap-3 text-xs"><dt className="text-muted-foreground">Sheet says</dt><dd className="text-right text-muted-foreground">{property.tenant_label}</dd></div>
              )}
              {property.tenant_id && (
                <div className="text-right text-xs"><button type="button" className="text-primary hover:underline" onClick={() => navigate(`/tenants/${property.tenant_id}`)}>Open tenant</button></div>
              )}
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Energy</dt><dd className="text-right font-medium">{property.energy ? ENERGY_LABEL[property.energy] : "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Owner</dt><dd className="text-right font-medium">{property.owner || "—"}</dd></div>
              <div className="flex justify-between gap-3"><dt className="text-muted-foreground">Open work orders</dt><dd className="text-right font-medium">{openWorkOrders.length}</dd></div>
            </dl>
            {property.notes && <p className="mt-4 whitespace-pre-line border-t pt-3 text-sm text-muted-foreground">{property.notes}</p>}
          </Card>
        </section>

        {(rooms.length > 0 || property.hmo === 1 || property.occupancy === "part_occupied") && (
          <RoomsSection
            rooms={rooms}
            property={property}
            currency={app.settings.currency}
            onLink={async (room, tid) => {
              await api("PUT", `/api/properties/${property.id}/room-tenant`, { room, tenant_id: tid });
              const r = await api<{ rooms: Room[] }>("GET", `/api/properties/${property.id}/rooms`);
              setRooms(r.rooms);
            }}
          />
        )}

        {property.section !== "managed" && <FinanceCard property={property} onSaved={setProperty} />}

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <AccessCard property={property} />
          <RepairQrCard property={property} />
        </section>

        <LettersCard propertyId={property.id} navigate={navigate} />

        <VoidsCard property={property} />
        <MediaCard property={property} />

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Units</h2>
            <Button size="sm" onClick={() => { setEditingUnit(undefined); setUnitDialogOpen(true); }}>
              <Plus className="mr-1 h-4 w-4" /> New unit
            </Button>
          </div>
          {units.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">
              No units yet. Add one to start tracking leases and rent.
            </Card>
          ) : (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {units.map((u) => (
                <Card key={u.id} className="cursor-pointer p-4 transition-colors duration-150 hover:bg-muted" onClick={() => { setEditingUnit(u); setUnitDialogOpen(true); }}>
                  <div className="flex items-start justify-between">
                    <div>
                      <h3 className="font-semibold">{u.name}</h3>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        {u.bedrooms} bed · {u.bathrooms} bath{u.sqft ? ` · ${u.sqft} sq ft` : ""}
                      </p>
                    </div>
                    <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_TONE[u.status])}>
                      {u.status}
                    </span>
                  </div>
                  <div className="mt-3 flex items-end justify-between border-t pt-3">
                    <div>
                      <div className="stat-label">Market rent</div>
                      <div className="text-sm font-semibold tabular-nums">{formatMoney(u.market_rent, app.settings.currency)}</div>
                    </div>
                    {u.active_tenant_name && (
                      <div className="text-right text-xs text-muted-foreground">{u.active_tenant_name}</div>
                    )}
                  </div>
                </Card>
              ))}
            </div>
          )}
        </section>

        <section>
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[1.0625rem] font-semibold leading-tight">Work orders</h2>
            <Button size="sm" variant="outline" onClick={() => setWoDialogOpen(true)}>
              <Plus className="mr-1 h-4 w-4" /> New work order
            </Button>
          </div>
          {workOrders.length === 0 ? (
            <Card className="p-8 text-center text-sm text-muted-foreground">No work orders for this property.</Card>
          ) : (
            <Card className="divide-y">
              {workOrders.map((w) => (
                <div key={w.id} className="flex items-center justify-between gap-4 p-4">
                  <div className="flex min-w-0 items-start gap-3">
                    <Wrench className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{w.title}</p>
                      <p className="truncate text-xs text-muted-foreground">
                        {[w.unit_name, w.vendor_name, formatDate(w.created_at)].filter(Boolean).join(" · ")}
                      </p>
                    </div>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge variant="neutral" className="capitalize">{w.priority}</Badge>
                    <Badge variant="secondary" className="capitalize">{w.status.replace("_", " ")}</Badge>
                  </div>
                </div>
              ))}
            </Card>
          )}
        </section>

      <PropertyDialog
        open={editingProperty}
        onOpenChange={(o) => { setEditingProperty(o); if (!o) load(); }}
        property={property}
      />
      <UnitDialog
        open={unitDialogOpen}
        onOpenChange={(o) => { setUnitDialogOpen(o); if (!o) load(); }}
        propertyId={property.id}
        unit={editingUnit}
      />
      <WorkOrderDialog
        open={woDialogOpen}
        onOpenChange={(o) => { setWoDialogOpen(o); if (!o) load(); }}
        defaults={{ property_id: property.id }}
      />
    </PageShell>
  );
}

function SummaryCard({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "warn" }) {
  return (
    <Card className="p-4">
      <div className="stat-label">{label}</div>
      <div className={cn("mt-1 text-xl font-semibold tabular-nums", tone === "warn" && "text-warning")}>{value}</div>
      <div className="mt-0.5 h-4 truncate text-xs text-muted-foreground">{sub}</div>
    </Card>
  );
}

const ROOM_STATUS: Record<string, { label: string; tone: "success" | "destructive" | "neutral" }> = {
  on_time: { label: "On time", tone: "success" },
  in_arrears: { label: "Paid in arrears", tone: "neutral" },
  missed: { label: "Missed rent", tone: "destructive" },
  empty: { label: "Room empty", tone: "neutral" },
};

/** One row per room or tenant, from the Tenants tab of the sheet. */
function RoomsSection({ rooms, property, currency, onLink }: { rooms: Room[]; property: Property; currency: string; onLink: (room: string, tenantId: number | null) => Promise<void> }) {
  const let_ = rooms.filter((r) => r.tenant_name && r.rent_status !== "empty");
  const total = rooms.reduce((a, r) => a + (r.rent || 0), 0);
  const diff = total - (property.rent_in || 0);
  return (
    <section>
      <div className="mb-3 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-[1.0625rem] font-semibold leading-tight">Rooms &amp; tenants</h2>
          <p className="text-xs text-muted-foreground">
            {rooms.length
              ? `${let_.length} of ${rooms.length} rooms let · ${formatMoney(total, currency)} a month from tenants`
              : "No rooms listed yet."}
            {rooms.length > 0 && total > 0 && Math.abs(diff) >= 1 && property.rent_in > 0 && (
              <span className="text-warning"> · {formatMoney(Math.abs(diff), currency)} {diff < 0 ? "less" : "more"} than the property's rent in</span>
            )}
          </p>
        </div>
        <span className="text-xs text-muted-foreground">Pick each room's tenant from your Tenants list; rents and pay days come from the sheet's Tenants tab</span>
      </div>
      {rooms.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">
          Add a row per room on the sheet's Tenants tab with Ref {property.ref ?? "—"}, and each tenant will show here.
        </Card>
      ) : (
        <Card className="overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b bg-muted/40 text-left text-[0.8125rem] text-muted-foreground">
                <tr>
                  <th className="h-10 px-3 font-medium">Room</th>
                  <th className="h-10 px-3 font-medium">Tenant</th>
                  <th className="h-10 px-3 text-right font-medium">Rent / month</th>
                  <th className="h-10 px-3 font-medium">Pays on</th>
                  <th className="h-10 px-3 font-medium">Status</th>
                  <th className="h-10 px-3 font-medium">Tenancy</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {rooms.map((r) => {
                  const st = r.rent_status ? ROOM_STATUS[r.rent_status] : null;
                  return (
                    <tr key={r.id}>
                      <td className="px-3 py-2.5 font-medium">{r.room || "—"}</td>
                      <td className="px-3 py-2.5">
                        {r.room ? (
                          <TenantPicker
                            className="h-8 w-52"
                            value={r.linked_tenant_id}
                            placeholder={r.tenant_name ? `${r.tenant_name} (from sheet)` : "Empty · choose tenant…"}
                            onChange={(tid) => onLink(r.room!, tid)}
                          />
                        ) : (r.tenant_name || <span className="text-muted-foreground">Empty</span>)}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums">{r.rent ? formatMoney(r.rent, currency) : <span className="text-warning">Not set</span>}</td>
                      <td className="px-3 py-2.5">{r.pay_day ? `the ${ordinal(r.pay_day)}` : "—"}</td>
                      <td className="px-3 py-2.5">{st ? <Badge variant={st.tone}>{st.label}</Badge> : <span className="text-muted-foreground">—</span>}</td>
                      <td className="px-3 py-2.5 text-xs text-muted-foreground">
                        {r.start_date || r.end_date ? `${r.start_date ? formatDate(r.start_date) : "?"} – ${r.end_date ? formatDate(r.end_date) : "rolling"}` : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot className="border-t bg-muted/40 font-medium">
                <tr>
                  <td className="px-3 py-2.5" colSpan={2}>Total</td>
                  <td className="px-3 py-2.5 text-right tabular-nums">{formatMoney(total, currency)}</td>
                  <td colSpan={3} />
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>
      )}
    </section>
  );
}

/** Ground rent and service charge: what we pay a freeholder, and what we collect as freeholder. */
function LeaseholdCard({ property: p, currency }: { property: Property; currency: string }) {
  const show = hasLeaseholdFigures(p) || isFreehold(p.tenure) || p.type === "flat" || p.type === "maisonette";
  if (!show) return null;
  const m = (n: number) => formatMoney(n, currency);
  const line = (label: string, yearly: number) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right tabular-nums">
        {yearly ? <><span className="font-medium">{m(yearly)}</span><span className="text-xs text-muted-foreground"> /yr · {m(yearly / 12)} /mo</span></> : <span className="text-muted-foreground">—</span>}
      </dd>
    </div>
  );
  const net = leaseholdNet(p);
  return (
    <Card className="p-5">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-sm font-semibold">Ground rent &amp; service charge</h2>
        {hasLeaseholdFigures(p) ? (
          <span className={cn("text-sm font-semibold tabular-nums", net < 0 ? "text-destructive" : "text-success")}>
            {net < 0 ? "−" : "+"}{m(Math.abs(net))} /mo net
          </span>
        ) : (
          <span className="text-xs text-muted-foreground">Add yearly amounts on the sheet</span>
        )}
      </div>
      <div className="grid grid-cols-1 gap-x-8 sm:grid-cols-2">
        <dl>
          <div className="section-label pb-1">We pay</div>
          {line("Ground rent", p.ground_rent_paid)}
          {line("Service charge", p.service_charge_paid)}
        </dl>
        <dl>
          <div className="section-label pb-1 pt-3 sm:pt-0">We receive{isFreehold(p.tenure) ? " (as freeholder)" : ""}</div>
          {line("Ground rent", p.ground_rent_received)}
          {line("Service charge", p.service_charge_received)}
        </dl>
      </div>
    </Card>
  );
}
