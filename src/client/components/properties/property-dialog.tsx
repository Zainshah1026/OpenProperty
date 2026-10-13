import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { CERTIFICATES, DEAL_TYPES, OCCUPANCY, PROPERTY_TYPES, RENT_STATUS, TENURES } from "@/lib/portfolio";
import type { DealType, NewProperty, Occupancy, Property, PropertyType, RentStatus } from "@/types";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  property?: Property;
  onSaved?: (p: Property) => void;
}

/** Every editable field as a string, the way the inputs hold it. */
type Form = Record<string, string>;

const TEXT = ["ref", "name", "address", "city", "state", "zip", "owner", "tenant_label", "notes"] as const;
const NUM = ["rent_in", "rent_out", "other_costs", "months_arrears", "arrears_amount", "ground_rent_paid", "service_charge_paid", "ground_rent_received", "service_charge_received"] as const;
const INT = ["bedrooms", "rent_in_day", "payment_out_day", "year_built"] as const;
const DATES = CERTIFICATES.map((c) => c.key);

function toForm(p?: Property): Form {
  const f: Form = {};
  for (const k of [...TEXT, ...NUM, ...INT, ...DATES]) {
    const v = p ? (p as unknown as Record<string, unknown>)[k] : undefined;
    f[k] = v === null || v === undefined || (typeof v === "number" && v === 0 && k !== "rent_in") ? "" : String(v);
  }
  f.type = p?.type ?? "flat";
  f.deal_type = p?.deal_type ?? "owned";
  f.occupancy = p?.occupancy ?? "occupied";
  f.rent_status = p?.rent_status ?? "on_time";
  f.hmo = p?.hmo ? "1" : "0";
  f.tenure = p?.tenure ?? "unknown";
  return f;
}

