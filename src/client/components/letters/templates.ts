// Letter and contract templates for homes in England.
//
// Written for the law after the Renters' Rights Act 2025 came into force on
// 1 May 2026: no section 21, no new assured shorthold tenancies (tenancies to
// people are assured periodic tenancies), section 8 notices on Form 3A, rent
// increases only via section 13. Company lets sit outside that regime and are
// ended by notice to quit.
//
// Each template asks a few questions (pre-filled from the property, tenant and
// letterhead) and renders HTML that the user can then edit, print or save as
// PDF. They are starting points, not legal advice; the UI says so.

import type { Property, Tenant } from "@/types";

export type Category = "arrears" | "tenancy" | "company";

export const CATEGORY_LABEL: Record<Category, string> = {
  arrears: "Arrears & eviction",
  tenancy: "Tenancy agreements",
  company: "Company lets",
};

export interface Letterhead {
  company: string;
  address: string;
  phone: string;
  email: string;
  signatory: string;
  position: string;
  bank: string;
}

export const LETTERHEAD_KEYS: Record<keyof Letterhead, string> = {
  company: "letter_company",
  address: "letter_address",
  phone: "letter_phone",
  email: "letter_email",
  signatory: "letter_signatory",
  position: "letter_position",
  bank: "letter_bank",
};

export const DEFAULT_LETTERHEAD: Letterhead = {
  company: "Chisti & Co. Properties Ltd",
  address: "",
  phone: "",
  email: "info@chistiandco.com",
  signatory: "",
  position: "Director",
  bank: "",
};

export interface Ctx {
  today: string;
  property: Property | null;
  tenant: Tenant | null;
  room: string | null;
  /** Monthly rent for this home or room, if known. */
  rent: number;
  /** Rent day of the month, if known. */
  rentDay: number | null;
  letterhead: Letterhead;
}

export interface Field {
  key: string;
  label: string;
  type: "text" | "date" | "money" | "number" | "textarea" | "select" | "checks";
  options?: { value: string; label: string }[];
  help?: string;
  wide?: boolean;
  initial: (ctx: Ctx) => string;
}

export interface Template {
  id: string;
  category: Category;
  name: string;
  blurb: string;
  /** Who it's for: people (assured tenancies) or companies. */
  for: "person" | "company" | "any";
  fields: Field[];
  title: (ctx: Ctx, v: Record<string, string>) => string;
  render: (ctx: Ctx, v: Record<string, string>) => string;
}

// ── Helpers ────────────────────────────────────────────────────────

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[ch]!);
/** Escape, keeping line breaks. */
const lines = (s: unknown) => esc(s).replace(/\n/g, "<br>");
const blank = (s: string | undefined, width = 12) => (s && s.trim() ? esc(s) : `<span class="gap">${"&nbsp;".repeat(width)}</span>`);

export const longDate = (iso: string | undefined | null) => {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};
const dateOr = (iso: string | undefined) => (iso ? esc(longDate(iso)) : blank("", 16));
const money = (v: string | number | undefined) => {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[£,\s]/g, ""));
  return Number.isFinite(n) ? `£${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}` : blank("", 10);
};
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
export const addDays = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  d.setDate(d.getDate() + n);
  return iso(d);
};
export const addMonths = (isoDate: string, n: number) => {
  const d = new Date(`${isoDate}T00:00:00`);
  const day = d.getDate();
  d.setDate(1);
  d.setMonth(d.getMonth() + n);
  const last = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  d.setDate(Math.min(day, last));
  return iso(d);
};
const ordinal = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? "st" : n % 10 === 2 && n % 100 !== 12 ? "nd" : n % 10 === 3 && n % 100 !== 13 ? "rd" : "th"}`;

export function tenantName(t: Tenant | null): string {
  if (!t) return "";
  if (t.tenant_type === "company" && t.company_name) return t.company_name;
  return `${t.first_name ?? ""} ${t.last_name ?? ""}`.trim();
}

/** The let address: "Room 2, 116 Kendall Road, Colchester, Essex CO1 2BU". */
export function letAddress(ctx: Ctx): string {
  const p = ctx.property;
  if (!p) return "";
  const base = [p.address || p.name, p.zip].filter(Boolean).join(" ");
  return ctx.room ? `${ctx.room}, ${base}` : base;
}

const landlordDefault = (ctx: Ctx) =>
  ctx.property?.section === "managed" || !ctx.property?.owner ? ctx.letterhead.company : ctx.property.owner;

function letterhead(ctx: Ctx, v: Record<string, string>, opts: { to?: string; toAddress?: string; ref?: string } = {}) {
  const lh = ctx.letterhead;
  const contact = [lh.phone, lh.email].filter(Boolean).map(esc).join(" · ");
  return `
<header class="lh">
  <div class="lh-name">${esc(lh.company)}</div>
  ${lh.address ? `<div class="lh-addr">${lines(lh.address)}</div>` : ""}
  ${contact ? `<div class="lh-addr">${contact}</div>` : ""}
</header>
<div class="meta">
  <div class="to">
    <strong>${lines(opts.to ?? v.recipient)}</strong><br>
    ${lines(opts.toAddress ?? v.recipient_address ?? letAddress(ctx))}
  </div>
  <div class="date">${esc(longDate(v.letter_date || ctx.today))}${opts.ref ? `<br><span class="muted">Ref: ${esc(opts.ref)}</span>` : ""}</div>
</div>`;
}

function signOff(ctx: Ctx, v: Record<string, string>, closing = "Yours sincerely") {
  return `
