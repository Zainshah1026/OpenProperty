import { Hono, type Context } from "hono";
import { z } from "zod";
import { initDB, query, get, run } from "./db";
import { runSync, syncStatus } from "./sync";
import { registerInvoiceRoutes } from "./invoices";
import { registerAssistantRoutes } from "./assistant";
import { mailProvider, registerMailRoutes } from "./mail";
import { registerDocumentRoutes } from "./documents";
import { getUser, registerAuth } from "./auth";

type Env = {
  Bindings: {
    DB?: D1Database;
    /** Static build of the React app (wrangler.toml → [assets]). */
    ASSETS?: Fetcher;
    /** Password for the login prompt. Set it with `wrangler secret put APP_PASSWORD`. */
    APP_PASSWORD?: string;
    /** Optional username for the login prompt (defaults to "admin"). */
    APP_USERNAME?: string;
    /** Set to "true" in .dev.vars to skip the login prompt on your own machine. */
    ALLOW_NO_AUTH?: string;
    /** "true" re-enables the APP_USERNAME/APP_PASSWORD setup login even after an admin exists. */
    ALLOW_SETUP_LOGIN?: string;
    /** Google Sheet sync (see src/server/sync.ts). */
    /** Invoice emails via Resend. */
    RESEND_API_KEY?: string;
    INVOICE_FROM_EMAIL?: string;
    /** The Ask assistant (Claude API). */
    ANTHROPIC_API_KEY?: string;
    ASSISTANT_MODEL?: string;
    SHEET_SCRIPT_URL?: string;
    SHEET_SCRIPT_KEY?: string;
    SHEET_PUB_URL?: string;
    SHEET_PROPERTIES_GID?: string;
    SHEET_RENT_TO_RENT_GID?: string;
    SHEET_TENANTS_GID?: string;
    SHEET_COMPLIANCE_GID?: string;
    SHEET_SALES_GID?: string;
  };
};

const app = new Hono<Env>();

// ── Login ──────────────────────────────────────────────────────────
// Personal logins with per-person mailbox access: see src/server/auth.ts.
// Registered first so it guards every route below.

registerAuth(app, {
  headExtra: `<link rel="icon" type="image/svg+xml" href="/brand/favicon.svg"><link rel="manifest" href="/manifest.webmanifest"><meta name="theme-color" content="#0b7cc2"><link rel="apple-touch-icon" href="/brand/apple-touch-icon.png"><meta name="apple-mobile-web-app-capable" content="yes"><meta name="mobile-web-app-capable" content="yes"><meta name="apple-mobile-web-app-title" content="Chisti &amp; Co."><meta name="apple-mobile-web-app-status-bar-style" content="default">`,
  publicPaths: ["/api/health", "/manifest.webmanifest", "/sw.js"],
  allMailboxes: () => (mailProvider()?.accounts() ?? []).map((a) => a.toLowerCase()),
});

app.use("/api/*", async (c, next) => {
  initDB(c.env);
  await ensureSeeded();
  await next();
});

// ── First-run data ─────────────────────────────────────────────────
// A deploy applies `schema.sql` as DDL only, so defaults are written here,
// once. No sample portfolio: a real one is imported privately (see
// scripts/import-sheet.mjs), never committed to the repository.

const DEFAULT_SETTINGS: Record<string, string> = {
  default_rent_due_day: "1",
  late_fee_amount: "0",
  late_fee_grace_days: "14",
  currency: "GBP",
  rent_invoices_auto: "on",
  rent_invoice_days_before: "7",
  rent_invoice_from: "info@chistiandco.com",
};

let seeded = false;

async function ensureSeeded(): Promise<void> {
  if (seeded) return;
  seeded = true;
  try {
    for (const [key, value] of Object.entries(DEFAULT_SETTINGS)) {
      await run("INSERT OR IGNORE INTO settings (key, value) VALUES (?, ?)", [key, value]);
    }
  } catch {
    // A cold database mid-migration: the next request retries.
    seeded = false;
  }
}

// ── Helpers ────────────────────────────────────────────────────────

const intParam = (raw: string | undefined): number | null => {
  if (!raw) return null;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) ? n : null;
};

async function parseJson<T>(c: Context, schema: z.ZodType<T>): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    return { ok: false, error: "Invalid JSON" };
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map(i => `${i.path.join(".")}: ${i.message}`).join("; ") };
  return { ok: true, data: parsed.data };
}

function buildUpdate(fields: Record<string, unknown>): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const [k, v] of Object.entries(fields)) {
    if (v !== undefined) { sets.push(`${k} = ?`); params.push(v); }
  }
  return { sets, params };
}

// ── Properties ─────────────────────────────────────────────────────

const PROPERTY_TYPES = ["flat", "maisonette", "terraced", "semi_detached", "detached", "bungalow", "commercial", "other"] as const;
const DEAL_TYPES = ["owned", "joint_venture", "rent_to_rent", "ground_rent"] as const;
const OCCUPANCY = ["occupied", "part_occupied", "vacant", "eviction"] as const;
const RENT_STATUS = ["on_time", "in_arrears", "in_advance", "ground_rent"] as const;
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable();
const dayOfMonth = z.number().int().min(1).max(31).optional().nullable();

const PropertyInput = z.object({
  ref: z.string().optional().nullable(),
  name: z.string().min(1),
  type: z.enum(PROPERTY_TYPES).optional(),
  address: z.string().optional().nullable(),
  city: z.string().optional().nullable(),
  state: z.string().optional().nullable(),
  zip: z.string().optional().nullable(),
  year_built: z.number().int().optional().nullable(),
  owner: z.string().optional().nullable(),
  deal_type: z.enum(DEAL_TYPES).optional(),
  section: z.enum(["owned", "managed"]).optional(),
  tenure: z.enum(["freehold", "leasehold", "share_of_freehold"]).optional().nullable(),
  bedrooms: z.number().int().min(0).optional().nullable(),
  hmo: z.number().int().min(0).max(1).optional(),
  occupancy: z.enum(OCCUPANCY).optional(),
  tenant_label: z.string().optional().nullable(),
  rent_in: z.number().min(0).optional(),
  rent_out: z.number().min(0).optional(),
  other_costs: z.number().min(0).optional(),
  ground_rent_paid: z.number().min(0).optional(),
  service_charge_paid: z.number().min(0).optional(),
  ground_rent_received: z.number().min(0).optional(),
  service_charge_received: z.number().min(0).optional(),
  rent_in_day: dayOfMonth,
  payment_out_day: dayOfMonth,
  rent_status: z.enum(RENT_STATUS).optional().nullable(),
  months_arrears: z.number().min(0).optional(),
  arrears_amount: z.number().min(0).optional(),
  gas_expiry: isoDate,
  epc_expiry: isoDate,
  eicr_expiry: isoDate,
  licence_expiry: isoDate,
  insurance_expiry: isoDate,
  notes: z.string().optional().nullable(),
  color: z.string().optional(),
});