export function PropertyDialog({ open, onOpenChange, property, onSaved }: Props) {
  const app = useApp();
  const [f, setF] = useState<Form>(() => toForm(property));
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) setF(toForm(property));
  }, [open, property]);

  const set = (k: string) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));
  const bind = (k: string) => ({ value: f[k] ?? "", onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => set(k)(e.target.value) });

  async function save() {
    const name = (f.name || f.address || "").trim();
    if (!name) return;
    setSaving(true);
    try {
      const payload: NewProperty = { name };
      const out = payload as unknown as Record<string, unknown>;
      for (const k of TEXT) if (k !== "name") out[k] = f[k]?.trim() || null;
      for (const k of NUM) out[k] = f[k] ? Math.max(0, parseFloat(f[k].replace(/[£,]/g, "")) || 0) : 0;
      for (const k of INT) {
        const n = parseInt(f[k], 10);
        out[k] = Number.isFinite(n) ? n : null;
      }
      for (const k of DATES) out[k] = f[k] || null;
      payload.type = f.type as PropertyType;
      payload.deal_type = f.deal_type as DealType;
      payload.occupancy = f.occupancy as Occupancy;
      payload.rent_status = f.rent_status as RentStatus;
      payload.hmo = f.hmo === "1" ? 1 : 0;
      payload.tenure = f.tenure === "unknown" ? null : (f.tenure as Property["tenure"]);
      const saved = property ? await app.updateProperty(property.id, payload) : await app.createProperty(payload);
      onSaved?.(saved);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setSaving(false);
    }
  }

  async function remove() {
    if (!property) return;
    try {
      await app.deleteProperty(property.id);
      onOpenChange(false);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{property ? "Edit property" : "New property"}</DialogTitle>
          </DialogHeader>

          <div className="grid gap-5">
            <Section title="The home">
              <div className="grid grid-cols-4 gap-3">
                <Field label="Ref" className="col-span-1"><Input {...bind("ref")} placeholder="27" /></Field>
                <Field label="Name" className="col-span-3"><Input {...bind("name")} placeholder="34 Wordsworth Road" /></Field>
              </div>
              <Field label="Full address"><Input {...bind("address")} placeholder="34 Wordsworth Road, London" /></Field>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Town / area"><Input {...bind("city")} /></Field>
                <Field label="County"><Input {...bind("state")} /></Field>
                <Field label="Postcode"><Input {...bind("zip")} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Type"><Choice value={f.type} onChange={set("type")} options={PROPERTY_TYPES} /></Field>
                <Field label="Bedrooms"><Input type="number" min={0} {...bind("bedrooms")} /></Field>
                <Field label="HMO"><Choice value={f.hmo} onChange={set("hmo")} options={[{ value: "0", label: "No" }, { value: "1", label: "Yes" }]} /></Field>
              </div>
              <Field label="Tenure"><Choice value={f.tenure} onChange={set("tenure")} options={[{ value: "unknown", label: "Not set" }, ...TENURES]} /></Field>
            </Section>

            <Section title="Ownership & letting">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Owner / company" hint="For rent to rent, the landlord you rent from"><Input {...bind("owner")} list="owner-options" /></Field>
                <Field label="Deal type"><Choice value={f.deal_type} onChange={set("deal_type")} options={DEAL_TYPES} /></Field>
              </div>
              <datalist id="owner-options">
                {[...new Set(app.properties.map((p) => p.owner).filter(Boolean))].map((o) => <option key={o} value={o ?? ""} />)}
              </datalist>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Occupancy"><Choice value={f.occupancy} onChange={set("occupancy")} options={OCCUPANCY} /></Field>
                <Field label="Tenant / agent"><Input {...bind("tenant_label")} /></Field>
              </div>
            </Section>

            <Section title="Money (per month)">
              <div className="grid grid-cols-3 gap-3">
                <Field label="Rent in (£)"><Input inputMode="decimal" {...bind("rent_in")} /></Field>
                <Field label="Rent / mortgage out (£)"><Input inputMode="decimal" {...bind("rent_out")} /></Field>
                <Field label="Other costs (£)" hint="Council tax, utilities, insurance"><Input inputMode="decimal" {...bind("other_costs")} /></Field>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Rent arrives on day"><Input type="number" min={1} max={31} {...bind("rent_in_day")} /></Field>
                <Field label="Payment out on day"><Input type="number" min={1} max={31} {...bind("payment_out_day")} /></Field>
              </div>
              <div className="grid grid-cols-3 gap-3">
                <Field label="Rent status"><Choice value={f.rent_status} onChange={set("rent_status")} options={RENT_STATUS} /></Field>
                <Field label="Months behind"><Input inputMode="decimal" {...bind("months_arrears")} /></Field>
                <Field label="Arrears (£)"><Input inputMode="decimal" {...bind("arrears_amount")} /></Field>
              </div>
            </Section>

            <Section title="Ground rent & service charge (per year)">
              <div className="grid grid-cols-2 gap-3">
                <Field label="Ground rent we pay (£)"><Input inputMode="decimal" {...bind("ground_rent_paid")} /></Field>
                <Field label="Service charge we pay (£)"><Input inputMode="decimal" {...bind("service_charge_paid")} /></Field>
                <Field label="Ground rent we receive (£)"><Input inputMode="decimal" {...bind("ground_rent_received")} /></Field>
                <Field label="Service charge we receive (£)"><Input inputMode="decimal" {...bind("service_charge_received")} /></Field>
              </div>
            </Section>

            <Section title="Compliance expiry dates">
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                {CERTIFICATES.map((c) => (
                  <Field key={c.key} label={c.label}><Input type="date" {...bind(c.key)} /></Field>
                ))}
              </div>
            </Section>

            <Field label="Notes"><Textarea {...bind("notes")} rows={3} /></Field>
          </div>

          <DialogFooter className="mt-2">
            {property && (
              <Button type="button" variant="destructive" className="sm:mr-auto" onClick={() => setConfirming(true)}>
                Delete
              </Button>
            )}
            <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
            <Button type="button" onClick={save} disabled={saving || !(f.name || f.address).trim()}>
              {property ? "Save changes" : "Create property"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {property ? (
        <ConfirmDelete
          open={confirming}
          onOpenChange={setConfirming}
          title={`Delete "${property.name}"?`}
          description="Its units, leases, and rent history go with it. This cannot be undone."
          onConfirm={remove}
        />
      ) : null}
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="grid gap-3">
      <legend className="section-label mb-1">{title}</legend>
      {children}
    </fieldset>
  );
}

function Field({ label, hint, className, children }: { label: string; hint?: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <Label className="mb-1 block">{label}</Label>
      {children}
      {hint && <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>}
    </div>
  );
}

function Choice({ value, onChange, options }: { value: string; onChange: (v: string) => void; options: { value: string; label: string }[] }) {
  return (
    <Select value={value} onValueChange={onChange}>
      <SelectTrigger><SelectValue /></SelectTrigger>
      <SelectContent>
        {options.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
      </SelectContent>
    </Select>
  );
}