<p class="signoff">${esc(closing)},</p>
<div class="sigspace"></div>
<p><strong>${blank(v.signatory ?? ctx.letterhead.signatory, 24)}</strong><br>${esc(v.position ?? ctx.letterhead.position)}<br>${esc(v.on_behalf ?? ctx.letterhead.company)}</p>`;
}

function signatureBlock(parties: { role: string; name: string; note?: string }[]) {
  return `<table class="sigs">${parties
    .map(
      (p) => `<tr><td class="who"><strong>${esc(p.role)}</strong><br>${esc(p.name) || "&nbsp;"}${p.note ? `<br><span class="muted">${esc(p.note)}</span>` : ""}</td>
      <td><div class="line"></div>Signature</td><td class="d"><div class="line"></div>Date</td></tr>`,
    )
    .join("")}</table>`;
}

/** "Rent schedule" rows from a textarea: one line per entry, "date | description | due | paid". */
function scheduleTable(text: string) {
  const rows = text.split("\n").map((l) => l.split("|").map((x) => x.trim())).filter((r) => r.some(Boolean));
  if (!rows.length) return "";
  let balance = 0;
  const body = rows
    .map((r) => {
      const due = parseFloat((r[2] ?? "").replace(/[£,]/g, "")) || 0;
      const paid = parseFloat((r[3] ?? "").replace(/[£,]/g, "")) || 0;
      balance += due - paid;
      return `<tr><td>${esc(r[0])}</td><td>${esc(r[1])}</td><td class="n">${due ? money(due) : ""}</td><td class="n">${paid ? money(paid) : ""}</td><td class="n">${money(balance)}</td></tr>`;
    })
    .join("");
  return `<table class="sched"><thead><tr><th>Date</th><th>Description</th><th class="n">Due</th><th class="n">Paid</th><th class="n">Balance</th></tr></thead><tbody>${body}</tbody></table>`;
}

/** Default schedule: the last N rent days with nothing paid. */
function defaultSchedule(ctx: Ctx, months: number) {
  if (!ctx.rent) return "";
  const day = ctx.rentDay ?? 1;
  const out: string[] = [];
  const now = new Date(`${ctx.today}T00:00:00`);
  let d = new Date(now.getFullYear(), now.getMonth(), Math.min(day, 28));
  if (d > now) d = new Date(d.getFullYear(), d.getMonth() - 1, Math.min(day, 28));
  for (let i = months - 1; i >= 0; i--) {
    const m = new Date(d.getFullYear(), d.getMonth() - i, Math.min(day, 28));
    out.push(`${iso(m)} | Rent ${m.toLocaleDateString("en-GB", { month: "long", year: "numeric" })} | ${ctx.rent} | 0`);
  }
  return out.join("\n");
}

const ADVICE = `
<div class="box">
  <strong>Free, independent advice</strong><br>
  If you are struggling to pay, please get advice as soon as possible. Citizens Advice (citizensadvice.org.uk),
  Shelter's helpline (0808 800 4444) and National Debtline (0808 808 4000) can all help for free. If you receive
  Universal Credit or Housing Benefit, tell us and your work coach or council, as help towards rent or direct
  payment to us may be available.
</div>`;

// Common questions
const F = {
  recipient: (label = "Addressed to"): Field => ({ key: "recipient", label, type: "text", initial: (c) => tenantName(c.tenant) }),
  recipientAddress: (): Field => ({ key: "recipient_address", label: "Their address", type: "textarea", initial: (c) => letAddress(c) }),
  letterDate: (): Field => ({ key: "letter_date", label: "Date of letter", type: "date", initial: (c) => c.today }),
  signatory: (): Field => ({ key: "signatory", label: "Signed by", type: "text", initial: (c) => c.letterhead.signatory }),
  rent: (): Field => ({ key: "rent", label: "Monthly rent (£)", type: "money", initial: (c) => (c.rent ? String(c.rent) : "") }),
  rentDay: (): Field => ({ key: "rent_day", label: "Rent due on day", type: "number", initial: (c) => String(c.rentDay ?? 1) }),
  landlord: (): Field => ({ key: "landlord", label: "Landlord (legal owner)", type: "text", initial: landlordDefault, help: "The company or person who owns or holds the lease. For rent to rent homes, the company that grants the tenancy." }),
  landlordAddress: (): Field => ({ key: "landlord_address", label: "Landlord's address for notices (in England & Wales)", type: "textarea", initial: (c) => [c.letterhead.company, c.letterhead.address].filter(Boolean).join("\n") }),
  bank: (): Field => ({ key: "bank", label: "Pay rent to (bank details)", type: "textarea", initial: (c) => c.letterhead.bank }),
};

const GROUNDS = [
  { value: "8", label: "Ground 8 — serious rent arrears (mandatory)", weeks: 4 },
  { value: "10", label: "Ground 10 — some rent unpaid (discretionary)", weeks: 4 },
  { value: "11", label: "Ground 11 — persistent late payment (discretionary)", weeks: 4 },
  { value: "12", label: "Ground 12 — breach of tenancy terms (discretionary)", weeks: 2 },
  { value: "14", label: "Ground 14 — anti-social behaviour (discretionary)", weeks: 0 },
  { value: "1", label: "Ground 1 — landlord or family moving in (mandatory)", weeks: 0, months: 4 },
  { value: "1A", label: "Ground 1A — landlord selling (mandatory)", weeks: 0, months: 4 },
];

/** Earliest date court proceedings can start for the chosen grounds. */
export function earliestCourtDate(served: string, grounds: string[]): string {
  let latest = served;
  for (const g of GROUNDS.filter((x) => grounds.includes(x.value))) {
    const d = g.months ? addMonths(served, g.months) : addDays(served, g.weeks * 7);
    if (d > latest) latest = d;
  }
  return latest;
}

// ── Templates ──────────────────────────────────────────────────────

export const TEMPLATES: Template[] = [
  {
    id: "arrears-reminder",
    category: "arrears",
    name: "Missed rent reminder",
    blurb: "A friendly first letter when a payment hasn't arrived.",
    for: "any",
    fields: [
      F.recipient(),
      F.recipientAddress(),
      { key: "amount", label: "Amount missed (£)", type: "money", initial: (c) => (c.rent ? String(c.rent) : "") },
      { key: "due_date", label: "Was due on", type: "date", initial: (c) => { const d = c.rentDay ?? 1; const t = c.today; const m = `${t.slice(0, 8)}${String(Math.min(d, 28)).padStart(2, "0")}`; return m > t ? addMonths(m, -1) : m; } },
      { key: "pay_by", label: "Please pay by", type: "date", initial: (c) => addDays(c.today, 7) },
      F.bank(),
      F.letterDate(),
      F.signatory(),
    ],
    title: (c, v) => `Missed rent reminder · ${v.recipient || tenantName(c.tenant) || "tenant"}`,
    render: (c, v) => `