const PROPERTY_SELECT = `
  SELECT p.*,
    (p.rent_in - p.rent_out - p.other_costs + (p.ground_rent_received + p.service_charge_received - p.ground_rent_paid - p.service_charge_paid) / 12.0) as net_profit,
    (SELECT COUNT(*) FROM rooms r WHERE r.property_id = p.id) as room_count,
    (SELECT COUNT(*) FROM rooms r WHERE r.property_id = p.id AND r.tenant_name IS NOT NULL AND COALESCE(r.rent_status, '') != 'empty') as rooms_let,
    (SELECT COALESCE(SUM(r.rent), 0) FROM rooms r WHERE r.property_id = p.id) as rooms_rent,
    (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id) as unit_count,
    (SELECT COUNT(*) FROM units u WHERE u.property_id = p.id AND u.status = 'occupied') as occupied_count
  FROM properties p
`;

app.get("/api/properties", async (c) => {
  const rows = await query(
    `${PROPERTY_SELECT} ORDER BY CASE WHEN p.ref GLOB '[0-9]*' THEN CAST(p.ref AS INTEGER) ELSE 1000000 END, p.ref, p.name`,
  );
  return c.json({ properties: rows });
});

app.get("/api/properties/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${PROPERTY_SELECT} WHERE p.id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ property: row });
});

app.post("/api/properties", async (c) => {
  const parsed = await parseJson(c, PropertyInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const fields: Record<string, unknown> = {
    ...d,
    type: d.type ?? "flat",
    deal_type: d.deal_type ?? "owned",
    occupancy: d.occupancy ?? "occupied",
    color: d.color ?? "sky",
  };
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const result = await run(
    `INSERT INTO properties (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    cols.map((k) => fields[k] ?? null),
  );
  const row = await get(`${PROPERTY_SELECT} WHERE p.id = ?`, [result.lastInsertRowid]);
  return c.json({ property: row }, 201);
});

app.put("/api/properties/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, PropertyInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE properties SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${PROPERTY_SELECT} WHERE p.id = ?`, [id]);
  return c.json({ property: row });
});

app.delete("/api/properties/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM properties WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Units ──────────────────────────────────────────────────────────

const UnitInput = z.object({
  property_id: z.number().int(),
  name: z.string().min(1),
  bedrooms: z.number().min(0).optional(),
  bathrooms: z.number().min(0).optional(),
  sqft: z.number().int().optional().nullable(),
  market_rent: z.number().min(0).optional(),
  status: z.enum(["vacant", "occupied", "turnover", "unavailable"]).optional(),
  notes: z.string().optional().nullable(),
});

const UNIT_SELECT = `
  SELECT u.*,
    p.name as property_name,
    p.color as property_color,
    p.address as property_address,
    p.city as property_city,
    (SELECT l.id FROM leases l WHERE l.unit_id = u.id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) as active_lease_id,
    (SELECT t.first_name || ' ' || t.last_name FROM leases l LEFT JOIN tenants t ON t.id = l.primary_tenant_id WHERE l.unit_id = u.id AND l.status = 'active' ORDER BY l.start_date DESC LIMIT 1) as active_tenant_name
  FROM units u
  LEFT JOIN properties p ON p.id = u.property_id
`;

app.get("/api/units", async (c) => {
  const propertyId = intParam(c.req.query("property_id"));
  const status = c.req.query("status");
  const where: string[] = [];
  const params: unknown[] = [];
  if (propertyId) { where.push("u.property_id = ?"); params.push(propertyId); }
  if (status) { where.push("u.status = ?"); params.push(status); }
  const sql = `${UNIT_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY p.name, u.name`;
  const rows = await query(sql, params);
  return c.json({ units: rows });
});

app.get("/api/units/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ unit: row });
});

app.post("/api/units", async (c) => {
  const parsed = await parseJson(c, UnitInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO units (property_id, name, bedrooms, bathrooms, sqft, market_rent, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.property_id, d.name, d.bedrooms ?? 1, d.bathrooms ?? 1, d.sqft ?? null, d.market_rent ?? 0, d.status ?? "vacant", d.notes ?? null],
  );
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [result.lastInsertRowid]);
  return c.json({ unit: row }, 201);
});

app.put("/api/units/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, UnitInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE units SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${UNIT_SELECT} WHERE u.id = ?`, [id]);
  return c.json({ unit: row });
});

app.delete("/api/units/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM units WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Tenants ────────────────────────────────────────────────────────

const TenantInput = z.object({
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  date_of_birth: z.string().optional().nullable(),
  emergency_contact: z.string().optional().nullable(),
  employer: z.string().optional().nullable(),
  monthly_income: z.number().optional().nullable(),
  notes: z.string().optional().nullable(),
});

app.get("/api/tenants", async (c) => {
  const search = c.req.query("q")?.trim();
  if (search) {
    const like = `%${search}%`;
    const rows = await query(
      `SELECT t.*,
         (SELECT u.id FROM leases l LEFT JOIN units u ON u.id = l.unit_id
            WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_id,
         (SELECT u.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id
            WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_name,
         (SELECT p.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN properties p ON p.id = u.property_id
            WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_property_name
       FROM tenants t
       WHERE t.last_name LIKE ? OR t.first_name LIKE ? OR t.email LIKE ? OR t.phone LIKE ?
       ORDER BY t.last_name, t.first_name LIMIT 200`,
      [like, like, like, like],
    );
    return c.json({ tenants: rows });
  }
  const rows = await query(
    `SELECT t.*,
       (SELECT u.id FROM leases l LEFT JOIN units u ON u.id = l.unit_id
          WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_id,
       (SELECT u.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id
          WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_unit_name,
       (SELECT p.name FROM leases l LEFT JOIN units u ON u.id = l.unit_id LEFT JOIN properties p ON p.id = u.property_id
          WHERE l.primary_tenant_id = t.id AND l.status = 'active' LIMIT 1) as active_property_name
     FROM tenants t ORDER BY t.last_name, t.first_name LIMIT 500`,
  );
  return c.json({ tenants: rows });
});

app.get("/api/tenants/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get("SELECT * FROM tenants WHERE id = ?", [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ tenant: row });
});

