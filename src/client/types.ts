// ── Core entities ──────────────────────────────────────────────────

export type PropertyType = "flat" | "maisonette" | "terraced" | "semi_detached" | "detached" | "bungalow" | "commercial" | "other";
export type DealType = "owned" | "joint_venture" | "rent_to_rent" | "ground_rent";
export type Occupancy = "occupied" | "part_occupied" | "vacant" | "eviction";
export type RentStatus = "on_time" | "in_arrears" | "in_advance" | "ground_rent";

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
  bedrooms: number | null;
  hmo: number;
  occupancy: Occupancy;
  tenant_label: string | null;
  rent_in: number;
  rent_out: number;
  other_costs: number;
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
  arrears_total: number;
  arrears_count: number;
  compliance: { expired: number; due_soon: number; missing: number };
  by_owner: PortfolioGroup[];
  by_deal: PortfolioGroup[];
  cashflow_days: { day: number; money_in: number; money_out: number }[];
  arrears: { id: number; ref: string | null; name: string; owner: string | null; tenant_label: string | null; months_arrears: number; arrears_amount: number }[];
  attention: { id: number; ref: string | null; name: string; owner: string | null; occupancy: Occupancy }[];
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

export type NewProperty = Partial<Omit<Property, "id" | "created_at" | "unit_count" | "occupied_count" | "net_profit">> & { name: string };
export type NewUnit = Partial<Omit<Unit, "id" | "created_at" | "property_name" | "property_color" | "property_address" | "property_city" | "active_lease_id" | "active_tenant_name">> & { property_id: number; name: string };
export type NewTenant = Partial<Omit<Tenant, "id" | "created_at" | "active_unit_id" | "active_unit_name" | "active_property_name">> & { first_name: string; last_name: string };
export type NewLease = Partial<Omit<Lease, "id" | "created_at" | "unit_name" | "property_id" | "property_name" | "property_color" | "tenant_first_name" | "tenant_last_name" | "tenant_email" | "tenant_phone">> & { unit_id: number; start_date: string; end_date: string };
export type NewWorkOrder = Partial<Omit<WorkOrder, "id" | "created_at" | "property_name" | "property_color" | "unit_name" | "tenant_first_name" | "tenant_last_name" | "vendor_name" | "vendor_color">> & { title: string };
export type NewVendor = Partial<Omit<Vendor, "id" | "created_at">> & { name: string };
export type NewApplication = Partial<Omit<Application, "id" | "created_at" | "unit_name" | "property_name">> & { first_name: string; last_name: string };