${letterhead(c, v)}
<p>Dear ${esc(v.recipient || "Tenant")},</p>
<h2>Rent for ${esc(letAddress(c))}</h2>
<p>We have not yet received the rent of <strong>${money(v.amount)}</strong> that was due on <strong>${dateOr(v.due_date)}</strong>.
This may simply be an oversight, or the payment may be on its way.</p>
<p>Please make the payment by <strong>${dateOr(v.pay_by)}</strong>${v.bank ? " to:" : "."}</p>
${v.bank ? `<p class="indent">${lines(v.bank)}</p>` : ""}
<p>If you have already paid, thank you, and please ignore this letter. If you are having difficulty paying, please contact us
as soon as you can so we can talk about it. It is always easier to agree a way forward early.</p>
${signOff(c, v, "Kind regards")}`,
  },

  {
    id: "arrears-formal",
    category: "arrears",
    name: "Rent arrears: formal letter before action",
    blurb: "Sets out what is owed with a rent schedule, asks for payment or a plan, and warns that possession proceedings may follow.",
    for: "person",
    fields: [
      F.recipient(),
      F.recipientAddress(),
      { key: "total", label: "Total arrears (£)", type: "money", initial: (c) => String((c.property?.arrears_amount || c.rent * (c.property?.months_arrears || 1)) || "") },
      { key: "schedule", label: "Rent schedule", type: "textarea", wide: true, help: "One line per entry: date | description | due | paid", initial: (c) => defaultSchedule(c, Math.max(1, Math.round(c.property?.months_arrears || 1))) },
      { key: "pay_by", label: "Pay or contact us by", type: "date", initial: (c) => addDays(c.today, 14) },
      F.bank(),
      F.letterDate(),
      F.signatory(),
    ],
    title: (c, v) => `Rent arrears letter · ${v.recipient || tenantName(c.tenant) || "tenant"}`,
    render: (c, v) => `
${letterhead(c, v)}
<p>Dear ${esc(v.recipient || "Tenant")},</p>
<h2>Rent arrears: ${esc(letAddress(c))}</h2>
<p>Our records show that the rent account for the above property is in arrears by <strong>${money(v.total)}</strong>.
A statement of the account is set out below.</p>
${scheduleTable(v.schedule || "")}
<p>Please do one of the following by <strong>${dateOr(v.pay_by)}</strong>:</p>
<ol>
  <li>pay the arrears in full${v.bank ? ", to the account below" : ""}; or</li>
  <li>contact us to agree a realistic repayment plan, paying the arrears off in instalments on top of your normal rent.</li>
</ol>
${v.bank ? `<p class="indent">${lines(v.bank)}</p>` : ""}
<p>If you dispute any of these figures, please tell us in writing, with the reasons, so we can look into it.</p>
<p>If we do not hear from you, or the arrears are not paid or a plan agreed, we may serve a notice seeking possession
under section 8 of the Housing Act 1988 relying on the rent arrears grounds (grounds 8, 10 and/or 11), and then apply
to the court for a possession order and a money judgment for the arrears and our costs. We would much rather avoid that.</p>
${ADVICE}
${signOff(c, v)}`,
  },

  {
    id: "section8-cover",
    category: "arrears",
    name: "Eviction: Section 8 covering letter + Form 3A details",
    blurb: "Covering letter to go with the official Form 3A notice, plus a filled-in checklist to copy onto the form. Section 21 no longer exists.",
    for: "person",
    fields: [
      F.recipient("Tenant name(s): name every joint tenant"),
      F.recipientAddress(),
      { key: "grounds", label: "Grounds relied on", type: "checks", wide: true, options: GROUNDS.map((g) => ({ value: g.value, label: g.label })), initial: (c) => ((c.property?.arrears_amount ?? 0) >= 3 * (c.rent || Infinity) ? "8,10,11" : "10,11") },
      { key: "served_on", label: "Date notice served", type: "date", initial: (c) => c.today },
      { key: "method", label: "How it is served", type: "select", options: ["By hand at the property", "First class post", "Recorded delivery", "Email (agreed in the tenancy)"].map((x) => ({ value: x, label: x })), initial: () => "By hand at the property" },
      { key: "total", label: "Arrears at the date of notice (£)", type: "money", initial: (c) => String(c.property?.arrears_amount || "") },
      { key: "reasons", label: "Reasons / particulars", type: "textarea", wide: true, help: "Explain why each ground applies (e.g. dates and amounts unpaid).", initial: () => "" },
      F.landlord(),
      F.letterDate(),
      F.signatory(),
    ],
    title: (c, v) => `Section 8 notice cover letter · ${v.recipient || tenantName(c.tenant) || "tenant"}`,
    render: (c, v) => {
      const grounds = (v.grounds || "").split(",").filter(Boolean);
      const court = earliestCourtDate(v.served_on || c.today, grounds);
      const chosen = GROUNDS.filter((g) => grounds.includes(g.value));
      return `