app.post("/api/tenants", async (c) => {
  const parsed = await parseJson(c, TenantInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO tenants (first_name, last_name, email, phone, date_of_birth, emergency_contact, employer, monthly_income, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.first_name, d.last_name, d.email ?? null, d.phone ?? null, d.date_of_birth ?? null, d.emergency_contact ?? null, d.employer ?? null, d.monthly_income ?? null, d.notes ?? null],
  );
  const row = await get("SELECT * FROM tenants WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ tenant: row }, 201);
});

app.put("/api/tenants/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, TenantInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE tenants SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM tenants WHERE id = ?", [id]);
  return c.json({ tenant: row });
});

app.delete("/api/tenants/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM tenants WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Leases ─────────────────────────────────────────────────────────

const LeaseInput = z.object({
  unit_id: z.number().int(),
  primary_tenant_id: z.number().int().nullable().optional(),
  start_date: z.string(),
  end_date: z.string(),
  monthly_rent: z.number().min(0).optional(),
  deposit: z.number().min(0).optional(),
  rent_due_day: z.number().int().min(1).max(31).optional(),
  late_fee: z.number().min(0).optional(),
  status: z.enum(["upcoming", "active", "ended", "cancelled"]).optional(),
  notes: z.string().optional().nullable(),
});

const LEASE_SELECT = `
  SELECT l.*,
    u.name as unit_name,
    p.id as property_id, p.name as property_name, p.color as property_color,
    t.first_name as tenant_first_name, t.last_name as tenant_last_name,
    t.email as tenant_email, t.phone as tenant_phone
  FROM leases l
  LEFT JOIN units u ON u.id = l.unit_id
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN tenants t ON t.id = l.primary_tenant_id
`;

app.get("/api/leases", async (c) => {
  const status = c.req.query("status");
  const tenantId = intParam(c.req.query("tenant_id"));
  const unitId = intParam(c.req.query("unit_id"));
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) { where.push("l.status = ?"); params.push(status); }
  if (tenantId) { where.push("l.primary_tenant_id = ?"); params.push(tenantId); }
  if (unitId) { where.push("l.unit_id = ?"); params.push(unitId); }
  const sql = `${LEASE_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY l.start_date DESC`;
  const rows = await query(sql, params);
  return c.json({ leases: rows });
});

app.get("/api/leases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  return c.json({ lease: row });
});

app.post("/api/leases", async (c) => {
  const parsed = await parseJson(c, LeaseInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO leases (unit_id, primary_tenant_id, start_date, end_date, monthly_rent, deposit, rent_due_day, late_fee, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [d.unit_id, d.primary_tenant_id ?? null, d.start_date, d.end_date, d.monthly_rent ?? 0, d.deposit ?? 0, d.rent_due_day ?? 1, d.late_fee ?? 0, d.status ?? "active", d.notes ?? null],
  );
  // Mark the unit as occupied if the new lease is active.
  if ((d.status ?? "active") === "active") {
    await run("UPDATE units SET status = 'occupied' WHERE id = ?", [d.unit_id]);
  }
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [result.lastInsertRowid]);
  return c.json({ lease: row }, 201);
});

app.put("/api/leases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, LeaseInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE leases SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${LEASE_SELECT} WHERE l.id = ?`, [id]);
  return c.json({ lease: row });
});

