// ── Core entities ──────────────────────────────────────────────────

export type PropertyType = "flat" | "maisonette" | "terraced" | "semi_detached" | "detached" | "bungalow" | "commercial" | "other";
export type DealType = "owned" | "joint_venture" | "rent_to_rent" | "managed" | "ground_rent";
export type Occupancy = "occupied" | "part_occupied" | "vacant" | "eviction";
/** in_arrears = paid a set time late by agreement; missed = rent not paid (owed). */
export type RentStatus = "on_time" | "in_arrears" | "missed" | "in_advance" | "ground_rent";

export interface Property {
  id: number;
  ref: string | null;
  name: string;
  type: PropertyType;
  address: string | null;
  city: string | null;
  state: string | null;
  zip: string | null;
  year_built: number | null;
  owner: string | null;
  deal_type: DealType;
  section: "owned" | "managed";
  tenure: "freehold" | "leasehold" | "share_of_freehold" | "freehold_and_leasehold" | null;
  bedrooms: number | null;
  hmo: number;
  occupancy: Occupancy;
  tenant_label: string | null;
  energy?: "all_electric" | "gas_electric" | null;
  tenant_id?: number | null;
  tenant_name?: string | null;
  ownership_share?: number | null;
  market_value?: number | null;
  mortgage_balance?: number | null;
  lender?: string | null;
  lease_end?: string | null;
  lease_years?: number | null;
  fixed_rate_end?: string | null;
  rent_in: number;
  rent_out: number;
  other_costs: number;
  ground_rent_paid: number;
  service_charge_paid: number;
  ground_rent_received: number;
  service_charge_received: number;
  rent_in_day: number | null;
  payment_out_day: number | null;
  rent_status: RentStatus | null;
  months_arrears: number;
  arrears_amount: number;
  gas_expiry: string | null;
  epc_expiry: string | null;
  eicr_expiry: string | null;
  licence_expiry: string | null;
  insurance_expiry: string | null;
  notes: string | null;
  color: string;
  created_at: string;
  // Computed / joined
  net_profit?: number;
  room_count?: number;
  rooms_let?: number;
  rooms_rent?: number;
  unit_count?: number;
  occupied_count?: number;
}

export type UnitStatus = "vacant" | "occupied" | "turnover" | "unavailable";

export interface Unit {
  id: number;
  property_id: number;
  name: string;
  bedrooms: number;
  bathrooms: number;
  sqft: number | null;
  market_rent: number;
  status: UnitStatus;
  notes: string | null;
  created_at: string;
  // Joined
  property_name?: string | null;
  property_color?: string | null;
  property_address?: string | null;
  property_city?: string | null;
  active_lease_id?: number | null;
  active_tenant_name?: string | null;
}

export interface Tenant {
  id: number;
  first_name: string;
  last_name: string;
  tenant_type?: "person" | "company" | null;
  company_name?: string | null;
  company_number?: string | null;
  /** For company lets: what they use the property for. */
  purpose?: string | null;
  /** Homes and rooms they're linked to, e.g. "15 · Flat D; 4 · 116 Kendall Road (Room 2)". */
  linked_homes?: string | null;
  email: string | null;
  phone: string | null;
  date_of_birth: string | null;
  emergency_contact: string | null;
  employer: string | null;
  monthly_income: number | null;
  notes: string | null;
  created_at: string;
  // Joined (active lease)
  active_unit_id?: number | null;
  active_unit_name?: string | null;
  active_property_name?: string | null;
}

export type LeaseStatus = "upcoming" | "active" | "ended" | "cancelled";

export interface Lease {
  id: number;
  unit_id: number;
  primary_tenant_id: number | null;
  start_date: string;
  end_date: string;
  monthly_rent: number;
  deposit: number;
  rent_due_day: number;
  late_fee: number;
  status: LeaseStatus;
  notes: string | null;
  created_at: string;
  // Joined
  unit_name?: string | null;
  property_id?: number | null;
  property_name?: string | null;
  property_color?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  tenant_email?: string | null;
  tenant_phone?: string | null;
}

export type ChargeStatus = "open" | "partial" | "paid" | "overdue" | "waived";

export interface RentCharge {
  id: number;
  lease_id: number;
  period: string;
  due_date: string;
  amount: number;
  amount_paid: number;
  status: ChargeStatus;
  notes: string | null;
  created_at: string;
  // Joined
  unit_id?: number | null;
  lease_rent?: number | null;
  rent_due_day?: number | null;
  unit_name?: string | null;
  property_id?: number | null;
  property_name?: string | null;
  property_color?: string | null;
  tenant_id?: number | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
}

export type PaymentMethod = "bank_transfer" | "standing_order" | "cash" | "card" | "other";

export interface Payment {
  id: number;
  charge_id: number;
  paid_at: string;
  amount: number;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
}

export type VendorCategory = "plumber" | "electrician" | "hvac" | "handyman" | "cleaning" | "landscaping" | "general";

export interface Vendor {
  id: number;
  name: string;
  category: VendorCategory;
  phone: string | null;
  email: string | null;
  notes: string | null;
  color: string;
  created_at: string;
}