${letterhead(c, v)}
<p>Dear ${esc(v.recipient || "Tenant")},</p>
<h2>Notice seeking possession: ${esc(letAddress(c))}</h2>
<p>Please find enclosed a notice seeking possession of the above property, given under section 8 of the Housing Act 1988
on Form 3A. Please read it carefully.</p>
<p>The notice relies on the following ground${chosen.length === 1 ? "" : "s"} in Schedule 2 to the Housing Act 1988:</p>
<ul>${chosen.map((g) => `<li>${esc(g.label.replace(/ \((mandatory|discretionary)\)/, ""))}</li>`).join("") || "<li>" + blank("", 30) + "</li>"}</ul>
${v.total ? `<p>At the date of the notice the rent arrears are <strong>${money(v.total)}</strong>.</p>` : ""}
<p>This notice does not end your tenancy and you do not have to leave by any date in it. Court proceedings cannot be started
before <strong>${esc(longDate(court))}</strong>, and only a court can order you to leave.${grounds.some((g) => ["8", "10", "11"].includes(g)) ? " If the arrears are paid, or a repayment plan is agreed and kept to, we will not need to go to court." : ""}</p>
<p>We strongly recommend that you get independent advice about this notice straight away.</p>
${ADVICE}
${signOff(c, v)}
<div class="pagebreak"></div>
<h1>Form 3A checklist (for our file)</h1>
<p class="muted">Download the current <strong>Form 3A</strong> ("Notice seeking possession of a property let on an assured tenancy")
from GOV.UK and fill it in from these details. Do not use an old Form 3 or a section 21 notice: both are invalid for
private tenancies from 1 May 2026.</p>
<table class="facts">
  <tr><th>Tenant(s): every joint tenant</th><td>${lines(v.recipient)}</td></tr>
  <tr><th>Property</th><td>${esc(letAddress(c))}</td></tr>
  <tr><th>Landlord</th><td>${esc(v.landlord)}</td></tr>
  <tr><th>Grounds</th><td>${chosen.map((g) => esc(g.label)).join("<br>") || "—"}<br><span class="muted">Copy the FULL wording of each ground from the form's guidance / Schedule 2. Ground 8 must say "rent lawfully due".</span></td></tr>
  <tr><th>Particulars</th><td>${lines(v.reasons) || "—"}</td></tr>
  <tr><th>Served</th><td>${dateOr(v.served_on)} · ${esc(v.method)}</td></tr>
  <tr><th>Earliest court date</th><td><strong>${esc(longDate(court))}</strong></td></tr>
</table>
<h3>Before serving, check</h3>
<ul class="checks">
  ${grounds.includes("8") ? "<li>Ground 8: at least 3 months' rent unpaid (13 weeks if paid weekly) on the date of the notice <em>and</em> at the hearing.</li>" : ""}
  ${grounds.some((g) => g === "1" || g === "1A") ? "<li>Grounds 1 / 1A: not usable in the first 12 months of the tenancy; 4 months' notice.</li>" : ""}
  <li>Notice periods: 4 weeks for grounds 8, 10 and 11; 2 weeks for ground 12; ground 14 can go to court straight away.</li>
  <li>Deposit protected and prescribed information given; gas safety record, EPC and EICR given to the tenant.</li>
  <li>Licence in place if the home needs one (HMO / selective licensing).</li>
  <li>Keep a copy of everything served and a note or photo of how and when it was served.</li>