app.delete("/api/leases/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM leases WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Rent charges & payments ────────────────────────────────────────

const ChargeInput = z.object({
  lease_id: z.number().int(),
  period: z.string().regex(/^\d{4}-\d{2}$/),
  due_date: z.string(),
  amount: z.number().min(0).optional(),
  notes: z.string().optional().nullable(),
});

const CHARGE_SELECT = `
  SELECT c.*,
    l.unit_id, l.monthly_rent as lease_rent, l.rent_due_day,
    u.name as unit_name,
    p.id as property_id, p.name as property_name, p.color as property_color,
    t.id as tenant_id, t.first_name as tenant_first_name, t.last_name as tenant_last_name
  FROM rent_charges c
  LEFT JOIN leases l ON l.id = c.lease_id
  LEFT JOIN units u ON u.id = l.unit_id
  LEFT JOIN properties p ON p.id = u.property_id
  LEFT JOIN tenants t ON t.id = l.primary_tenant_id
`;

app.get("/api/rent-charges", async (c) => {
  const period = c.req.query("period");
  const status = c.req.query("status");
  const where: string[] = [];
  const params: unknown[] = [];
  if (period) { where.push("c.period = ?"); params.push(period); }
  if (status) { where.push("c.status = ?"); params.push(status); }
  const sql = `${CHARGE_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY c.due_date, p.name, u.name`;
  const rows = await query(sql, params).catch(() => []);
  return c.json({ charges: rows });
});

app.post("/api/rent-charges", async (c) => {
  const parsed = await parseJson(c, ChargeInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO rent_charges (lease_id, period, due_date, amount, notes) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT(lease_id, period) DO NOTHING`,
    [d.lease_id, d.period, d.due_date, d.amount ?? 0, d.notes ?? null],
  );
  if (!result.changes) {
    const existing = await get(`${CHARGE_SELECT} WHERE c.lease_id = ? AND c.period = ?`, [d.lease_id, d.period]);
    return c.json({ charge: existing });
  }
  const row = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [result.lastInsertRowid]);
  return c.json({ charge: row }, 201);
});

// Generate (idempotent) charges for a given period across all active leases.
app.post("/api/rent-charges/generate", async (c) => {
  const body = await c.req.json().catch(() => ({})) as { period?: string };
  const period = body.period;
  if (!period || !/^\d{4}-\d{2}$/.test(period)) return c.json({ error: "period (YYYY-MM) required" }, 400);
  const leases = await query<{ id: number; monthly_rent: number; rent_due_day: number; start_date: string; end_date: string }>(
    "SELECT id, monthly_rent, rent_due_day, start_date, end_date FROM leases WHERE status = 'active'",
  );
  let created = 0;
  for (const l of leases) {
    // Skip if the lease doesn't cover this period at all.
    const periodStart = `${period}-01`;
    if (l.end_date < periodStart) continue;
    const day = String(Math.min(28, Math.max(1, l.rent_due_day))).padStart(2, "0");
    const dueDate = `${period}-${day}`;
    const r = await run(
      `INSERT INTO rent_charges (lease_id, period, due_date, amount) VALUES (?, ?, ?, ?)
         ON CONFLICT(lease_id, period) DO NOTHING`,
      [l.id, period, dueDate, l.monthly_rent],
    );
    if (r.changes) created++;
  }
  // Re-mark anything past due as 'overdue'.
  await run(
    `UPDATE rent_charges SET status = 'overdue'
     WHERE status IN ('open', 'partial') AND amount_paid < amount AND due_date < date('now')`,
  );
  return c.json({ created, period });
});

app.put("/api/rent-charges/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const Patch = z.object({
    amount: z.number().min(0).optional(),
    due_date: z.string().optional(),
    status: z.enum(["open", "partial", "paid", "overdue", "waived"]).optional(),
    notes: z.string().optional().nullable(),
  });
  const parsed = await parseJson(c, Patch);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE rent_charges SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [id]);
  return c.json({ charge: row });
});

app.delete("/api/rent-charges/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM rent_charges WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

const PaymentInput = z.object({
  charge_id: z.number().int(),
  paid_at: z.string().optional(),
  amount: z.number().min(0),
  method: z.enum(["bank_transfer", "standing_order", "cash", "card", "other"]).optional(),
  reference: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

app.get("/api/rent-charges/:id/payments", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query("SELECT * FROM payments WHERE charge_id = ? ORDER BY paid_at DESC", [id]);
  return c.json({ payments: rows });
});

app.post("/api/payments", async (c) => {
  const parsed = await parseJson(c, PaymentInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  await run(
    `INSERT INTO payments (charge_id, paid_at, amount, method, reference, notes)
     VALUES (?, COALESCE(?, datetime('now')), ?, ?, ?, ?)`,
    [d.charge_id, d.paid_at ?? null, d.amount, d.method ?? "bank_transfer", d.reference ?? null, d.notes ?? null],
  );
  // Recompute the charge's amount_paid + status.
  const charge = await get<{ amount: number }>("SELECT amount FROM rent_charges WHERE id = ?", [d.charge_id]);
  if (!charge) return c.json({ error: "Charge not found" }, 404);
  const sumRow = await get<{ total: number }>("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE charge_id = ?", [d.charge_id]);
  const paid = Number(sumRow?.total ?? 0);
  const status = paid >= charge.amount ? "paid" : paid > 0 ? "partial" : "open";
  await run("UPDATE rent_charges SET amount_paid = ?, status = ? WHERE id = ?", [paid, status, d.charge_id]);
  const updated = await get(`${CHARGE_SELECT} WHERE c.id = ?`, [d.charge_id]);
  return c.json({ charge: updated }, 201);
});

app.delete("/api/payments/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const row = await get<{ charge_id: number }>("SELECT charge_id FROM payments WHERE id = ?", [id]);
  if (!row) return c.json({ error: "Not found" }, 404);
  await run("DELETE FROM payments WHERE id = ?", [id]);
  // Recompute the charge.
  const sumRow = await get<{ total: number }>("SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE charge_id = ?", [row.charge_id]);
  const charge = await get<{ amount: number }>("SELECT amount FROM rent_charges WHERE id = ?", [row.charge_id]);
  const paid = Number(sumRow?.total ?? 0);
  const status = !charge ? "open" : paid >= charge.amount ? "paid" : paid > 0 ? "partial" : "open";
  await run("UPDATE rent_charges SET amount_paid = ?, status = ? WHERE id = ?", [paid, status, row.charge_id]);
  return c.json({ ok: true });
});

// ── Vendors ────────────────────────────────────────────────────────

const VendorInput = z.object({
  name: z.string().min(1),
  category: z.enum(["plumber", "electrician", "hvac", "handyman", "cleaning", "landscaping", "general"]).optional(),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  color: z.string().optional(),
});

app.get("/api/vendors", async (c) => {
  const rows = await query("SELECT * FROM vendors ORDER BY name");
  return c.json({ vendors: rows });
});

app.post("/api/vendors", async (c) => {
  const parsed = await parseJson(c, VendorInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    "INSERT INTO vendors (name, category, phone, email, notes, color) VALUES (?, ?, ?, ?, ?, ?)",
    [d.name, d.category ?? "general", d.phone ?? null, d.email ?? null, d.notes ?? null, d.color ?? "slate"],
  );
  const row = await get("SELECT * FROM vendors WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ vendor: row }, 201);
});

app.put("/api/vendors/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, VendorInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE vendors SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM vendors WHERE id = ?", [id]);
  return c.json({ vendor: row });
});

app.delete("/api/vendors/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM vendors WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Work orders ────────────────────────────────────────────────────

const WorkOrderInput = z.object({
  property_id: z.number().int().nullable().optional(),
  unit_id: z.number().int().nullable().optional(),
  tenant_id: z.number().int().nullable().optional(),
  vendor_id: z.number().int().nullable().optional(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]).optional(),
  status: z.enum(["open", "assigned", "in_progress", "completed", "cancelled"]).optional(),
  scheduled_at: z.string().optional().nullable(),
  completed_at: z.string().optional().nullable(),
  cost: z.number().min(0).optional().nullable(),
  notes: z.string().optional().nullable(),
});

const WO_SELECT = `
  SELECT w.*,
    p.name as property_name, p.color as property_color,
    u.name as unit_name,
    t.first_name as tenant_first_name, t.last_name as tenant_last_name,
    v.name as vendor_name, v.color as vendor_color
  FROM work_orders w
  LEFT JOIN properties p ON p.id = w.property_id
  LEFT JOIN units u ON u.id = w.unit_id
  LEFT JOIN tenants t ON t.id = w.tenant_id
  LEFT JOIN vendors v ON v.id = w.vendor_id
`;

app.get("/api/work-orders", async (c) => {
  const status = c.req.query("status");
  const propertyId = intParam(c.req.query("property_id"));
  const where: string[] = [];
  const params: unknown[] = [];
  if (status) { where.push("w.status = ?"); params.push(status); }
  if (propertyId) { where.push("w.property_id = ?"); params.push(propertyId); }
  const sql = `${WO_SELECT}${where.length ? " WHERE " + where.join(" AND ") : ""} ORDER BY
    CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END,
    w.created_at DESC`;
  const rows = await query(sql, params).catch(() => []);
  return c.json({ work_orders: rows });
});

app.post("/api/work-orders", async (c) => {
  const parsed = await parseJson(c, WorkOrderInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO work_orders (property_id, unit_id, tenant_id, vendor_id, title, description, priority, status, scheduled_at, completed_at, cost, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.property_id ?? null, d.unit_id ?? null, d.tenant_id ?? null, d.vendor_id ?? null,
      d.title, d.description ?? null,
      d.priority ?? "normal", d.status ?? "open",
      d.scheduled_at ?? null, d.completed_at ?? null,
      d.cost ?? null, d.notes ?? null,
    ],
  );
  const row = await get(`${WO_SELECT} WHERE w.id = ?`, [result.lastInsertRowid]);
  return c.json({ work_order: row }, 201);
});

app.put("/api/work-orders/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, WorkOrderInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE work_orders SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(`${WO_SELECT} WHERE w.id = ?`, [id]);
  return c.json({ work_order: row });
});

app.delete("/api/work-orders/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM work_orders WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Applications ───────────────────────────────────────────────────

const ApplicationInput = z.object({
  unit_id: z.number().int().nullable().optional(),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  monthly_income: z.number().optional().nullable(),
  employer: z.string().optional().nullable(),
  desired_move_in: z.string().optional().nullable(),
  status: z.enum(["new", "screening", "approved", "declined", "withdrawn"]).optional(),
  notes: z.string().optional().nullable(),
});

app.get("/api/applications", async (c) => {
  const rows = await query(
    `SELECT a.*, u.name as unit_name, p.name as property_name
     FROM applications a
     LEFT JOIN units u ON u.id = a.unit_id
     LEFT JOIN properties p ON p.id = u.property_id
     ORDER BY a.created_at DESC`,
  ).catch(() => []);
  return c.json({ applications: rows });
});

app.post("/api/applications", async (c) => {
  const parsed = await parseJson(c, ApplicationInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const d = parsed.data;
  const result = await run(
    `INSERT INTO applications (unit_id, first_name, last_name, email, phone, monthly_income, employer, desired_move_in, status, notes)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      d.unit_id ?? null, d.first_name, d.last_name,
      d.email ?? null, d.phone ?? null, d.monthly_income ?? null, d.employer ?? null,
      d.desired_move_in ?? null, d.status ?? "new", d.notes ?? null,
    ],
  );
  const row = await get(
    `SELECT a.*, u.name as unit_name, p.name as property_name
     FROM applications a LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN properties p ON p.id = u.property_id
     WHERE a.id = ?`,
    [result.lastInsertRowid],
  );
  return c.json({ application: row }, 201);
});

