import type { DealType, LeadStatus, Occupancy, Property, PropertyType, RentStatus } from "@/types";
import { daysBetween, toIsoDate } from "@/lib/utils";

export const PROPERTY_TYPES: { value: PropertyType; label: string }[] = [
  { value: "flat", label: "Flat" },
  { value: "maisonette", label: "Maisonette" },
  { value: "terraced", label: "Terraced house" },
  { value: "semi_detached", label: "Semi-detached house" },
  { value: "detached", label: "Detached house" },
  { value: "bungalow", label: "Bungalow" },
  { value: "commercial", label: "Commercial" },
  { value: "other", label: "Other" },
];

export const DEAL_TYPES: { value: DealType; label: string }[] = [
  { value: "owned", label: "Owned" },
  { value: "joint_venture", label: "Joint venture" },
  { value: "rent_to_rent", label: "Rent to rent" },
  { value: "ground_rent", label: "Ground rent" },
];

export const OCCUPANCY: { value: Occupancy; label: string }[] = [
  { value: "occupied", label: "Occupied" },
  { value: "part_occupied", label: "Part occupied" },
  { value: "vacant", label: "Vacant" },
  { value: "eviction", label: "Eviction in process" },
];

export const TENURES: { value: "freehold" | "leasehold" | "share_of_freehold"; label: string }[] = [
  { value: "freehold", label: "Freehold" },
  { value: "share_of_freehold", label: "Share of freehold" },
  { value: "leasehold", label: "Leasehold" },
];

export const isFreehold = (t: string | null | undefined) => t === "freehold" || t === "share_of_freehold";

export const RENT_STATUS: { value: RentStatus; label: string }[] = [
  { value: "on_time", label: "On time" },
  { value: "in_arrears", label: "In arrears" },
  { value: "in_advance", label: "Paid in advance" },
  { value: "ground_rent", label: "Ground rent" },
];

export const LEAD_STATUS: { value: LeadStatus; label: string }[] = [
  { value: "new", label: "New" },
  { value: "contacted", label: "Contacted" },
  { value: "viewing", label: "Viewing booked" },
  { value: "offer_made", label: "Offer made" },
  { value: "under_offer", label: "Under offer" },
  { value: "completed", label: "Completed" },
  { value: "withdrawn", label: "Withdrawn" },
];

const lookup = <T extends string>(list: { value: T; label: string }[]) =>
  (v: string | null | undefined) => list.find((x) => x.value === v)?.label ?? (v ? v.replace(/_/g, " ") : "—");

export const propertyTypeLabel = lookup(PROPERTY_TYPES);
export const dealLabel = lookup(DEAL_TYPES);
export const occupancyLabel = lookup(OCCUPANCY);
export const rentStatusLabel = lookup(RENT_STATUS);
export const tenureLabel = lookup(TENURES);
export const leadStatusLabel = lookup(LEAD_STATUS);

/** Badge variant for each value, so the same state reads the same everywhere. */
export function occupancyTone(o: Occupancy): "success" | "info" | "warning" | "destructive" {
  if (o === "occupied") return "success";
  if (o === "part_occupied") return "info";
  if (o === "vacant") return "warning";
  return "destructive";
}

export function rentStatusTone(s: RentStatus | null): "success" | "info" | "destructive" | "neutral" {
  if (s === "on_time") return "success";
  if (s === "in_advance") return "info";
  if (s === "in_arrears") return "destructive";
  return "neutral";
}

export const CERTIFICATES = [
  { key: "gas_expiry", label: "Gas safety" },
  { key: "epc_expiry", label: "EPC" },
  { key: "eicr_expiry", label: "EICR" },
  { key: "licence_expiry", label: "Licence" },
  { key: "insurance_expiry", label: "Insurance" },
] as const;

export type CertKey = typeof CERTIFICATES[number]["key"];

export type CertState = "missing" | "expired" | "due_soon" | "ok";

/** Expired, due within 60 days, fine, or not recorded. */
export function certState(date: string | null | undefined): CertState {
  if (!date) return "missing";
  const days = daysBetween(toIsoDate(new Date()), date);
  if (days < 0) return "expired";
  if (days <= 60) return "due_soon";
  return "ok";
}

export const ENERGY_LABEL: Record<string, string> = { all_electric: "All electric", gas_electric: "Gas & electric" };

/** All-electric homes don't need a gas safety certificate. */
export function certNeeded(p: Property, key: CertKey): boolean {
  return !(key === "gas_expiry" && p.energy === "all_electric");
}

/** A property's overall compliance: the worst of the certificates it needs. */
export function complianceState(p: Property): CertState {
  const states = CERTIFICATES.filter((c) => certNeeded(p, c.key)).map((c) => certState(p[c.key]));
  if (states.includes("expired")) return "expired";
  if (states.every((s) => s === "missing")) return "missing";
  if (states.includes("due_soon")) return "due_soon";
  return "ok";
}

export const CERT_TONE: Record<CertState, "destructive" | "warning" | "success" | "neutral"> = {
  expired: "destructive",
  due_soon: "warning",
  ok: "success",
  missing: "neutral",
};

export const CERT_LABEL: Record<CertState, string> = {
  expired: "Expired",
  due_soon: "Due soon",
  ok: "Up to date",
  missing: "No dates",
};

/** Ground rent and service charge received minus paid, per month (the sheet holds yearly figures). */
export function leaseholdNet(p: Property): number {
  return ((p.ground_rent_received || 0) + (p.service_charge_received || 0) - (p.ground_rent_paid || 0) - (p.service_charge_paid || 0)) / 12;
}

export function hasLeaseholdFigures(p: Property): boolean {
  return !!(p.ground_rent_paid || p.service_charge_paid || p.ground_rent_received || p.service_charge_received);
}

/** Monthly net: rent in, less rent / mortgage and costs, plus ground rent and service charge received less paid. */
export function netProfit(p: Property): number {
  return (p.rent_in || 0) - (p.rent_out || 0) - (p.other_costs || 0) + leaseholdNet(p);
}

export function ordinal(n: number | null | undefined): string {
  if (!n) return "—";
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}