</ul>`;
    },
  },

  {
    id: "apt-agreement",
    category: "tenancy",
    name: "Assured periodic tenancy agreement",
    blurb: "Written statement of terms for a tenancy to a person (replaces the AST since 1 May 2026). Rolling monthly, no fixed term.",
    for: "person",
    fields: [
      F.landlord(),
      F.landlordAddress(),
      { key: "agent", label: "Managing agent", type: "text", initial: (c) => c.letterhead.company },
      { key: "tenants", label: "Tenant(s): full names", type: "textarea", initial: (c) => tenantName(c.tenant) },
      { key: "start", label: "Tenancy starts", type: "date", initial: (c) => c.today },
      F.rent(),
      F.rentDay(),
      F.bank(),
      { key: "deposit", label: "Deposit (£)", type: "money", initial: (c) => (c.rent ? String(Math.round((c.rent * 12) / 52 * 5)) : ""), help: "Capped at 5 weeks' rent (6 if annual rent is £50,000 or more)." },
      { key: "scheme", label: "Deposit protected with", type: "select", options: ["Deposit Protection Service (DPS)", "mydeposits", "Tenancy Deposit Scheme (TDS)", "No deposit taken"].map((x) => ({ value: x, label: x })), initial: () => "Deposit Protection Service (DPS)" },
      { key: "furnished", label: "Furnishing", type: "select", options: ["Unfurnished", "Part furnished", "Furnished"].map((x) => ({ value: x, label: x })), initial: () => "Unfurnished" },
      { key: "bills", label: "Bills", type: "textarea", initial: () => "The tenant pays council tax, gas, electricity, water, broadband and TV licence." },
      { key: "max_occupants", label: "Maximum number of occupiers", type: "number", initial: (c) => String(c.property?.bedrooms ? c.property.bedrooms * 2 : "") },
      { key: "extra", label: "Extra terms (optional)", type: "textarea", wide: true, initial: (c) => (c.property?.hmo ? "The tenant has exclusive use of their room and shares the kitchen, bathroom and other communal areas with the other occupiers." : "") },
      { key: "emergency", label: "Emergency contact (repairs)", type: "text", initial: (c) => c.letterhead.phone },
    ],
    title: (c, v) => `Tenancy agreement · ${(v.tenants || tenantName(c.tenant) || "tenant").split("\n")[0]} · ${c.property?.name ?? ""}`,
    render: (c, v) => {
      const tenants = (v.tenants || "").split("\n").map((x) => x.trim()).filter(Boolean);
      return `
<h1 class="center">Assured Periodic Tenancy Agreement</h1>
<p class="center muted">Written statement of terms · Housing Act 1988 as amended by the Renters' Rights Act 2025</p>
<table class="facts">
  <tr><th>Property</th><td>${esc(letAddress(c))}${v.furnished ? ` (${esc(v.furnished.toLowerCase())})` : ""}</td></tr>
  <tr><th>Landlord</th><td>${esc(v.landlord)}</td></tr>
  <tr><th>Landlord's address for notices</th><td>${lines(v.landlord_address)}</td></tr>
  ${v.agent && v.agent !== v.landlord ? `<tr><th>Managing agent</th><td>${esc(v.agent)}</td></tr>` : ""}
  <tr><th>Tenant${tenants.length === 1 ? "" : "s"}</th><td>${tenants.map(esc).join("<br>") || blank("", 30)}</td></tr>
  <tr><th>Start date</th><td>${dateOr(v.start)}</td></tr>
  <tr><th>Rent</th><td>${money(v.rent)} per calendar month, due on the ${v.rent_day ? ordinal(parseInt(v.rent_day, 10)) : blank("", 4)} of each month</td></tr>
  <tr><th>Deposit</th><td>${v.scheme === "No deposit taken" ? "None" : `${money(v.deposit)}, protected with ${esc(v.scheme)}`}</td></tr>
  ${v.max_occupants ? `<tr><th>Maximum occupiers</th><td>${esc(v.max_occupants)}</td></tr>` : ""}
</table>

<h2>1. The tenancy</h2>
<ol class="clauses">
  <li>This is an assured periodic tenancy under the Housing Act 1988. It runs from month to month from the start date and has no fixed end date.</li>
  <li>Where there is more than one tenant, each is responsible for all of the tenant's obligations, including the whole rent (joint and several liability).</li>
  <li>The tenant may use the property only as their private home. Only the people named above, and their children under 18, may live there, up to the maximum number of occupiers.</li>
</ol>

<h2>2. Rent</h2>
<ol class="clauses">
  <li>The tenant will pay the rent in advance on the rent day each month${v.bank ? " to:<br>" + lines(v.bank) : " by bank transfer to the account the landlord gives in writing"}.</li>
  <li>The first month's rent is payable once this agreement has been signed and before the tenancy starts. No other rent in advance is required.</li>
  <li>The landlord may only increase the rent by serving a notice under section 13 of the Housing Act 1988 (Form 4A), no more than once a year and with at least two months' notice. The tenant may ask the First-tier Tribunal to decide the rent.</li>
</ol>

<h2>3. Deposit</h2>
<ol class="clauses">
  ${v.scheme === "No deposit taken" ? "<li>No deposit is taken.</li>" : `<li>The deposit of ${money(v.deposit)} will be protected with ${esc(v.scheme)} within 30 days of receipt, and the prescribed information will be given to the tenant in that time.</li>
  <li>At the end of the tenancy the deposit will be returned, less any amounts agreed or decided under the scheme's rules for unpaid rent, bills the tenant is responsible for, or damage beyond fair wear and tear.</li>`}
</ol>

<h2>4. Bills and council tax</h2>
<p>${lines(v.bills)}</p>

<h2>5. The landlord agrees to</h2>
<ol class="clauses">
  <li>let the tenant live in the property without interruption, subject to the terms of this agreement;</li>
  <li>keep in repair the structure and exterior and the installations for water, gas, electricity, sanitation, space heating and hot water (section 11, Landlord and Tenant Act 1985), and keep the property fit for human habitation;</li>
  <li>have gas appliances checked every year and give the tenant the gas safety record; have the electrical installation inspected at least every five years and give the tenant the report; provide a valid EPC; fit and test smoke alarms on every storey and carbon monoxide alarms where required;</li>
  <li>insure the building;</li>
  <li>give at least 24 hours' written notice before visiting to inspect or repair, at a reasonable time, except in an emergency;</li>
  <li>deal with repair requests promptly. Repairs can be reported to ${esc(v.agent || v.landlord)}${v.emergency ? `; in an emergency call ${esc(v.emergency)}` : ""}.</li>
</ol>