app.put("/api/applications/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, ApplicationInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE applications SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get(
    `SELECT a.*, u.name as unit_name, p.name as property_name
     FROM applications a LEFT JOIN units u ON u.id = a.unit_id LEFT JOIN properties p ON p.id = u.property_id
     WHERE a.id = ?`,
    [id],
  );
  return c.json({ application: row });
});

app.delete("/api/applications/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM applications WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Dashboard summary ──────────────────────────────────────────────

app.get("/api/dashboard/summary", async (c) => {
  const today = new Date().toISOString().slice(0, 10);
  const periodNow = today.slice(0, 7);

  const safeGet = <T,>(sql: string, params: unknown[] = [], fallback: T) =>
    get<T>(sql, params).catch(() => fallback as T | undefined).then((v) => v ?? fallback);
  const safeQuery = <T,>(sql: string, params: unknown[] = []): Promise<T[]> =>
    query<T>(sql, params).catch(() => [] as T[]);

  const [
    propertyCount,
    unitCount,
    occupiedCount,
    vacantCount,
    activeLeases,
    upcomingMoveOuts,
    monthOutstanding,
    monthCollected,
    overdueRow,
    openWorkOrders,
    urgentWorkOrders,
    recentWorkOrders,
    upcomingExpirations,
  ] = await Promise.all([
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM properties", [], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM units", [], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM units WHERE status = 'occupied'", [], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM units WHERE status = 'vacant'", [], { n: 0 }),
    safeGet<{ n: number }>("SELECT COUNT(*) as n FROM leases WHERE status = 'active'", [], { n: 0 }),
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM leases WHERE status = 'active' AND end_date <= date('now', '+30 days')",
      [], { n: 0 },
    ),
    safeGet<{ total: number }>(
      "SELECT COALESCE(SUM(amount - amount_paid), 0) as total FROM rent_charges WHERE period = ? AND status != 'waived'",
      [periodNow], { total: 0 },
    ),
    safeGet<{ total: number }>(
      "SELECT COALESCE(SUM(amount_paid), 0) as total FROM rent_charges WHERE period = ?",
      [periodNow], { total: 0 },
    ),
    safeGet<{ total: number; n: number }>(
      "SELECT COALESCE(SUM(amount - amount_paid), 0) as total, COUNT(*) as n FROM rent_charges WHERE due_date < date('now') AND amount_paid < amount AND status != 'waived'",
      [], { total: 0, n: 0 },
    ),
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM work_orders WHERE status NOT IN ('completed', 'cancelled')",
      [], { n: 0 },
    ),
    safeGet<{ n: number }>(
      "SELECT COUNT(*) as n FROM work_orders WHERE priority = 'urgent' AND status NOT IN ('completed', 'cancelled')",
      [], { n: 0 },
    ),
    safeQuery<{ id: number; title: string; priority: string; status: string; property_name: string | null; unit_name: string | null; created_at: string }>(
      `SELECT w.id, w.title, w.priority, w.status, p.name as property_name, u.name as unit_name, w.created_at
       FROM work_orders w
       LEFT JOIN properties p ON p.id = w.property_id
       LEFT JOIN units u ON u.id = w.unit_id
       WHERE w.status NOT IN ('completed', 'cancelled')
       ORDER BY CASE w.priority WHEN 'urgent' THEN 0 WHEN 'high' THEN 1 WHEN 'normal' THEN 2 ELSE 3 END, w.created_at DESC
       LIMIT 6`,
    ),
    safeQuery<{ id: number; end_date: string; tenant_first_name: string | null; tenant_last_name: string | null; unit_name: string | null; property_name: string | null }>(
      `SELECT l.id, l.end_date,
         t.first_name as tenant_first_name, t.last_name as tenant_last_name,
         u.name as unit_name, p.name as property_name
       FROM leases l
       LEFT JOIN tenants t ON t.id = l.primary_tenant_id
       LEFT JOIN units u ON u.id = l.unit_id
       LEFT JOIN properties p ON p.id = u.property_id
       WHERE l.status = 'active' AND l.end_date <= date('now', '+60 days')
       ORDER BY l.end_date ASC LIMIT 6`,
    ),
  ]);

  return c.json({
    period: periodNow,
    properties: propertyCount.n,
    units: unitCount.n,
    occupied: occupiedCount.n,
    vacant: vacantCount.n,
    occupancy_rate: unitCount.n ? Math.round((occupiedCount.n / unitCount.n) * 100) : 0,
    active_leases: activeLeases.n,
    upcoming_move_outs: upcomingMoveOuts.n,
    month_outstanding: monthOutstanding.total,
    month_collected: monthCollected.total,
    overdue_total: overdueRow.total,
    overdue_count: overdueRow.n,
    open_work_orders: openWorkOrders.n,
    urgent_work_orders: urgentWorkOrders.n,
    recent_work_orders: recentWorkOrders,
    upcoming_expirations: upcomingExpirations,
  });
});

