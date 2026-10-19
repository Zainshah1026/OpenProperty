-- ── People who can sign in ───────────────────────────────────────
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name TEXT NOT NULL,
  password_hash TEXT NOT NULL,                 -- pbkdf2$iterations$salt$hash
  role TEXT NOT NULL DEFAULT 'member',         -- 'admin' | 'member'
  mailboxes TEXT NOT NULL DEFAULT '[]',        -- JSON list of addresses this person may read
  pw_version INTEGER NOT NULL DEFAULT 1,       -- bumped on password change: signs out old sessions
  active INTEGER NOT NULL DEFAULT 1,
  last_login TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Settings (key/value) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Defaults live in the app (DEFAULT_SETTINGS in src/server/index.ts): a
-- deploy applies DDL only, so a seed row here fails the whole build.

-- ── Properties ───────────────────────────────────────────────────
-- One row per home. Alongside the address it carries the portfolio view a UK
-- landlord runs from a spreadsheet: who owns it, the deal type, rent in and
-- out, arrears, and the five compliance certificates.
CREATE TABLE IF NOT EXISTS properties (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ref TEXT,                                    -- your own reference, e.g. '27'
  name TEXT NOT NULL,                          -- short label, usually the first line of the address
  type TEXT NOT NULL DEFAULT 'flat',           -- 'flat' | 'maisonette' | 'terraced' | 'semi_detached' | 'detached' | 'bungalow' | 'commercial' | 'other'
  address TEXT,
  city TEXT,                                   -- town / area
  state TEXT,                                  -- county
  zip TEXT,                                    -- postcode
  year_built INTEGER,
  owner TEXT,                                  -- owning company or person; for rent to rent, the landlord you rent from
  deal_type TEXT NOT NULL DEFAULT 'owned',     -- 'owned' | 'joint_venture' | 'rent_to_rent' | 'ground_rent'
  section TEXT NOT NULL DEFAULT 'owned',
  tenure TEXT,                                 -- 'freehold' | 'leasehold' | 'share_of_freehold'       -- 'owned' (ours, incl. joint ventures) | 'managed' (rent to rent: we manage, don't own)
  bedrooms INTEGER,
  hmo INTEGER NOT NULL DEFAULT 0,              -- 1 if licensed / run as an HMO
  occupancy TEXT NOT NULL DEFAULT 'occupied',  -- 'occupied' | 'part_occupied' | 'vacant' | 'eviction'
  tenant_label TEXT,                           -- tenant or letting agent, as free text
  tenant_email TEXT,                           -- where rent invoices go
  energy TEXT,                                 -- 'all_electric' | 'gas_electric' (no gas cert needed if all electric)
  rent_in REAL NOT NULL DEFAULT 0,             -- monthly rent received
  rent_out REAL NOT NULL DEFAULT 0,            -- monthly rent or mortgage paid out
  other_costs REAL NOT NULL DEFAULT 0,         -- council tax, utilities, insurance, licences (monthly)
  ground_rent_paid REAL NOT NULL DEFAULT 0,    -- per year, to the freeholder
  service_charge_paid REAL NOT NULL DEFAULT 0, -- per year, to the freeholder / managing agent
  ground_rent_received REAL NOT NULL DEFAULT 0,    -- per year, from leaseholders (freeholds we own)
  service_charge_received REAL NOT NULL DEFAULT 0, -- per year, from leaseholders
  rent_in_day INTEGER,                         -- day of month rent arrives (1–31)
  payment_out_day INTEGER,                     -- day of month the rent / mortgage leaves (1–31)
  rent_status TEXT,                            -- 'on_time' | 'in_arrears' | 'in_advance' | 'ground_rent'
  months_arrears REAL NOT NULL DEFAULT 0,
  arrears_amount REAL NOT NULL DEFAULT 0,
  gas_expiry TEXT,                             -- 'YYYY-MM-DD'
  epc_expiry TEXT,
  eicr_expiry TEXT,
  licence_expiry TEXT,
  insurance_expiry TEXT,
  notes TEXT,
  color TEXT NOT NULL DEFAULT 'sky',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_properties_owner ON properties(owner);
CREATE INDEX IF NOT EXISTS idx_properties_deal ON properties(deal_type);

-- ── Rooms (one per tenant in HMOs and shared houses) ─────────────
CREATE TABLE IF NOT EXISTS rooms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room TEXT,                                   -- 'Room 1', 'Top floor'
  tenant_name TEXT,
  tenant_email TEXT,                           -- where rent invoices go
  rent REAL NOT NULL DEFAULT 0,                -- monthly rent this tenant pays
  pay_day INTEGER,                             -- day of month they pay (1–31)
  rent_status TEXT,                            -- 'on_time' | 'in_arrears' | 'empty'
  start_date TEXT,                             -- 'YYYY-MM-DD'
  end_date TEXT,
  notes TEXT,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_rooms_property ON rooms(property_id);

-- ── Units (rentable spaces inside a property) ────────────────────
CREATE TABLE IF NOT EXISTS units (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  name TEXT NOT NULL,                          -- e.g. 'Unit 1A', '308', 'Main house'
  bedrooms REAL NOT NULL DEFAULT 1,            -- studio = 0, allows half-beds (rare)
  bathrooms REAL NOT NULL DEFAULT 1,           -- allows half-baths (1.5)
  sqft INTEGER,
  market_rent REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'vacant',       -- 'vacant' | 'occupied' | 'turnover' | 'unavailable'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_units_property ON units(property_id);
CREATE INDEX IF NOT EXISTS idx_units_status ON units(status);

-- ── Tenants ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS tenants (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  date_of_birth TEXT,
  emergency_contact TEXT,
  employer TEXT,
  monthly_income REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_tenants_name ON tenants(last_name, first_name);

-- ── Leases ───────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS leases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER NOT NULL REFERENCES units(id) ON DELETE CASCADE,
  primary_tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  start_date TEXT NOT NULL,                    -- 'YYYY-MM-DD'
  end_date TEXT NOT NULL,
  monthly_rent REAL NOT NULL DEFAULT 0,
  deposit REAL NOT NULL DEFAULT 0,
  rent_due_day INTEGER NOT NULL DEFAULT 1,
  late_fee REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',       -- 'upcoming' | 'active' | 'ended' | 'cancelled'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leases_unit ON leases(unit_id);
CREATE INDEX IF NOT EXISTS idx_leases_tenant ON leases(primary_tenant_id);
CREATE INDEX IF NOT EXISTS idx_leases_status ON leases(status);

-- Multi-tenant leases (occupants beyond the primary).
CREATE TABLE IF NOT EXISTS lease_tenants (
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (lease_id, tenant_id)
);

-- ── Rent charges (one per period per lease) ──────────────────────
CREATE TABLE IF NOT EXISTS rent_charges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lease_id INTEGER NOT NULL REFERENCES leases(id) ON DELETE CASCADE,
  period TEXT NOT NULL,                        -- 'YYYY-MM' (e.g. '2026-04')
  due_date TEXT NOT NULL,                      -- 'YYYY-MM-DD'
  amount REAL NOT NULL DEFAULT 0,
  amount_paid REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'open',         -- 'open' | 'partial' | 'paid' | 'overdue' | 'waived'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_charges_lease_period ON rent_charges(lease_id, period);
CREATE INDEX IF NOT EXISTS idx_charges_due ON rent_charges(due_date);
CREATE INDEX IF NOT EXISTS idx_charges_status ON rent_charges(status);

-- ── Payments (applied to a charge) ───────────────────────────────
CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  charge_id INTEGER NOT NULL REFERENCES rent_charges(id) ON DELETE CASCADE,
  paid_at TEXT NOT NULL DEFAULT (datetime('now')),
  amount REAL NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'bank_transfer', -- 'bank_transfer' | 'standing_order' | 'cash' | 'card' | 'other'
  reference TEXT,                              -- check number, transaction ID, etc.
  notes TEXT
);

CREATE INDEX IF NOT EXISTS idx_payments_charge ON payments(charge_id);

-- ── Vendors ──────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS vendors (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',    -- 'plumber' | 'electrician' | 'hvac' (gas & heating) | 'handyman' | 'cleaning' | 'landscaping' | 'general'
  phone TEXT,
  email TEXT,
  notes TEXT,
  color TEXT NOT NULL DEFAULT 'slate',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Work orders (maintenance) ────────────────────────────────────
CREATE TABLE IF NOT EXISTS work_orders (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,  -- who reported it
  vendor_id INTEGER REFERENCES vendors(id) ON DELETE SET NULL,
  title TEXT NOT NULL,
  description TEXT,
  priority TEXT NOT NULL DEFAULT 'normal',     -- 'low' | 'normal' | 'high' | 'urgent'
  status TEXT NOT NULL DEFAULT 'open',         -- 'open' | 'assigned' | 'in_progress' | 'completed' | 'cancelled'
  scheduled_at TEXT,
  completed_at TEXT,
  cost REAL,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_wo_status ON work_orders(status);
CREATE INDEX IF NOT EXISTS idx_wo_property ON work_orders(property_id);
CREATE INDEX IF NOT EXISTS idx_wo_unit ON work_orders(unit_id);

-- ── Applications (manual record only — no public submission) ─────
CREATE TABLE IF NOT EXISTS applications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  unit_id INTEGER REFERENCES units(id) ON DELETE SET NULL,
  first_name TEXT NOT NULL,
  last_name TEXT NOT NULL,
  email TEXT,
  phone TEXT,
  monthly_income REAL,
  employer TEXT,
  desired_move_in TEXT,
  status TEXT NOT NULL DEFAULT 'new',          -- 'new' | 'screening' | 'approved' | 'declined' | 'withdrawn'
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_applications_status ON applications(status);

-- ── Invoices ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  number TEXT NOT NULL,                        -- 'CC-0001'
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  bill_to_name TEXT NOT NULL,
  bill_to_email TEXT,
  bill_to_address TEXT,
  issue_date TEXT NOT NULL,                    -- 'YYYY-MM-DD'
  due_date TEXT NOT NULL,
  items TEXT NOT NULL DEFAULT '[]',            -- JSON: [{"description": "...", "amount": 1200}]
  notes TEXT,
  status TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'sent' | 'paid' | 'void'
  sent_at TEXT,
  sent_to TEXT,
  sent_from TEXT,
  paid_at TEXT,
  created_by TEXT,                             -- 'you' | 'assistant'
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);

-- A room (named as on the sheet's Tenants tab) linked to a tenant from the
-- app's Tenants list. Keyed by name because the sync rebuilds rooms.
CREATE TABLE IF NOT EXISTS room_tenants (
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room TEXT NOT NULL,                          -- lower-cased room name
  tenant_id INTEGER NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  PRIMARY KEY (property_id, room)
);

-- What the sheet said for each property field at the last sync, so a change
-- made in the app is only replaced when the sheet itself changes.
CREATE TABLE IF NOT EXISTS sheet_seen (
  prop_key TEXT NOT NULL,                      -- 'ref:15' or 'addr:…'
  field TEXT NOT NULL,
  value TEXT,
  PRIMARY KEY (prop_key, field)
);

-- ── Compliance documents (files on disk; see src/server/documents.ts) ──
CREATE TABLE IF NOT EXISTS compliance_documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  kind TEXT NOT NULL,                          -- 'gas' | 'eicr' | 'epc' | 'licence' | 'insurance' | 'other'
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0,
  stored_name TEXT NOT NULL,                   -- random name on disk
  expiry_date TEXT,
  label TEXT,                                  -- e.g. the tenant for a check-in report
  taken_on TEXT,                               -- date the photos / report were taken
  work_order_id INTEGER,                       -- photos sent with a repair request
  uploaded_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_documents_property ON compliance_documents(property_id);

-- ── Keys and access (signed-in users only; never in the sheet) ──
CREATE TABLE IF NOT EXISTS property_access (
  property_id INTEGER PRIMARY KEY REFERENCES properties(id) ON DELETE CASCADE,
  key_safe_location TEXT,
  key_safe_code TEXT,
  keys_held_by TEXT,
  alarm_code TEXT,
  access_notes TEXT,
  updated_by TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Empty periods, for a whole home or one room (room = NULL for the home) ──
CREATE TABLE IF NOT EXISTS voids (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  property_id INTEGER NOT NULL REFERENCES properties(id) ON DELETE CASCADE,
  room TEXT,
  start_date TEXT NOT NULL,                    -- 'YYYY-MM-DD'
  end_date TEXT,                               -- NULL while still empty
  monthly_rent REAL NOT NULL DEFAULT 0,        -- the rent it would earn, for lost-rent figures
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_voids_property ON voids(property_id);

-- Rent invoices already drafted automatically, one per rent per month, so a
-- deleted draft is not recreated (see src/server/rent-invoices.ts).
CREATE TABLE IF NOT EXISTS rent_invoice_log (
  key TEXT PRIMARY KEY,                        -- 'rent:ref:12:room:room 2:2026-11'
  invoice_id INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- ── Sales leads ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS sales_leads (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  landlord_name TEXT NOT NULL,
  phone TEXT,
  email TEXT,
  location TEXT,
  address TEXT,
  postcode TEXT,
  property_type TEXT,
  bedrooms INTEGER,
  bathrooms INTEGER,
  tenure TEXT,                                 -- 'Freehold' | 'Leasehold' | 'Share of Freehold'
  asking_price REAL,
  estimated_value REAL,
  offer_amount REAL,
  buyer_agent TEXT,
  solicitor TEXT,
  status TEXT NOT NULL DEFAULT 'new',          -- 'new' | 'contacted' | 'viewing' | 'offer_made' | 'under_offer' | 'completed' | 'withdrawn'
  next_action TEXT,
  notes TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_leads_status ON sales_leads(status);

-- Demo data is seeded by the app on first read (ensureSeeded in
-- src/server/index.ts), never here: this file is applied as DDL only.

-- ── Letters & contracts ────────────────────────────────────────────
-- Letters, notices and tenancy agreements made from templates (the text is
-- kept, editable, as HTML) and signed copies uploaded against them.
CREATE TABLE IF NOT EXISTS letters (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template TEXT NOT NULL,                      -- template id, or 'upload' for a document made elsewhere
  category TEXT NOT NULL,                      -- 'tenancy' | 'company' | 'arrears'
  title TEXT NOT NULL,
  property_id INTEGER REFERENCES properties(id) ON DELETE SET NULL,
  tenant_id INTEGER REFERENCES tenants(id) ON DELETE SET NULL,
  room TEXT,
  body TEXT,                                   -- the letter itself (HTML)
  fields TEXT,                                 -- JSON of the answers used to fill it
  status TEXT NOT NULL DEFAULT 'draft',        -- 'draft' | 'sent' | 'signed' | 'void'
  sent_on TEXT,
  signed_on TEXT,
  created_by TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_letters_property ON letters(property_id);
CREATE INDEX IF NOT EXISTS idx_letters_tenant ON letters(tenant_id);