<h2>6. The tenant agrees to</h2>
<ol class="clauses">
  <li>pay the rent and the bills they are responsible for on time;</li>
  <li>keep the property clean, use it in a tenant-like manner, and not cause damage beyond fair wear and tear;</li>
  <li>tell the landlord or agent promptly about any repair needed, leak, damp or mould;</li>
  <li>allow access for inspections, repairs and safety checks after notice as above;</li>
  <li>not cause nuisance or annoyance to neighbours, and not use the property for anything illegal;</li>
  <li>not make alterations or redecorate without written consent, which will not be unreasonably refused;</li>
  <li>not sublet or part with possession of the property without the landlord's written consent;</li>
  <li>take out their own contents insurance if they want their belongings covered.</li>
</ol>

<h2>7. Pets</h2>
<p>The tenant may ask in writing to keep a pet. The landlord will reply in writing within 28 days and will not refuse unreasonably. The landlord may ask the tenant to have insurance covering pet damage.</p>

<h2>8. Ending the tenancy</h2>
<ol class="clauses">
  <li><strong>By the tenant:</strong> by giving the landlord at least two months' notice in writing, or a shorter period if the landlord agrees in writing.</li>
  <li><strong>By the landlord:</strong> only on one of the grounds in Schedule 2 to the Housing Act 1988, by serving a notice under section 8 (Form 3A) giving the notice period the law requires, and then only if a court orders possession.</li>
  <li>At the end of the tenancy the tenant will return all keys and leave the property clean, in the same condition (allowing for fair wear and tear) and with any furniture listed in the inventory.</li>
</ol>

<h2>9. Notices</h2>
<p>The landlord's address for notices, including notices in proceedings, is given above (section 48, Landlord and Tenant Act 1987). Notices to the tenant may be given by hand or by post to the property${tenants.length ? "" : ""}, or by email if the tenant has agreed to that in writing.</p>

${v.extra ? `<h2>10. Other terms</h2><p>${lines(v.extra)}</p>` : ""}

<p class="muted">The landlord will give the tenant, before or at the start of the tenancy, the gas safety record, the EPC, the electrical safety report, the deposit prescribed information and any other information the law requires.</p>

<h2>Signatures</h2>
${signatureBlock([
  { role: "Landlord / agent", name: v.landlord, note: v.agent && v.agent !== v.landlord ? `signed by ${v.agent} for the landlord` : undefined },
  ...(tenants.length ? tenants : [""]).map((t) => ({ role: "Tenant", name: t })),
])}`;
    },
  },

  {
    id: "company-let-agreement",
    category: "company",
    name: "Company let agreement",
    blurb: "For a limited company renting a home for its staff or contractors. Not an assured tenancy, so a fixed term and break clause are allowed.",
    for: "company",
    fields: [
      F.landlord(),
      F.landlordAddress(),
      { key: "company", label: "Company (tenant)", type: "text", initial: (c) => c.tenant?.company_name || tenantName(c.tenant) },
      { key: "company_number", label: "Company number", type: "text", initial: (c) => c.tenant?.company_number ?? "" },
      { key: "company_address", label: "Company's registered office", type: "textarea", initial: () => "" },
      { key: "director", label: "Signing for the company (name & role)", type: "text", initial: (c) => (c.tenant?.tenant_type === "company" && c.tenant.first_name ? `${c.tenant.first_name} ${c.tenant.last_name}, Director` : "") },
      { key: "purpose", label: "Use / who will live there", type: "textarea", initial: (c) => c.tenant?.purpose || "Residential accommodation for the company's employees and contractors" },
      { key: "max_occupants", label: "Maximum number of occupiers", type: "number", initial: (c) => String(c.property?.bedrooms ? c.property.bedrooms * 2 : "") },
      { key: "start", label: "Start date", type: "date", initial: (c) => c.today },
      { key: "term", label: "Fixed term (months)", type: "number", initial: () => "12" },
      { key: "break_after", label: "Break clause: either side can end after (months, 0 = none)", type: "number", initial: () => "6" },
      { key: "break_notice", label: "Break / ending notice (months)", type: "number", initial: () => "2" },
      F.rent(),
      F.rentDay(),
      F.bank(),
      { key: "deposit", label: "Deposit (£)", type: "money", initial: (c) => (c.rent ? String(c.rent) : "") },
      { key: "bills", label: "Bills", type: "textarea", initial: () => "The company pays council tax, gas, electricity, water, broadband and TV licence and will register the accounts in its own name." },
      { key: "extra", label: "Extra terms (optional)", type: "textarea", wide: true, initial: () => "" },
    ],
    title: (c, v) => `Company let agreement · ${v.company || "company"} · ${c.property?.name ?? ""}`,
    render: (c, v) => {
      const term = parseInt(v.term || "0", 10) || 0;
      const brk = parseInt(v.break_after || "0", 10) || 0;
      const notice = parseInt(v.break_notice || "2", 10) || 2;
      const end = v.start && term ? addDays(addMonths(v.start, term), -1) : "";
      return `