// ── Settings (key/value) ───────────────────────────────────────────

app.get("/api/settings", async (c) => {
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings").catch(() => []);
  // Defaults first, so a caller always gets a currency and a due day even if
  // the seed has not run yet (a brand-new database, or a deleted row).
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: out });
});

app.put("/api/settings", async (c) => {
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ error: "Invalid JSON" }, 400); }
  if (!body || typeof body !== "object") return c.json({ error: "Body must be an object" }, 400);
  const entries = Object.entries(body as Record<string, unknown>).filter(([, v]) => v !== undefined && v !== null);
  // Shared send-from addresses decide who can send as whom: admins only.
  if (entries.some(([k]) => k === "sender_emails") && getUser(c).role !== "admin") {
    const current = await get<{ value: string }>("SELECT value FROM settings WHERE key = 'sender_emails'");
    const incoming = String((body as Record<string, unknown>).sender_emails ?? "");
    if ((current?.value ?? "") !== incoming) return c.json({ error: "Only admins can change the shared send-from addresses." }, 403);
  }
  for (const [key, value] of entries) {
    await run(
      `INSERT INTO settings (key, value, updated_at) VALUES (?, ?, datetime('now'))
       ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = datetime('now')`,
      [key, String(value)],
    );
  }
  const rows = await query<{ key: string; value: string }>("SELECT key, value FROM settings");
  const out: Record<string, string> = { ...DEFAULT_SETTINGS };
  for (const r of rows) out[r.key] = r.value;
  return c.json({ settings: out });
});

// ── Rooms (from the sheet's Tenants tab) ──────────────────────────

app.get("/api/properties/:id/rooms", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const rows = await query("SELECT * FROM rooms WHERE property_id = ? ORDER BY sort, id", [id]).catch(() => []);
  return c.json({ rooms: rows });
});

// ── Calendar: money in, money out, certificates due ────────────────

const CERT_LABELS: Record<string, string> = {
  gas_expiry: "Gas safety",
  epc_expiry: "EPC",
  eicr_expiry: "EICR",
  licence_expiry: "Licence",
  insurance_expiry: "Insurance",
};

app.get("/api/calendar", async (c) => {
  const month = c.req.query("month") ?? new Date().toISOString().slice(0, 7);
  if (!/^\d{4}-\d{2}$/.test(month)) return c.json({ error: "month must be YYYY-MM" }, 400);
  const [y, m] = month.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const iso = (d: number) => `${month}-${String(Math.min(d, daysInMonth)).padStart(2, "0")}`;

  type P = {
    id: number; ref: string | null; name: string; deal_type: string; section: string; occupancy: string;
    rent_in: number; rent_out: number; rent_in_day: number | null; payment_out_day: number | null; tenant_label: string | null;
    gas_expiry: string | null; epc_expiry: string | null; eicr_expiry: string | null; licence_expiry: string | null; insurance_expiry: string | null;
  };
  type R = { property_id: number; room: string | null; tenant_name: string | null; rent: number; pay_day: number | null; rent_status: string | null; end_date: string | null };
  const props = await query<P>("SELECT * FROM properties").catch(() => [] as P[]);
  const rooms = await query<R>("SELECT * FROM rooms").catch(() => [] as R[]);
  const roomsBy = new Map<number, R[]>();
  for (const r of rooms) roomsBy.set(r.property_id, [...(roomsBy.get(r.property_id) ?? []), r]);

  type Ev = { date: string; kind: "in" | "out" | "compliance" | "tenancy"; amount?: number; title: string; detail: string; property_id: number; ref: string | null; status?: string };
  const events: Ev[] = [];

  for (const p of props) {
    const paying = (roomsBy.get(p.id) ?? []).filter((r) => r.rent > 0 && r.rent_status !== "empty");
    if (paying.length) {
      // Room by room for shared houses: each tenant on the day they pay.
      for (const r of paying) {
        const d = r.pay_day ?? p.rent_in_day;
        if (!d) continue;
        events.push({ date: iso(d), kind: "in", amount: r.rent, title: p.name, detail: [r.room, r.tenant_name].filter(Boolean).join(" · "), property_id: p.id, ref: p.ref, status: r.rent_status ?? undefined });
      }
    } else if (p.rent_in && p.rent_in_day && p.occupancy !== "vacant") {
      events.push({ date: iso(p.rent_in_day), kind: "in", amount: p.rent_in, title: p.name, detail: p.tenant_label || "Rent", property_id: p.id, ref: p.ref });
    }
    if (p.rent_out && p.payment_out_day) {
      const what = p.deal_type === "rent_to_rent" ? "Rent to landlord" : p.deal_type === "ground_rent" ? "Ground rent" : "Mortgage";
      events.push({ date: iso(p.payment_out_day), kind: "out", amount: p.rent_out, title: p.name, detail: what, property_id: p.id, ref: p.ref });
    }
    for (const [key, label] of Object.entries(CERT_LABELS)) {
      const d = p[key as keyof P] as string | null;
      if (d && d.startsWith(month)) {
        events.push({ date: d, kind: "compliance", title: p.name, detail: `${label} expires`, property_id: p.id, ref: p.ref });
      }
    }
    for (const r of roomsBy.get(p.id) ?? []) {
      if (r.end_date && r.end_date.startsWith(month)) {
        events.push({ date: r.end_date, kind: "tenancy", title: p.name, detail: `Tenancy ends · ${[r.room, r.tenant_name].filter(Boolean).join(" · ")}`, property_id: p.id, ref: p.ref });
      }
    }
  }
  events.sort((a, b) => a.date.localeCompare(b.date) || a.kind.localeCompare(b.kind));

  // Certificates expired or due in the next 60 days, whatever month is shown.
  const today = new Date().toISOString().slice(0, 10);
  const horizon = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const due: { date: string; title: string; detail: string; property_id: number; ref: string | null; expired: boolean }[] = [];
  let missing = 0;
  for (const p of props) {
    let any = false;
    for (const [key, label] of Object.entries(CERT_LABELS)) {
      const d = p[key as keyof P] as string | null;
      if (!d) continue;
      any = true;
      if (d <= horizon) due.push({ date: d, title: p.name, detail: label, property_id: p.id, ref: p.ref, expired: d < today });
    }
    if (!any) missing++;
  }
  due.sort((a, b) => a.date.localeCompare(b.date));

  const sum = (k: Ev["kind"]) => events.filter((e) => e.kind === k).reduce((a, e) => a + (e.amount ?? 0), 0);
  return c.json({ month, days_in_month: daysInMonth, events, totals: { in: sum("in"), out: sum("out") }, compliance_due: due, compliance_missing: missing });
});

