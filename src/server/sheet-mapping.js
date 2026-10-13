// Spreadsheet → portfolio mapping, shared by the server's Google Sheet sync
// (src/server/sync.ts) and the command-line importer (scripts/import-sheet.mjs).
// Plain JavaScript so both can load it without a TypeScript step.

// ── CSV ────────────────────────────────────────────────────────────

/** RFC 4180 CSV → array of objects keyed by the header row. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += ch;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  const [header = [], ...body] = rows;
  const keys = header.map((h) => h.trim());
  return body
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}

// ── Field helpers ──────────────────────────────────────────────────

/** First column whose header starts with any of the given names (case-insensitive). */
const pick = (row, ...names) => {
  for (const n of names) {
    const key = Object.keys(row).find((k) => k.toLowerCase().startsWith(n.toLowerCase()));
    if (key && row[key] !== "") return row[key];
  }
  return "";
};
const money = (v) => {
  const n = parseFloat(String(v).replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? n : 0;
};
const int = (v) => {
  const n = parseInt(String(v).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : null;
};
const day = (v) => {
  const n = int(v);
  return n && n >= 1 && n <= 31 ? n : null;
};
const text = (v) => (v && v !== "–" && v !== "-" ? v : null);

/** dd/mm/yyyy, yyyy-mm-dd or a Sheets date → yyyy-mm-dd. */
const date = (v) => {
  if (!v) return null;
  let m = v.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = v.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/);
  if (m) {
    const y = m[3].length === 2 ? `20${m[3]}` : m[3];
    return `${y}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}`;
  }
  return null;
};

const choose = (v, map, fallback) => {
  const key = String(v || "").toLowerCase().replace(/[^a-z]/g, "");
  for (const [k, out] of Object.entries(map)) if (key.startsWith(k)) return out;
  return fallback;
};

const DEAL = { jointventure: "joint_venture", jv: "joint_venture", owned: "owned", renttorent: "rent_to_rent", rtr: "rent_to_rent", groundrent: "ground_rent" };
const TYPE = { flat: "flat", apartment: "flat", maisonette: "maisonette", terrace: "terraced", semi: "semi_detached", detached: "detached", bungalow: "bungalow", commercial: "commercial", shop: "commercial", office: "commercial" };
const OCC = { occupied: "occupied", partoccupied: "part_occupied", part: "part_occupied", vacant: "vacant", empty: "vacant", eviction: "eviction" };
const RENT = { ontime: "on_time", paid: "on_time", inarrears: "in_arrears", arrears: "in_arrears", advance: "in_advance", inadvance: "in_advance", groundrent: "ground_rent" };
const LEAD = { new: "new", contacted: "contacted", viewing: "viewing", offer: "offer_made", underoffer: "under_offer", sstc: "under_offer", completed: "completed", sold: "completed", withdrawn: "withdrawn", dead: "withdrawn" };

const COUNTIES = ["Essex", "Kent", "Surrey", "Sussex", "East Sussex", "West Sussex", "Yorkshire", "Bedfordshire", "Hertfordshire", "Suffolk", "Norfolk", "Berkshire", "Buckinghamshire", "Middlesex", "Wiltshire", "Hampshire", "Leicestershire"];

// ── Properties ─────────────────────────────────────────────────────

export function toProperty(r, compliance, section = "owned") {
  const address = pick(r, "Full Address", "Address");
  const parts = address.split(",").map((s) => s.trim()).filter(Boolean);
  const county = parts.length > 1 && COUNTIES.includes(parts[parts.length - 1]) ? parts[parts.length - 1] : null;
  const ref = pick(r, "Ref", "Property Ref");
  const rentOut = money(pick(r, "Rent / Mortgage Out", "Rent / Mortgage"));
  const totalCosts = money(pick(r, "Total Costs", "Total Monthly Costs"));
  const rentStatusRaw = pick(r, "Rent Paid", "Arrears");
  const c = compliance.get(ref) ?? {};

  return {
    ref: text(ref),
    name: parts[0] || address || `Property ${ref}`,
    type: choose(pick(r, "Property Type"), TYPE, "other"),
    address: text(address),
    city: text(pick(r, "Area")) ?? (parts.length > 1 ? parts[parts.length - (county ? 2 : 1)] : null),
    state: county,
    zip: text(pick(r, "Postcode")),
    owner: text(pick(r, "Owner", "Landlord")),
    deal_type: choose(pick(r, "Deal Type"), DEAL, section === "managed" ? "rent_to_rent" : "owned"),
    section,
    bedrooms: int(pick(r, "Bedrooms")),
    hmo: /^y/i.test(pick(r, "HMO")) ? 1 : 0,
    occupancy: choose(pick(r, "Occupancy"), OCC, "occupied"),
    tenant_label: text(pick(r, "Tenant / Agent", "Tenant Name")),
    rent_in: money(pick(r, "Rent In", "Monthly Gross Income")),
    rent_out: rentOut,
    other_costs: Math.max(0, totalCosts - rentOut),
    rent_in_day: day(pick(r, "Rent In Day", "Income day")),
    payment_out_day: day(pick(r, "Payment Out Day", "Rent/mortgage Day")),
    rent_status: rentStatusRaw ? choose(rentStatusRaw, RENT, null) : null,
    months_arrears: money(pick(r, "Months in Arrears")),
    arrears_amount: money(pick(r, "Paid After Tenancy", "Arrears (£", "Arrears Amount")),
    gas_expiry: date(c["Gas Safety Expiry"]),
    epc_expiry: date(c["EPC Expiry"]),
    eicr_expiry: date(c["EICR Expiry"]),
    licence_expiry: date(c["Licence Expiry"]),
    insurance_expiry: date(c["Insurance Expiry"]),
    notes: text(pick(r, "Notes")),
  };
}

export function toLead(r) {
  const contact = pick(r, "Contact");
  const email = contact.match(/[^\s|,;]+@[^\s|,;]+/)?.[0] ?? null;
  const phone = contact.replace(email ?? "", "").replace(/[|,;]/g, " ").trim() || null;
  return {
    landlord_name: pick(r, "Landlord Name", "Name"),
    phone,
    email,
    location: text(pick(r, "Property Location", "Location")),
    address: text(pick(r, "Full Address", "Address")),
    postcode: text(pick(r, "Postcode")),
    property_type: text(pick(r, "Property Type")),
    bedrooms: int(pick(r, "Bedrooms")),
    bathrooms: int(pick(r, "Bathrooms")),
    tenure: text(pick(r, "Tenure")),
    asking_price: money(pick(r, "Asking Price")) || null,
    estimated_value: money(pick(r, "Estimated Value")) || null,
    offer_amount: money(pick(r, "Offer Amount")) || null,
    buyer_agent: text(pick(r, "Buyer")),
    solicitor: text(pick(r, "Solicitor")),
    status: choose(pick(r, "Status"), LEAD, "new"),
    next_action: text(pick(r, "Next Action")),
    notes: text(pick(r, "Notes")),
  };
}

const ROOM_STATUS = { ontime: "on_time", paid: "on_time", inarrears: "in_arrears", arrears: "in_arrears", roomempty: "empty", empty: "empty", vacant: "empty" };

/** One row of the Tenants tab: a room and who pays for it. */
export function toRoom(r, i) {
  return {
    ref: text(pick(r, "Ref")),
    room: text(pick(r, "Room")) ?? `Room ${i + 1}`,
    tenant_name: text(pick(r, "Tenant")),
    rent: money(pick(r, "Rent")),
    pay_day: day(pick(r, "Pay Day", "Rent In Day")),
    rent_status: choose(pick(r, "Rent Paid", "Status"), ROOM_STATUS, null),
    start_date: date(pick(r, "Tenancy Start", "Start")),
    end_date: date(pick(r, "Tenancy End", "End")),
    notes: text(pick(r, "Notes")),
    sort: i,
  };
}

// ── Whole payload ──────────────────────────────────────────────────

/**
 * Build an import payload from the CSV text of each tab. Homes on the
 * Rent to Rent tab are ones we manage but don't own (section "managed").
 * @param {{ properties?: string, rentToRent?: string, compliance?: string, sales?: string, tenants?: string }} csv
 */
export function buildPayload(csv) {
  const compliance = new Map(parseCsv(csv.compliance ?? "").map((r) => [pick(r, "Ref"), r]));
  const fromTab = (text, section) =>
    parseCsv(text ?? "")
      .filter((r) => pick(r, "Full Address", "Address"))
      .map((r) => toProperty(r, compliance, section));
  const properties = [...fromTab(csv.properties, "owned"), ...fromTab(csv.rentToRent, "managed")];
  const leads = parseCsv(csv.sales ?? "").map(toLead).filter((l) => l.landlord_name);
  const rooms = parseCsv(csv.tenants ?? "").map(toRoom).filter((r) => r.ref);
  return { properties, leads, rooms };
}