<h1 class="center">Company Let Agreement</h1>
<p class="center muted">A contractual tenancy to a company. It is not an assured tenancy under the Housing Act 1988.</p>
<table class="facts">
  <tr><th>Property</th><td>${esc(letAddress(c))}</td></tr>
  <tr><th>Landlord</th><td>${esc(v.landlord)}</td></tr>
  <tr><th>Landlord's address for notices</th><td>${lines(v.landlord_address)}</td></tr>
  <tr><th>Tenant (the company)</th><td>${esc(v.company)}${v.company_number ? `, company number ${esc(v.company_number)}` : ""}${v.company_address ? `<br>${lines(v.company_address)}` : ""}</td></tr>
  <tr><th>Permitted use</th><td>${lines(v.purpose)}${v.max_occupants ? `<br>Maximum ${esc(v.max_occupants)} occupiers` : ""}</td></tr>
  <tr><th>Term</th><td>${term ? `${term} months from ${dateOr(v.start)}${end ? ` to ${esc(longDate(end))}` : ""}` : `From ${dateOr(v.start)}, monthly`}</td></tr>
  ${brk ? `<tr><th>Break clause</th><td>Either party may end the agreement on or after ${esc(longDate(addMonths(v.start || c.today, brk)))} by giving at least ${notice} month${notice === 1 ? "" : "s"}' written notice</td></tr>` : ""}
  <tr><th>Rent</th><td>${money(v.rent)} per calendar month, in advance on the ${v.rent_day ? ordinal(parseInt(v.rent_day, 10)) : blank("", 4)} of each month</td></tr>
  <tr><th>Deposit</th><td>${money(v.deposit)}</td></tr>
</table>

<h2>1. The letting</h2>
<ol class="clauses">
  <li>The landlord lets the property to the company for the term above. Because the tenant is a company, this is a contractual tenancy and not an assured or assured periodic tenancy.</li>
  <li>The company may allow its directors, employees and contractors to live at the property as its licensees, for the permitted use and up to the maximum number of occupiers. The company must not grant any tenancy or sub-tenancy, assign this agreement, or take rent from anyone for a tenancy of the property.</li>
  <li>The company is responsible for the conduct of everyone it allows to live at or visit the property, and for making sure they leave when this agreement ends. It will give the landlord the names of the occupiers on request.</li>
  <li>If the term ends and neither party has ended the agreement, it continues from month to month on the same terms until ended under clause 6.</li>
</ol>

<h2>2. Rent and deposit</h2>
<ol class="clauses">
  <li>The company will pay the rent in advance on the rent day each month${v.bank ? " to:<br>" + lines(v.bank) : " by bank transfer to the account the landlord gives in writing"}, without deduction.</li>
  <li>The deposit is held by the landlord as security for the company's obligations and will be returned within 28 days of the end of the agreement, less any rent or other sums due and the reasonable cost of putting right any damage beyond fair wear and tear.</li>
  <li>The rent may be reviewed on each anniversary of the start date by written agreement between the parties.</li>
</ol>

<h2>3. Bills</h2>
<p>${lines(v.bills)}</p>

<h2>4. The company agrees to</h2>
<ol class="clauses">
  <li>keep the property clean and in the same condition as at the start (fair wear and tear excepted), and report any repair needed, leak, damp or mould promptly;</li>
  <li>allow the landlord access at reasonable times after at least 24 hours' notice, and at any time in an emergency;</li>
  <li>not make alterations, not cause nuisance to neighbours, and not use the property for any illegal or business purpose other than the permitted use;</li>
  <li>comply with any rules in the head lease or licence that the landlord tells it about;</li>
  <li>pay for any damage caused by its occupiers or visitors.</li>
</ol>

<h2>5. The landlord agrees to</h2>
<ol class="clauses">
  <li>let the company have the property for the term without interruption while it keeps to this agreement;</li>
  <li>keep the structure, exterior and installations for water, gas, electricity, sanitation, heating and hot water in repair;</li>
  <li>carry out the annual gas safety check, keep a valid electrical installation report and EPC, and fit smoke and carbon monoxide alarms;</li>
  <li>insure the building.</li>
</ol>

<h2>6. Ending the agreement</h2>
<ol class="clauses">
  <li>${brk ? `Either party may end this agreement on or after ${esc(longDate(addMonths(v.start || c.today, brk)))} by giving the other at least ${notice} month${notice === 1 ? "" : "s"}' written notice.` : "The agreement ends at the end of the term unless it continues under clause 1.4."}</li>
  <li>Once the term has ended, either party may end the agreement by giving at least ${notice} month${notice === 1 ? "" : "s"}' written notice (a notice to quit).</li>
  <li>If the rent is 14 days or more late, or the company breaks a term of this agreement, or the company goes into liquidation or administration, the landlord may end this agreement by court proceedings.</li>
  <li>At the end the company will give back all keys and vacant possession, with all occupiers gone.</li>
</ol>

<h2>7. General</h2>
<p>Notices must be in writing and may be delivered by hand or sent by post or email to the addresses above. This agreement is governed by the law of England and Wales.</p>
${v.extra ? `<h2>8. Other terms</h2><p>${lines(v.extra)}</p>` : ""}

<h2>Signatures</h2>
${signatureBlock([
  { role: "Landlord / agent", name: v.landlord },
  { role: "For and on behalf of the company", name: v.company, note: v.director || "Director" },
])}`;
    },
  },

  {
    id: "company-notice",
    category: "company",
    name: "Company let: notice to end",
    blurb: "Notice to quit for a company tenant, with the prescribed information a notice to quit must contain.",
    for: "company",
    fields: [
      { key: "recipient", label: "Company (tenant)", type: "text", initial: (c) => c.tenant?.company_name || tenantName(c.tenant) },
      { key: "recipient_address", label: "Send to (registered office or the property)", type: "textarea", initial: (c) => letAddress(c) },
      { key: "agreement_date", label: "Date of the company let agreement", type: "date", initial: () => "" },
      { key: "clause", label: "Clause relied on (optional)", type: "text", initial: () => "" },
      { key: "end_date", label: "Leave by (end date)", type: "date", initial: (c) => addMonths(c.today, 2), help: "At least the notice in the agreement, and never less than 4 weeks. For a monthly let, make it the last day of a rental period." },
      { key: "served_on", label: "Date served", type: "date", initial: (c) => c.today },
      F.landlord(),
      F.signatory(),
    ],
    title: (c, v) => `Notice to quit · ${v.recipient || "company"} · ${c.property?.name ?? ""}`,
    render: (c, v) => `