// ── Portfolio summary (the spreadsheet's Summary tab) ──────────────

app.get("/api/portfolio/summary", async (c) => {
  type Row = {
    id: number; ref: string | null; name: string; address: string | null; owner: string | null;
    deal_type: string; section: string; occupancy: string; rent_in: number; rent_out: number; other_costs: number;
    rent_in_day: number | null; payment_out_day: number | null;
    rent_status: string | null; months_arrears: number; arrears_amount: number;
    gas_expiry: string | null; epc_expiry: string | null; eicr_expiry: string | null;
    licence_expiry: string | null; insurance_expiry: string | null; tenant_label: string | null;
    ground_rent_paid: number; service_charge_paid: number; ground_rent_received: number; service_charge_received: number;
  };
  const rows = await query<Row>(
    `SELECT id, ref, name, address, owner, deal_type, section, occupancy, rent_in, rent_out, other_costs,
            rent_in_day, payment_out_day, rent_status, months_arrears, arrears_amount,
            gas_expiry, epc_expiry, eicr_expiry, licence_expiry, insurance_expiry, tenant_label,
            ground_rent_paid, service_charge_paid, ground_rent_received, service_charge_received
     FROM properties`,
  ).catch(() => [] as Row[]);

  const today = new Date().toISOString().slice(0, 10);
  const in60 = new Date(Date.now() + 60 * 86_400_000).toISOString().slice(0, 10);
  const certs = ["gas_expiry", "epc_expiry", "eicr_expiry", "licence_expiry", "insurance_expiry"] as const;

  const sum = (xs: Row[], f: (r: Row) => number) => xs.reduce((a, r) => a + (Number(f(r)) || 0), 0);
  /** Ground rent and service charge, received minus paid, as a monthly figure. */
  const leaseNet = (r: Row) =>
    ((r.ground_rent_received || 0) + (r.service_charge_received || 0) - (r.ground_rent_paid || 0) - (r.service_charge_paid || 0)) / 12;
  const group = (key: (r: Row) => string) => {
    const m = new Map<string, Row[]>();
    for (const r of rows) {
      const k = key(r);
      m.set(k, [...(m.get(k) ?? []), r]);
    }
    return [...m.entries()]
      .map(([k, xs]) => ({
        key: k,
        count: xs.length,
        rent_in: sum(xs, (r) => r.rent_in),
        rent_out: sum(xs, (r) => r.rent_out),
        costs: sum(xs, (r) => r.other_costs),
        net: sum(xs, (r) => r.rent_in - r.rent_out - r.other_costs + leaseNet(r)),
        arrears: sum(xs, (r) => r.arrears_amount),
      }))
      .sort((a, b) => b.rent_in - a.rent_in);
  };

  let expired = 0;
  let dueSoon = 0;
  let missing = 0;
  for (const r of rows) {
    const dates = certs.map((k) => r[k]).filter((d): d is string => !!d);
    if (dates.length === 0) { missing++; continue; }
    const next = dates.sort()[0];
    if (next < today) expired++;
    else if (next <= in60) dueSoon++;
  }

  const days = Array.from({ length: 31 }, (_, i) => ({ day: i + 1, money_in: 0, money_out: 0 }));
  for (const r of rows) {
    if (r.rent_in_day && r.rent_in) days[r.rent_in_day - 1].money_in += r.rent_in;
    if (r.payment_out_day && r.rent_out) days[r.payment_out_day - 1].money_out += r.rent_out;
  }

  const arrears = rows
    .filter((r) => r.rent_status === "in_arrears" || r.arrears_amount > 0)
    .sort((a, b) => b.arrears_amount - a.arrears_amount)
    .map((r) => ({ id: r.id, ref: r.ref, name: r.name, owner: r.owner, tenant_label: r.tenant_label, months_arrears: r.months_arrears, arrears_amount: r.arrears_amount }));

  const attention = rows
    .filter((r) => r.occupancy === "vacant" || r.occupancy === "eviction")
    .map((r) => ({ id: r.id, ref: r.ref, name: r.name, owner: r.owner, occupancy: r.occupancy }));

  return c.json({
    properties: rows.length,
    occupied: rows.filter((r) => r.occupancy === "occupied" || r.occupancy === "part_occupied").length,
    vacant: rows.filter((r) => r.occupancy === "vacant").length,
    eviction: rows.filter((r) => r.occupancy === "eviction").length,
    rent_in: sum(rows, (r) => r.rent_in),
    rent_out: sum(rows, (r) => r.rent_out),
    other_costs: sum(rows, (r) => r.other_costs),
    net: sum(rows, (r) => r.rent_in - r.rent_out - r.other_costs + leaseNet(r)),
    leasehold: {
      ground_rent_paid: sum(rows, (r) => r.ground_rent_paid),
      service_charge_paid: sum(rows, (r) => r.service_charge_paid),
      ground_rent_received: sum(rows, (r) => r.ground_rent_received),
      service_charge_received: sum(rows, (r) => r.service_charge_received),
    },
    costs_missing: rows.filter((r) => r.deal_type !== "ground_rent" && !r.rent_out && !r.other_costs && !r.ground_rent_paid && !r.service_charge_paid).length,
    arrears_total: sum(rows, (r) => r.arrears_amount),
    arrears_count: arrears.length,
    compliance: { expired, due_soon: dueSoon, missing },
    by_owner: group((r) => r.owner || "Unassigned"),
    by_deal: group((r) => r.deal_type),
    by_section: group((r) => r.section || "owned"),
    cashflow_days: days,
    arrears,
    attention,
  });
});

