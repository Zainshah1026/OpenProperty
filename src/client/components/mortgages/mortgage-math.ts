// Sums for mortgages: deal-end status, monthly payments now and after the
// deal ends, and loan to value. Kept apart from the page so the property
// page's card and the Mortgages page show the same numbers.

import type { Mortgage, MortgageCharge, RateType, RepaymentType } from "@/types";
import { toIsoDate } from "@/lib/utils";

export const CHARGE_LABEL: Record<MortgageCharge, string> = {
  first: "First charge",
  second: "Second charge",
  bridging: "Bridging loan",
  other: "Other loan",
};
export const REPAYMENT_LABEL: Record<RepaymentType, string> = {
  interest_only: "Interest only",
  repayment: "Repayment",
  part_and_part: "Part and part",
};
export const RATE_LABEL: Record<RateType, string> = {
  fixed: "Fixed",
  tracker: "Tracker",
  variable: "Variable",
  discount: "Discount",
};

export const today = () => toIsoDate(new Date());

/** Whole months from today to an ISO date (negative once it has passed). */
export function monthsUntil(iso: string | null | undefined): number | null {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return null;
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  const now = new Date();
  let months = (y - now.getFullYear()) * 12 + (m - 1 - now.getMonth());
  if (d < now.getDate()) months -= 1;
  return months;
}

export type DealState = "redeemed" | "ended" | "urgent" | "soon" | "ok" | "no_date";

/** Ended or within 3 months is red, within 6 months amber. */
export function dealState(m: Pick<Mortgage, "status" | "deal_end" | "rate_type">): DealState {
  if (m.status === "redeemed") return "redeemed";
  if (!m.deal_end) return "no_date";
  if (m.deal_end < today()) return "ended";
  const months = monthsUntil(m.deal_end) ?? 99;
  if (months < 3) return "urgent";
  if (months < 6) return "soon";
  return "ok";
}

export const DEAL_TONE: Record<DealState, "destructive" | "warning" | "success" | "neutral"> = {
  redeemed: "neutral",
  ended: "destructive",
  urgent: "destructive",
  soon: "warning",
  ok: "success",
  no_date: "neutral",
};

export function dealLabel(m: Pick<Mortgage, "status" | "deal_end" | "rate_type">): string {
  const s = dealState(m);
  if (s === "redeemed") return "Paid off";
  if (s === "no_date") return m.rate_type === "fixed" ? "Deal end not set" : "No deal end";
  if (s === "ended") return "Deal ended";
  const months = monthsUntil(m.deal_end) ?? 0;
  if (months < 1) return "Ends this month";
  return months < 24 ? `Ends in ${months} mo` : `Ends in ${Math.floor(months / 12)} yrs`;
}

/**
 * Monthly payment at an annual rate: interest only is balance × rate ÷ 12; a
 * repayment loan is the usual annuity over the months left in the term.
 */
export function paymentAt(balance: number | null, ratePct: number | null, type: RepaymentType, monthsLeft: number | null): number | null {
  if (!balance || ratePct == null) return null;
  const r = ratePct / 100 / 12;
  if (type === "interest_only") return balance * r;
  if (type === "repayment") {
    if (!monthsLeft || monthsLeft <= 0) return null;
    if (r === 0) return balance / monthsLeft;
    return (balance * r) / (1 - Math.pow(1 + r, -monthsLeft));
  }
  return null; // part and part: depends on the split, so use the lender's figure
}

/** What is paid now: the figure entered, or an estimate from the rate. */
export function paymentNow(m: Mortgage): { amount: number | null; estimated: boolean } {
  if (m.monthly_payment != null) return { amount: m.monthly_payment, estimated: false };
  return { amount: paymentAt(m.balance, m.interest_rate, m.repayment_type, monthsUntil(m.term_end)), estimated: true };
}

/** The payment once the deal ends and the loan moves to the follow-on rate. */
export function paymentAfterDeal(m: Mortgage): number | null {
  if (!m.deal_end || m.follow_on_rate == null) return null;
  const left = m.term_end ? (monthsUntil(m.term_end) ?? 0) - Math.max(0, monthsUntil(m.deal_end) ?? 0) : null;
  return paymentAt(m.balance, m.follow_on_rate, m.repayment_type, left);
}

/** Interest-only loans whose term ends within 5 years need the balance repaid or refinanced. */
export function interestOnlyDue(m: Mortgage): boolean {
  if (m.status !== "active" || m.repayment_type !== "interest_only" || !m.term_end) return false;
  const months = monthsUntil(m.term_end);
  return months !== null && months < 60;
}

export const share = (m: Pick<Mortgage, "ownership_share">) => (m.ownership_share && m.ownership_share > 0 ? m.ownership_share / 100 : 1);

/** Loan to value per home, adding up every active loan on it. */
export function ltvByProperty(rows: Mortgage[]): Map<number, number> {
  const debt = new Map<number, number>();
  const value = new Map<number, number>();
  for (const m of rows) {
    if (m.status !== "active" || !m.property_id) continue;
    debt.set(m.property_id, (debt.get(m.property_id) ?? 0) + (m.balance ?? 0));
    if (m.market_value) value.set(m.property_id, m.market_value);
  }
  const out = new Map<number, number>();
  for (const [id, d] of debt) {
    const v = value.get(id);
    if (v && d) out.set(id, d / v);
  }
  return out;
}

export const pct = (n: number | null | undefined, dp = 2) => (n == null ? "—" : `${n.toFixed(dp).replace(/\.?0+$/, "")}%`);
