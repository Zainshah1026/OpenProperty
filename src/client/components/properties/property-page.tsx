import { useEffect, useState } from "react";
import { ArrowLeft, Building2, ChevronRight, MapPin, Pencil, Plus, Wrench } from "lucide-react";
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
import { MortgagesCard } from "@/components/mortgages/mortgages-card";
import {
  CERTIFICATES, CERT_LABEL, CERT_TONE, ENERGY_LABEL, SECTIONS, certNeeded, certState, dealLabel, netProfit,
  hasLeaseholdFigures, isFreehold, leaseholdNet, occupancyLabel, occupancyTone, ordinal, propertyTypeLabel, rentStatusLabel, rentStatusTone, tenureLabel,
} from "@/lib/portfolio";


type Tab = "overview" | "compliance" | "money" | "rooms" | "letters" | "maintenance" | "files";

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
  const [tab, setTab] = useState<Tab>("overview");

  async function load() {
    try {
      // Only the first load shows the loading screen: swapping the page out on
      // a refresh unmounts any dialog that is still closing and leaves the page
      // unclickable.
      if (!property) setLoading(true);
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
  const linkRoom = async (room: string, tid: number | null) => {
    await api("PUT", `/api/properties/${property.id}/room-tenant`, { room, tenant_id: tid });
    const r = await api<{ rooms: Room[] }>("GET", `/api/properties/${property.id}/rooms`);
    setRooms(r.rooms);
  };
  const openWorkOrders = workOrders.filter((w) => w.status !== "completed" && w.status !== "cancelled");

  const money = (n: number) => formatMoney(n, app.settings.currency);
  const sectionInfo = SECTIONS.find((x) => x.value === property.section) ?? SECTIONS[0];
  const backHref = `/properties?section=${property.section}`;
  const showRooms = rooms.length > 0 || property.hmo === 1 || property.occupancy === "part_occupied";
  const showMoney = property.section !== "managed";
  const certIssues = CERTIFICATES.filter((c) => certNeeded(property, c.key) && ["expired", "due_soon"].includes(certState(property[c.key])));
  const tabs: { id: Tab; label: string; count?: number; hidden?: boolean }[] = [
    { id: "overview", label: "Overview" },
    { id: "compliance", label: "Compliance", count: certIssues.length || undefined },
    { id: "money", label: "Money", hidden: !showMoney },
    { id: "rooms", label: showRooms ? "Rooms & units" : "Units" },
    { id: "letters", label: "Letters" },
    { id: "maintenance", label: "Maintenance", count: openWorkOrders.length || undefined },
    { id: "files", label: "Access & files" },
  ];
  const current = tabs.find((t) => t.id === tab && !t.hidden) ? tab : "overview";

  const workOrderList = (list: WorkOrder[], empty: string) =>
    list.length === 0 ? (
      <Card className="p-8 text-center text-sm text-muted-foreground">{empty}</Card>
    ) : (
      <Card className="divide-y">
        {list.map((w) => (
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
    );

  const certTiles = (
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
  );

  const fact = (label: string, value: React.ReactNode) => (
    <div className="flex items-baseline justify-between gap-3 py-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{value || <span className="font-normal text-faint">—</span>}</dd>
    </div>
  );

  return (
    <PageShell
      title={
        <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-sans text-sm font-medium text-muted-foreground">
          <button type="button" onClick={() => navigate(backHref)} className="inline-flex items-center gap-1 transition-colors hover:text-foreground">
            <ArrowLeft className="size-4" aria-hidden />
            {sectionInfo.label}
          </button>
          <ChevronRight className="size-3.5 text-faint" aria-hidden />
          <span className="truncate text-foreground">{property.ref ? `Ref ${property.ref}` : property.name}</span>
        </nav>
      }
      width="max-w-[90rem]"
    >
      {/* Record header */}
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="flex min-w-0 items-start gap-4">
          <div className={cn("flex size-14 shrink-0 items-center justify-center rounded-md", palette.bg, palette.text)}>
            <Building2 className="size-7" />
          </div>
          <div className="min-w-0">
            <h1 className="display truncate text-[1.75rem] font-medium leading-tight md:text-[2rem]">{property.name}</h1>
            {(property.address || property.zip) && (
              <p className="mt-1 flex items-center gap-1 truncate text-sm text-muted-foreground">
                <MapPin className="size-3.5 shrink-0" />
                {[property.address, property.zip].filter(Boolean).join(", ")}
              </p>
            )}
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              <span className="badge-tone tone-info">{sectionInfo.label}</span>
              <Badge variant={occupancyTone(property.occupancy)}>{occupancyLabel(property.occupancy)}</Badge>
              {property.rent_status && <Badge variant={rentStatusTone(property.rent_status)}>{rentStatusLabel(property.rent_status)}</Badge>}
              {certIssues.length > 0 && <span className="badge-tone tone-danger">{certIssues.length} certificate{certIssues.length === 1 ? "" : "s"} to sort</span>}
              {openWorkOrders.length > 0 && <span className="badge-tone tone-warning">{openWorkOrders.length} open repair{openWorkOrders.length === 1 ? "" : "s"}</span>}
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <Button variant="outline" onClick={() => setWoDialogOpen(true)}>
            <Wrench className="mr-1.5 size-4" /> Log repair
          </Button>
          <Button onClick={() => setEditingProperty(true)}>
            <Pencil className="mr-1.5 size-4" /> Edit
          </Button>
        </div>
      </header>

      {/* Headline numbers */}
      <section className="grid grid-cols-2 gap-3 md:grid-cols-4">
        <SummaryCard label="Rent in" value={money(property.rent_in)} sub={property.rent_in_day ? `arrives on the ${ordinal(property.rent_in_day)}` : undefined} />
        <SummaryCard
          label="Rent / mortgage out"
          value={money(property.rent_out + property.other_costs)}
          sub={property.payment_out_day ? `leaves on the ${ordinal(property.payment_out_day)}` : property.rent_out || property.other_costs ? undefined : "no costs entered"}
        />
        <SummaryCard
          label="Net profit"
          value={money(netProfit(property))}
          sub={property.rent_in ? `${Math.round((netProfit(property) / property.rent_in) * 100)}% margin` : undefined}
          tone={netProfit(property) < 0 ? "warn" : "good"}
        />
        <SummaryCard
          label="Arrears"
          value={property.arrears_amount ? money(property.arrears_amount) : "None"}
          sub={property.months_arrears ? `${property.months_arrears} months behind` : undefined}
          tone={property.arrears_amount > 0 ? "warn" : "default"}
        />
      </section>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
        {/* Main column: tabs */}
        <div className="min-w-0 space-y-5">
          <div className="-mx-1 overflow-x-auto border-b" role="tablist" aria-label="Property sections">
            <div className="flex min-w-max gap-1 px-1">
              {tabs.filter((t) => !t.hidden).map((t) => (
                <button
                  key={t.id}
                  type="button"
                  role="tab"
                  aria-selected={current === t.id}
                  onClick={() => setTab(t.id)}
                  className={cn(
                    "-mb-px inline-flex h-10 items-center gap-1.5 border-b-2 px-3 text-sm font-medium transition-colors",
                    current === t.id ? "border-primary text-foreground" : "border-transparent text-muted-foreground hover:text-foreground",
                  )}
                >
                  {t.label}
                  {t.count ? <span className="rounded-full bg-muted px-1.5 text-[11px] tabular-nums text-muted-foreground">{t.count}</span> : null}
                </button>
              ))}
            </div>
          </div>

          {current === "overview" && (
            <>
              <Card className="p-5">
                <div className="mb-3 flex items-center justify-between gap-2">
                  <h2 className="text-sm font-semibold">Compliance at a glance</h2>
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setTab("compliance")}>Certificates &amp; documents →</button>
                </div>
                {certTiles}
              </Card>
              <LeaseholdCard property={property} currency={app.settings.currency} />
              {showRooms && rooms.length > 0 && (
                <RoomsSection rooms={rooms} property={property} currency={app.settings.currency} onLink={linkRoom} />
              )}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-sm font-semibold">Open repairs</h2>
                  <button type="button" className="text-xs font-medium text-primary hover:underline" onClick={() => setTab("maintenance")}>All maintenance →</button>
                </div>
                {workOrderList(openWorkOrders.slice(0, 5), "Nothing open. Log a repair with the button at the top.")}
              </section>
            </>
          )}

          {current === "compliance" && (
            <Card className="p-5">
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                <h2 className="text-sm font-semibold">Certificates</h2>
                <EnergyPicker property={property} />
              </div>
              {certTiles}
              <h2 className="mb-3 mt-6 text-sm font-semibold">Certificates &amp; documents</h2>
              <DocumentsPanel property={property} />
            </Card>
          )}

          {current === "money" && showMoney && (
            <>
              <FinanceCard property={property} onSaved={setProperty} />
              <MortgagesCard
                property={property}
                onChanged={() => {
                  api<{ property: Property }>("GET", `/api/properties/${property.id}`).then((r) => setProperty(r.property)).catch(() => {});
                }}
              />
              <LeaseholdCard property={property} currency={app.settings.currency} />
            </>
          )}

          {current === "rooms" && (
            <>
              {showRooms && <RoomsSection rooms={rooms} property={property} currency={app.settings.currency} onLink={linkRoom} />}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-[1.0625rem] font-semibold leading-tight">Units</h2>
                  <Button size="sm" onClick={() => { setEditingUnit(undefined); setUnitDialogOpen(true); }}>
                    <Plus className="mr-1 h-4 w-4" /> New unit
                  </Button>
                </div>
                {units.length === 0 ? (
                  <Card className="p-8 text-center text-sm text-muted-foreground">No units yet. Add one to start tracking leases and rent.</Card>
                ) : (
                  <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {units.map((u) => (
                      <Card key={u.id} className="cursor-pointer p-4 transition-colors duration-150 hover:bg-muted" onClick={() => { setEditingUnit(u); setUnitDialogOpen(true); }}>
                        <div className="flex items-start justify-between">
                          <div>
                            <h3 className="font-semibold">{u.name}</h3>
                            <p className="mt-0.5 text-xs text-muted-foreground">
                              {u.bedrooms} bed · {u.bathrooms} bath{u.sqft ? ` · ${u.sqft} sq ft` : ""}
                            </p>
                          </div>
                          <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold capitalize", STATUS_TONE[u.status])}>{u.status}</span>
                        </div>
                        <div className="mt-3 flex items-end justify-between border-t pt-3">
                          <div>
                            <div className="stat-label">Market rent</div>
                            <div className="text-sm font-semibold tabular-nums">{money(u.market_rent)}</div>
                          </div>
                          {u.active_tenant_name && <div className="text-right text-xs text-muted-foreground">{u.active_tenant_name}</div>}
                        </div>
                      </Card>
                    ))}
                  </div>
                )}
              </section>
              <VoidsCard property={property} />
            </>
          )}

          {current === "letters" && <LettersCard propertyId={property.id} navigate={navigate} />}

          {current === "maintenance" && (
            <section className="space-y-5">
              <div className="flex items-center justify-between">
                <h2 className="text-[1.0625rem] font-semibold leading-tight">Work orders</h2>
                <Button size="sm" variant="outline" onClick={() => setWoDialogOpen(true)}>
                  <Plus className="mr-1 h-4 w-4" /> New work order
                </Button>
              </div>
              {workOrderList(workOrders, "No work orders for this property.")}
              <RepairQrCard property={property} />
            </section>
          )}

          {current === "files" && (
            <>
              <AccessCard property={property} />
              <MediaCard property={property} />
            </>
          )}
        </div>

        {/* Details panel */}
        <aside className="space-y-4 lg:sticky lg:top-0 lg:self-start">
          <Card className="p-5">
            <h2 className="mb-2 text-sm font-semibold">Tenant</h2>
            <TenantPicker
              value={property.tenant_id}
              placeholder={property.tenant_label ? `${property.tenant_label} (from sheet)` : "Choose tenant…"}
              onChange={async (tid) => {
                await api("PUT", `/api/properties/${property.id}`, { tenant_id: tid });
                const { property: p } = await api<{ property: Property }>("GET", `/api/properties/${property.id}`);
                setProperty(p);
              }}
            />
            {property.tenant_id && property.tenant_label && property.tenant_label !== property.tenant_name && (
              <p className="mt-2 text-xs text-muted-foreground">Sheet says: {property.tenant_label}</p>
            )}
            {property.tenant_id && (
              <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => navigate(`/tenants/${property.tenant_id}`)}>
                Open tenant →
              </button>
            )}
          </Card>

          <Card className="p-5">
            <h2 className="mb-1 text-sm font-semibold">About this home</h2>
            <dl className="divide-y divide-border/60 text-sm">
              {fact("Ref", property.ref)}
              {fact("Sits in", sectionInfo.label)}
              {fact("Deal", dealLabel(property.deal_type))}
              {fact("Owner", property.owner)}
              {fact("Type", propertyTypeLabel(property.type))}
              {fact("Bedrooms", property.bedrooms ? `${property.bedrooms}${property.hmo ? " · HMO" : ""}` : property.hmo ? "HMO" : null)}
              {fact("Tenure", property.tenure ? tenureLabel(property.tenure) : null)}
              {fact("Energy", property.energy ? ENERGY_LABEL[property.energy] : null)}
              {fact("Open repairs", String(openWorkOrders.length))}
            </dl>
          </Card>

          {property.notes && (
            <Card className="p-5">
              <h2 className="mb-2 text-sm font-semibold">Notes</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{property.notes}</p>
            </Card>
          )}
        </aside>
      </div>

      <PropertyDialog
        open={editingProperty}
        onOpenChange={(o) => { setEditingProperty(o); if (!o) load(); }}
        onDeleted={() => {
          setEditingProperty(false);
          // Let the dialogs finish closing before leaving, and make sure the
          // page is clickable again on the list.
          setTimeout(() => {
            document.body.style.pointerEvents = "";
            navigate("/properties");
          }, 250);
        }}
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

function SummaryCard({ label, value, sub, tone = "default" }: { label: string; value: string; sub?: string; tone?: "default" | "warn" | "good" }) {
  return (
    <Card className="p-4">
      <div className="stat-label">{label}</div>
      <div className={cn("display mt-1.5 text-[1.625rem] font-medium leading-none tabular-nums", tone === "warn" && "text-warning", tone === "good" && "text-success")}>{value}</div>
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