export type WorkOrderPriority = "low" | "normal" | "high" | "urgent";
export type WorkOrderStatus = "open" | "assigned" | "in_progress" | "completed" | "cancelled";

export interface WorkOrder {
  id: number;
  property_id: number | null;
  unit_id: number | null;
  tenant_id: number | null;
  vendor_id: number | null;
  title: string;
  description: string | null;
  priority: WorkOrderPriority;
  status: WorkOrderStatus;
  scheduled_at: string | null;
  completed_at: string | null;
  cost: number | null;
  notes: string | null;
  created_at: string;
  /** "tenant" when it came in through the repair QR code. */
  source?: string | null;
  reported_by?: string | null;
  reporter_contact?: string | null;
  /** Comma-separated document ids of photos sent with it. */
  photo_ids?: string | null;
  // Joined
  property_name?: string | null;
  property_color?: string | null;
  unit_name?: string | null;
  tenant_first_name?: string | null;
  tenant_last_name?: string | null;
  vendor_name?: string | null;
  vendor_color?: string | null;
}

export type ApplicationStatus = "new" | "screening" | "approved" | "declined" | "withdrawn";

export interface Application {
  id: number;
  unit_id: number | null;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;
  monthly_income: number | null;
  employer: string | null;
  desired_move_in: string | null;
  status: ApplicationStatus;
  notes: string | null;
  created_at: string;
  unit_name?: string | null;
  property_name?: string | null;
}

export interface DashboardSummary {
  period: string;
  properties: number;
  units: number;
  occupied: number;
  vacant: number;
  occupancy_rate: number;
  active_leases: number;
  upcoming_move_outs: number;
  month_outstanding: number;
  month_collected: number;
  overdue_total: number;
  overdue_count: number;
  open_work_orders: number;
  urgent_work_orders: number;
  recent_work_orders: {
    id: number; title: string; priority: string; status: string;
    property_name: string | null; unit_name: string | null; created_at: string;
  }[];
  upcoming_expirations: {
    id: number; end_date: string;
    tenant_first_name: string | null; tenant_last_name: string | null;
    unit_name: string | null; property_name: string | null;
  }[];
}

export interface PortfolioGroup {
  key: string;
  count: number;
  rent_in: number;
  rent_out: number;
  costs: number;
  net: number;
  arrears: number;
}

export interface PortfolioSummary {
  properties: number;
  occupied: number;
  vacant: number;
  eviction: number;
  rent_in: number;
  rent_out: number;
  other_costs: number;
  net: number;
  costs_missing: number;
  leasehold?: { ground_rent_paid: number; service_charge_paid: number; ground_rent_received: number; service_charge_received: number };
  arrears_total: number;
  arrears_count: number;
  paid_behind?: { id: number; ref: string | null; name: string; owner: string | null; tenant_label: string | null; months_arrears: number; rent_in: number; behind_amount: number }[];
  paid_behind_total?: number;
  compliance: { expired: number; due_soon: number; missing: number };
  by_owner: PortfolioGroup[];
  by_deal: PortfolioGroup[];
  by_section: PortfolioGroup[];
  cashflow_days: { day: number; money_in: number; money_out: number }[];
  arrears: { id: number; ref: string | null; name: string; owner: string | null; tenant_label: string | null; months_arrears: number; arrears_amount: number }[];
  attention: { id: number; ref: string | null; name: string; owner: string | null; occupancy: Occupancy }[];
  finance?: FinanceSummary;
}

export interface FinanceGroup {
  key: string;
  count: number;
  value: number;
  debt: number;
  equity: number;
  our_equity: number;
  ltv: number | null;
  rent_in: number;
  mortgage: number;
  share: number | null;
}

export interface FinanceSummary {
  homes: number;
  valued: number;
  missing_value: number;
  value: number;
  debt: number;
  equity: number;
  our_value: number;
  our_debt: number;
  our_equity: number;
  ltv: number | null;
  gross_yield: number | null;
  net_yield: number | null;
  unencumbered: number;
  by_company: FinanceGroup[];
  by_lender: FinanceGroup[];
  leases: { id: number; ref: string | null; name: string; lease_end: string | null; years_left: number }[];
  leases_under_90: { id: number; ref: string | null; name: string; lease_end: string | null; years_left: number }[];
  fixed_rates: { id: number; ref: string | null; name: string; lender: string | null; fixed_rate_end: string; mortgage_balance: number }[];
  fixed_rates_due: number;
  highest_ltv: { id: number; ref: string | null; name: string; lender: string | null; value: number; debt: number; ltv: number }[];
}

export interface Room {
  id: number;
  property_id: number;
  room: string | null;
  tenant_name: string | null;
  rent: number;
  pay_day: number | null;
  rent_status: "on_time" | "in_arrears" | "missed" | "empty" | null;
  start_date: string | null;
  end_date: string | null;
  notes: string | null;
  linked_tenant_id?: number | null;
  linked_tenant_name?: string | null;
}