${letterhead(c, { ...v, letter_date: v.served_on })}
<h2>Notice to quit: ${esc(letAddress(c))}</h2>
<p>To: <strong>${esc(v.recipient)}</strong> (the tenant)</p>
<p>From: <strong>${esc(v.landlord)}</strong> (the landlord)${c.letterhead.company && c.letterhead.company !== v.landlord ? `, by its agent ${esc(c.letterhead.company)}` : ""}</p>
<p>We give you notice to quit and deliver up possession of the property known as <strong>${esc(letAddress(c))}</strong>,
which you hold under a company let agreement${v.agreement_date ? ` dated ${esc(longDate(v.agreement_date))}` : ""}${v.clause ? ` (relying on clause ${esc(v.clause)})` : ""},
on <strong>${dateOr(v.end_date)}</strong>, or at the end of the period of your tenancy which ends next after the end of
${v.end_date ? "that date" : "four weeks from the date of service of this notice"}.</p>
<p>By that date please make sure that all occupiers have left, return all keys, and leave the property clean and in good condition.
Please let us have the names of everyone currently living at the property and arrange a check-out inspection with us.</p>
<h3>Prescribed information</h3>
<ol class="clauses">
  <li>If the tenant or licensee does not leave the dwelling, the landlord or licensor must get an order for possession from the court before the tenant or licensee can lawfully be evicted. The landlord or licensor cannot apply for such an order before the notice to quit or notice to determine has run out.</li>
  <li>A tenant or licensee who does not know if they have any right to remain in possession after a notice to quit or a notice to determine runs out can obtain advice from a solicitor. Help with all or part of the cost of legal advice and assistance may be available under the Legal Aid Scheme. They should also be able to obtain information from a Citizens Advice office, a housing aid centre or a rent officer.</li>
</ol>
${signOff(c, v, "Signed")}`,
  },
];

export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);

/** Styles shared by the on-screen document and the print window. */
export const LETTER_CSS = `
.letter-doc { font-family: "Newsreader", Georgia, "Times New Roman", serif; font-size: 15px; line-height: 1.55; color: #16202b; }
.letter-doc h1 { font-size: 24px; margin: 0 0 6px; font-weight: 600; }
.letter-doc h2 { font-size: 17px; margin: 22px 0 8px; font-weight: 600; }
.letter-doc h3 { font-size: 15px; margin: 18px 0 6px; font-weight: 600; }
.letter-doc p { margin: 0 0 10px; }
.letter-doc .center { text-align: center; }
.letter-doc .muted { color: #5b6876; font-size: 13px; }
.letter-doc .lh { border-bottom: 2px solid #0e2133; padding-bottom: 10px; margin-bottom: 18px; text-align: right; }
.letter-doc .lh-name { font-size: 22px; font-weight: 600; letter-spacing: .01em; color: #0e2133; }
.letter-doc .lh-addr { font-size: 12.5px; color: #5b6876; font-family: "Figtree", Arial, sans-serif; }
.letter-doc .meta { display: flex; justify-content: space-between; gap: 24px; margin-bottom: 20px; }
.letter-doc .meta .date { text-align: right; white-space: nowrap; }
.letter-doc .indent { padding-left: 18px; border-left: 3px solid #d7dde4; }
.letter-doc .box { border: 1px solid #d7dde4; background: #f6f8fa; padding: 10px 14px; margin: 14px 0; font-size: 13.5px; border-radius: 6px; }
.letter-doc ol, .letter-doc ul { margin: 0 0 10px; padding-left: 22px; }
.letter-doc li { margin: 3px 0; }
.letter-doc table { border-collapse: collapse; width: 100%; margin: 8px 0 14px; font-size: 14px; }
.letter-doc table.facts th { text-align: left; vertical-align: top; width: 34%; padding: 6px 10px 6px 0; color: #3b4754; font-weight: 600; border-bottom: 1px solid #e3e7ec; }
.letter-doc table.facts td { padding: 6px 0; border-bottom: 1px solid #e3e7ec; }
.letter-doc table.sched th, .letter-doc table.sched td { border-bottom: 1px solid #e3e7ec; padding: 5px 8px; text-align: left; }
.letter-doc table.sched .n { text-align: right; }
.letter-doc table.sigs td { padding: 26px 12px 6px 0; vertical-align: bottom; font-size: 13.5px; }
.letter-doc table.sigs td.who { width: 40%; }
.letter-doc table.sigs td.d { width: 22%; }
.letter-doc table.sigs .line { border-bottom: 1px solid #16202b; height: 26px; margin-bottom: 4px; }
.letter-doc .sigspace { height: 44px; }
.letter-doc .signoff { margin-top: 18px; }
.letter-doc .gap { display: inline-block; border-bottom: 1px dotted #8a96a3; min-width: 60px; }
.letter-doc .pagebreak { break-after: page; height: 1px; border-top: 1px dashed #d7dde4; margin: 28px 0; }
.letter-doc .clauses li { margin: 5px 0; }
`;
