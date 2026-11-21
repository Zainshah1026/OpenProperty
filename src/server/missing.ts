// "What's missing": for every home, the details and paperwork the CRM
// doesn't have yet (or that have run out). Used by the to-do checklist.
//
// GET /api/missing                 signed in
// GET /api/jarvis/missing          Authorization: Bearer JARVIS_TOKEN

import type { Hono } from "hono";
import { query } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

export interface MissingItem {
  property_id: number;
  ref: string | null;
  home: string;
  postcode: string | null;
  section: string;
  area: "Tenant" | "Rent" | "Certificates" | "Insurance" | "Mortgage" | "Home details";
  item: string;
  priority: "High" | "Medium" | "Low";
}

interface P {
  id: number; ref: string | null; name: string; address: string | null; zip: string | null; section: string; deal_type: string;
  tenure: string | null; bedrooms: number | null; hmo: number; occupancy: string; tenant_label: string | null; tenant_email: string | null;
  tenant_id: number | null; energy: string | null; rent_in: number; rent_out: number; rent_in_day: number | null; payment_out_day: number | null;
  rent_status: string | null; gas_expiry: string | null; epc_expiry: string | null; eicr_expiry: string | null; licence_expiry: string | null;
  insurance_expiry: string | null; market_value: number | null; lender: string | null; mortgage_balance: number | null; fixed_rate_end: string | null;
  owner: string | null;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function buildMissing(): Promise<MissingItem[]> {
  const props = await query<P>("SELECT * FROM properties ORDER BY CAST(ref AS INTEGER), ref, name");
  const docs = await query<{ property_id: number; kind: string }>("SELECT DISTINCT property_id, kind FROM compliance_documents");
  const hasDoc = new Set(docs.map((d) => `${d.property_id}:${d.kind}`));
  const morts = await query<{ property_id: number; deal_end: string | null }>("SELECT property_id, deal_end FROM mortgages WHERE status = 'active' AND property_id IS NOT NULL").catch(() => []);
  const mortBy = new Map<number, { deal_end: string | null }[]>();
  for (const m of morts) mortBy.set(m.property_id, [...(mortBy.get(m.property_id) ?? []), m]);
  const tenants = await query<{ id: number; phone: string | null; email: string | null }>("SELECT id, phone, email FROM tenants").catch(() => []);
  const tenantBy = new Map(tenants.map((t) => [t.id, t]));
  const roomCount = await query<{ property_id: number; n: number }>("SELECT property_id, COUNT(*) AS n FROM rooms GROUP BY property_id").catch(() => []);
  const rooms = new Map(roomCount.map((r) => [r.property_id, r.n]));

  const now = today();
  const out: MissingItem[] = [];
  for (const p of props) {
    const add = (area: MissingItem["area"], item: string, priority: MissingItem["priority"]) =>
      out.push({ property_id: p.id, ref: p.ref, home: p.address || p.name, postcode: p.zip, section: p.section, area, item, priority });

    const groundRentOnly = p.deal_type === "ground_rent" || p.section === "freehold" || p.rent_status === "ground_rent";
    const owned = p.section !== "managed";
    const let_ = !groundRentOnly && p.occupancy !== "vacant";

    // Home details
    if (!p.address) add("Home details", "Add the full address", "Medium");
    if (!p.zip) add("Home details", "Add the postcode", "Medium");
    if (!groundRentOnly && !p.bedrooms) add("Home details", "Add the number of bedrooms", "Low");
    if (owned && !p.tenure) add("Home details", "Say if it's freehold or leasehold", "Low");
    if (owned && !groundRentOnly && !p.market_value) add("Home details", "Add a rough market value", "Low");
    if (!p.owner) add("Home details", p.section === "managed" ? "Add the landlord you rent it from" : "Add who owns it (you or which company)", "Low");

    if (groundRentOnly) continue; // freeholds we only collect ground rent on: no tenant, rent or certificates of ours

    // Tenant
    if (let_) {
      const t = p.tenant_id ? tenantBy.get(p.tenant_id) : undefined;
      if (!p.tenant_label && !p.tenant_id && !(rooms.get(p.id) ?? 0)) add("Tenant", "Add the tenant's name", "High");
      if (!p.tenant_email && !t?.email) add("Tenant", "Add the tenant's email (rent invoices go there)", "Medium");
      if (!t?.phone) add("Tenant", "Add the tenant's phone number", "Medium");
    }

    // Rent
    if (let_ && !p.rent_in) add("Rent", "Add the monthly rent", "High");
    if (p.rent_in > 0 && !p.rent_in_day) add("Rent", "Add the day rent comes in", "Medium");
    if (p.rent_out > 0 && !p.payment_out_day) add("Rent", p.section === "managed" ? "Add the day you pay the landlord" : "Add the day the mortgage goes out", "Medium");

    // Certificates
    const cert = (kind: string, label: string, date: string | null, needed: boolean) => {
      if (!needed) return;
      if (!date) add("Certificates", `Add the ${label} expiry date`, "High");
      else if (date < now) add("Certificates", `${label} ran out on ${date.split("-").reverse().join("/")}: renew it`, "High");
      if (!hasDoc.has(`${p.id}:${kind}`)) add("Certificates", `Upload the ${label} certificate`, date && date >= now ? "Low" : "Medium");
    };
    if (!p.energy) add("Certificates", "Say if it has gas or is all electric", "Medium");
    cert("gas", "Gas safety", p.gas_expiry, p.energy !== "all_electric");
    cert("eicr", "EICR", p.eicr_expiry, true);
    cert("epc", "EPC", p.epc_expiry, true);
    cert("licence", "HMO licence", p.licence_expiry, !!p.hmo);
    // Insurance is one item covering every policy (buildings, landlord, contents, rent guarantee).
    if (owned) {
      const d = p.insurance_expiry;
      if (!d) add("Insurance", hasDoc.has(`${p.id}:insurance`) ? "Add the insurance renewal date" : "Add the insurance policy (buildings / landlord)", "Medium");
      else if (d < now) add("Insurance", `Insurance ran out on ${d.split("-").reverse().join("/")}: renew it or add the new policy`, "High");
    }

    // Mortgage (owned homes paying something out each month)
    if (owned && p.rent_out > 0) {
      const ms = mortBy.get(p.id) ?? [];
      if (!ms.length && !p.lender) add("Mortgage", "Add the mortgage (lender, deal end, balance)", "Medium");
      else {
        if (!ms.some((m) => m.deal_end) && !p.fixed_rate_end) add("Mortgage", "Add when the mortgage deal ends", "Medium");
        if (!p.mortgage_balance && !ms.length) add("Mortgage", "Add the mortgage balance", "Low");
      }
    }
  }
  return out;
}

export function registerMissingRoutes(app: AnyApp) {
  app.get("/api/missing", async (c) => c.json({ items: await buildMissing() }));
  app.get("/api/jarvis/missing", async (c) => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const token = String((c.env as any)?.JARVIS_TOKEN ?? "");
    if (!token || c.req.header("authorization") !== `Bearer ${token}`) return c.json({ error: "Not allowed" }, 401);
    return c.json({ items: await buildMissing() });
  });
}