// ── Sales leads ────────────────────────────────────────────────────

const LEAD_STATUS = ["new", "contacted", "viewing", "offer_made", "under_offer", "completed", "withdrawn"] as const;

const LeadInput = z.object({
  landlord_name: z.string().min(1),
  phone: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  location: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  postcode: z.string().optional().nullable(),
  property_type: z.string().optional().nullable(),
  bedrooms: z.number().int().min(0).optional().nullable(),
  bathrooms: z.number().int().min(0).optional().nullable(),
  tenure: z.string().optional().nullable(),
  asking_price: z.number().min(0).optional().nullable(),
  estimated_value: z.number().min(0).optional().nullable(),
  offer_amount: z.number().min(0).optional().nullable(),
  buyer_agent: z.string().optional().nullable(),
  solicitor: z.string().optional().nullable(),
  status: z.enum(LEAD_STATUS).optional(),
  next_action: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

app.get("/api/sales-leads", async (c) => {
  const rows = await query(
    `SELECT * FROM sales_leads ORDER BY
       CASE status WHEN 'under_offer' THEN 0 WHEN 'offer_made' THEN 1 WHEN 'viewing' THEN 2
         WHEN 'contacted' THEN 3 WHEN 'new' THEN 4 WHEN 'completed' THEN 5 ELSE 6 END,
       landlord_name`,
  ).catch(() => []);
  return c.json({ leads: rows });
});

app.post("/api/sales-leads", async (c) => {
  const parsed = await parseJson(c, LeadInput);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const fields: Record<string, unknown> = { ...parsed.data, status: parsed.data.status ?? "new" };
  const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
  const result = await run(
    `INSERT INTO sales_leads (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
    cols.map((k) => fields[k] ?? null),
  );
  const row = await get("SELECT * FROM sales_leads WHERE id = ?", [result.lastInsertRowid]);
  return c.json({ lead: row }, 201);
});

app.put("/api/sales-leads/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const parsed = await parseJson(c, LeadInput.partial());
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { sets, params } = buildUpdate(parsed.data);
  if (!sets.length) return c.json({ error: "No fields" }, 400);
  params.push(id);
  const r = await run(`UPDATE sales_leads SET ${sets.join(", ")} WHERE id = ?`, params);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  const row = await get("SELECT * FROM sales_leads WHERE id = ?", [id]);
  return c.json({ lead: row });
});

app.delete("/api/sales-leads/:id", async (c) => {
  const id = intParam(c.req.param("id"));
  if (!id) return c.json({ error: "Invalid ID" }, 400);
  const r = await run("DELETE FROM sales_leads WHERE id = ?", [id]);
  if (!r.changes) return c.json({ error: "Not found" }, 404);
  return c.json({ ok: true });
});

// ── Bulk import ────────────────────────────────────────────────────
// Loads a whole portfolio in one request (behind the login, like everything
// else). scripts/import-sheet.mjs turns a spreadsheet export into this shape.
// With replace: true the existing properties and leads are cleared first.

app.post("/api/import", async (c) => {
  const Body = z.object({
    replace: z.boolean().optional(),
    properties: z.array(PropertyInput).optional(),
    leads: z.array(LeadInput).optional(),
  });
  const parsed = await parseJson(c, Body);
  if (!parsed.ok) return c.json({ error: parsed.error }, 400);
  const { replace, properties = [], leads = [] } = parsed.data;

  if (replace) {
    if (properties.length) await run("DELETE FROM properties");
    if (leads.length) await run("DELETE FROM sales_leads");
  }

  const insert = async (table: string, fields: Record<string, unknown>) => {
    const cols = Object.keys(fields).filter((k) => fields[k] !== undefined);
    return run(
      `INSERT INTO ${table} (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => fields[k] ?? null),
    );
  };

  for (const p of properties) {
    const r = await insert("properties", {
      ...p,
      type: p.type ?? "flat",
      deal_type: p.deal_type ?? "owned",
      occupancy: p.occupancy ?? "occupied",
      color: p.color ?? "sky",
    });
    // One unit per home, so the leases and rent ledger have somewhere to hang.
    await run(
      "INSERT INTO units (property_id, name, bedrooms, bathrooms, market_rent, status) VALUES (?, ?, ?, 1, ?, ?)",
      [r.lastInsertRowid, "Whole property", p.bedrooms ?? 1, p.rent_in ?? 0, p.occupancy === "vacant" ? "vacant" : "occupied"],
    );
  }
  for (const l of leads) await insert("sales_leads", { ...l, status: l.status ?? "new" });

  return c.json({ ok: true, properties: properties.length, leads: leads.length });
});

// ── Google Sheet sync ──────────────────────────────────────────────

app.get("/api/sync", (c) => c.json(syncStatus(c.env)));

app.post("/api/sync", async (c) => {
  try {
    return c.json(await runSync(c.env));
  } catch (err) {
    return c.json({ ...syncStatus(c.env), error: (err as Error).message }, 502);
  }
});

registerInvoiceRoutes(app);
registerAssistantRoutes(app);
registerMailRoutes(app);
registerDocumentRoutes(app);

// ── Health ─────────────────────────────────────────────────────────

app.get("/api/health", (c) => c.json({ ok: true }));

app.all("/api/*", (c) => c.json({ error: "Not found" }, 404));

// ── The React app ──────────────────────────────────────────────────
// Everything else is the built front end. The Worker runs first for every
// request (wrangler.toml → run_worker_first) so the login above covers the
// pages too; unknown paths fall back to index.html for client-side routing.
app.get("*", async (c) => {
  if (!c.env.ASSETS) return c.notFound();
  return c.env.ASSETS.fetch(c.req.raw);
});

export default app;