export interface CalendarEvent {
  date: string;
  kind: "in" | "out" | "compliance" | "tenancy";
  amount?: number;
  title: string;
  detail: string;
  property_id: number;
  ref: string | null;
  status?: string;
}

export interface CalendarData {
  month: string;
  days_in_month: number;
  events: CalendarEvent[];
  totals: { in: number; out: number };
  compliance_due: { date: string; title: string; detail: string; property_id: number; ref: string | null; expired: boolean }[];
  compliance_missing: number;
}

export interface Me {
  id: number;
  username: string;
  name: string;
  role: "admin" | "member";
  mailboxes: string[];
  setup: boolean;
}

export type InvoiceStatus = "draft" | "sent" | "paid" | "void";

export interface InvoiceItem {
  description: string;
  amount: number;
}

export interface Invoice {
  id: number;
  number: string;
  property_id: number | null;
  bill_to_name: string;
  bill_to_email: string | null;
  bill_to_address: string | null;
  issue_date: string;
  due_date: string;
  items: InvoiceItem[];
  notes: string | null;
  status: InvoiceStatus;
  sent_at: string | null;
  sent_to: string | null;
  sent_from: string | null;
  paid_at: string | null;
  created_by: string | null;
  created_at: string;
  total: number;
  property_name?: string | null;
  property_ref?: string | null;
}

export type LeadStatus = "new" | "contacted" | "viewing" | "offer_made" | "under_offer" | "completed" | "withdrawn";

export interface SalesLead {
  id: number;
  landlord_name: string;
  phone: string | null;
  email: string | null;
  location: string | null;
  address: string | null;
  postcode: string | null;
  property_type: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  tenure: string | null;
  asking_price: number | null;
  estimated_value: number | null;
  offer_amount: number | null;
  buyer_agent: string | null;
  solicitor: string | null;
  status: LeadStatus;
  next_action: string | null;
  notes: string | null;
  created_at: string;
}

export type NewSalesLead = Partial<Omit<SalesLead, "id" | "created_at">> & { landlord_name: string };

// ── Input types for mutations ──────────────────────────────────────

export type NewProperty = Partial<Omit<Property, "id" | "created_at" | "unit_count" | "occupied_count" | "net_profit" | "room_count" | "rooms_let" | "rooms_rent">> & { name: string };
export type NewUnit = Partial<Omit<Unit, "id" | "created_at" | "property_name" | "property_color" | "property_address" | "property_city" | "active_lease_id" | "active_tenant_name">> & { property_id: number; name: string };
export type NewTenant = Partial<Omit<Tenant, "id" | "created_at" | "active_unit_id" | "active_unit_name" | "active_property_name">> & { first_name: string; last_name: string };
export type NewLease = Partial<Omit<Lease, "id" | "created_at" | "unit_name" | "property_id" | "property_name" | "property_color" | "tenant_first_name" | "tenant_last_name" | "tenant_email" | "tenant_phone">> & { unit_id: number; start_date: string; end_date: string };
export type NewWorkOrder = Partial<Omit<WorkOrder, "id" | "created_at" | "property_name" | "property_color" | "unit_name" | "tenant_first_name" | "tenant_last_name" | "vendor_name" | "vendor_color">> & { title: string };
export type NewVendor = Partial<Omit<Vendor, "id" | "created_at">> & { name: string };
export type NewApplication = Partial<Omit<Application, "id" | "created_at" | "unit_name" | "property_name">> & { first_name: string; last_name: string };

export type LetterStatus = "draft" | "sent" | "signed" | "void";

export interface Letter {
  id: number;
  template: string;
  category: "tenancy" | "company" | "arrears";
  title: string;
  property_id: number | null;
  tenant_id: number | null;
  room: string | null;
  status: LetterStatus;
  sent_on: string | null;
  signed_on: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  property_name: string | null;
  property_ref: string | null;
  tenant_name: string | null;
  file_count: number;
  body?: string | null;
  fields?: Record<string, string> | null;
}

export type MortgageCharge = "first" | "second" | "bridging" | "other";
export type RepaymentType = "interest_only" | "repayment" | "part_and_part";
export type RateType = "fixed" | "tracker" | "variable" | "discount";

export interface Mortgage {
  id: number;
  property_id: number | null;
  lender: string;
  account_ref: string | null;
  borrower: string | null;
  broker: string | null;
  charge: MortgageCharge;
  repayment_type: RepaymentType;
  rate_type: RateType;
  interest_rate: number | null;
  deal_end: string | null;
  follow_on_rate: number | null;
  start_date: string | null;
  term_end: string | null;
  balance: number | null;
  balance_as_of: string | null;
  monthly_payment: number | null;
  payment_day: number | null;
  erc_until: string | null;
  erc_note: string | null;
  status: "active" | "redeemed";
  notes: string | null;
  created_at: string;
  updated_at: string;
  property_name: string | null;
  property_ref: string | null;
  property_address: string | null;
  property_owner: string | null;
  property_section: string | null;
  market_value: number | null;
  ownership_share: number | null;
  rent_in: number | null;
  doc_count?: number;
  lease_end?: string | null;
  lease_years?: number | null;
  property_tenure?: string | null;
}
