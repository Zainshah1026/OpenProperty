// Free "quick answers" for the Ask panel: computed in the browser from the
// app's own data (no AI service, no cost, nothing leaves the app). Used when
// no ANTHROPIC_API_KEY is set.

import { api } from "@/api";
import { formatDate, formatMoney, toIsoDate } from "@/lib/utils";
import type { CalendarData, Invoice, PortfolioSummary, Property } from "@/types";

export interface QuickLink {
  label: string;
  to: string;
}

export interface QuickAnswer {
  text: string;
  links?: QuickLink[];
}

export const QUICK_QUESTIONS = [
  { id: "arrears", label: "Who's behind on rent?" },
  { id: "week", label: "What's coming in and going out this week?" },
  { id: "certs", label: "Which certificates are expired or expiring?" },
  { id: "tenancies", label: "Which tenancies end in the next 2 months?" },
  { id: "invoices", label: "Which rent invoices are ready to send?" },
] as const;

export type QuickId = (typeof QUICK_QUESTIONS)[number]["id"];

const addDays = (d: Date, n: number) => new Date(d.getTime() + n * 86_400_000);
const monthKey = (d: Date) => toIsoDate(d).slice(0, 7);
const name = (ref: string | null, title: string) => (ref ? `${ref} · ${title}` : title);

async function calendarMonths(count: number): Promise<CalendarData[]> {
  const now = new Date();
  const months = Array.from({ length: count }, (_, i) => monthKey(new Date(now.getFullYear(), now.getMonth() + i, 1)));
  return Promise.all(months.map((m) => api<CalendarData>("GET", `/api/calendar?month=${m}`)));
}

export async function quickAnswer(id: QuickId, currency: string): Promise<QuickAnswer> {
  const money = (n: number) => formatMoney(n, currency);
  const today = toIsoDate(new Date());

  if (id === "arrears") {
    const s = await api<PortfolioSummary>("GET", "/api/portfolio/summary");
    if (!s.arrears.length) return { text: "Nobody is marked as behind on rent. 🎉" };
    const lines = s.arrears.map(
      (a) => `• **${name(a.ref, a.name)}**${a.tenant_label ? ` (${a.tenant_label})` : ""}: ${a.arrears_amount ? money(a.arrears_amount) : "amount not recorded"}${a.months_arrears ? `, ${a.months_arrears} month${a.months_arrears === 1 ? "" : "s"}` : ""}`,
    );
    return {
      text: `**${s.arrears.length} in arrears, ${money(s.arrears_total)} in total.**\n${lines.join("\n")}`,
      links: [{ label: "Show them in Properties", to: "/properties?status=in_arrears" }],
    };
  }

  if (id === "week") {
    const end = toIsoDate(addDays(new Date(), 7));
    const cals = await calendarMonths(2);
    const events = cals.flatMap((c) => c.events).filter((e) => e.date >= today && e.date <= end && (e.kind === "in" || e.kind === "out"));
    if (!events.length) return { text: "Nothing coming in or going out in the next 7 days." };
    const block = (kind: "in" | "out") => {
      const list = events.filter((e) => e.kind === kind).sort((a, b) => a.date.localeCompare(b.date));
      const total = list.reduce((a, e) => a + (e.amount ?? 0), 0);
      const head = kind === "in" ? `**Coming in: ${money(total)}**` : `**Going out: ${money(total)}**`;
      if (!list.length) return `${head}\n• nothing`;
      return `${head}\n${list.map((e) => `• ${formatDate(e.date, { weekday: "short", day: "numeric", month: "short" })}: ${money(e.amount ?? 0)}, ${name(e.ref, e.title)}${e.detail ? ` (${e.detail})` : ""}`).join("\n")}`;
    };
    return { text: `Next 7 days, to ${formatDate(end)}:\n\n${block("in")}\n\n${block("out")}`, links: [{ label: "Open the calendar", to: "/" }] };
  }

  if (id === "certs") {
    const [cal] = await calendarMonths(1);
    const due = cal.compliance_due;
    const missing = cal.compliance_missing ? `\n\n${cal.compliance_missing} home${cal.compliance_missing === 1 ? " has" : "s have"} no certificate dates recorded yet.` : "";
    if (!due.length) return { text: `No certificates expired or expiring in the next 60 days.${missing}`, links: [{ label: "Open Compliance", to: "/compliance" }] };
    const expired = due.filter((d) => d.expired);
    const soon = due.filter((d) => !d.expired);
    const fmt = (d: (typeof due)[number]) => `• **${d.detail}**, ${name(d.ref, d.title)}: ${formatDate(d.date)}`;
    return {
      text: [
        expired.length ? `**Expired (${expired.length})**\n${expired.map(fmt).join("\n")}` : "",
        soon.length ? `**Expiring in the next 60 days (${soon.length})**\n${soon.map(fmt).join("\n")}` : "",
      ].filter(Boolean).join("\n\n") + missing,
      links: [{ label: "Open Compliance", to: "/compliance" }],
    };
  }

  if (id === "tenancies") {
    const end = toIsoDate(addDays(new Date(), 61));
    const cals = await calendarMonths(3);
    const list = cals.flatMap((c) => c.events).filter((e) => e.kind === "tenancy" && e.date >= today && e.date <= end).sort((a, b) => a.date.localeCompare(b.date));
    if (!list.length) return { text: "No tenancy end dates in the next 2 months (only rooms with a Tenancy End date in the sheet are counted)." };
    return { text: `**${list.length} ending by ${formatDate(end)}:**\n${list.map((e) => `• ${formatDate(e.date)}: ${name(e.ref, e.title)}, ${e.detail.replace(/^Tenancy ends · /, "")}`).join("\n")}` };
  }

  // invoices
  const r = await api<{ from: string; invoices: Invoice[] }>("GET", "/api/invoices/rent-ready");
  if (!r.invoices.length) return { text: "No rent invoices waiting. They're drafted automatically a week before each rent is due.", links: [{ label: "Open Invoices", to: "/invoices" }] };
  const noEmail = r.invoices.filter((i) => !i.bill_to_email).length;
  const total = r.invoices.reduce((a, i) => a + i.total, 0);
  return {
    text: `**${r.invoices.length} ready, ${money(total)} in total**, sending from ${r.from}:\n${r.invoices.map((i) => `• ${i.number}: ${i.bill_to_name}, ${money(i.total)}, due ${formatDate(i.due_date)}${i.bill_to_email ? "" : " (no email yet)"}`).join("\n")}${noEmail ? `\n\n${noEmail} need a tenant email in the sheet before they can be sent.` : ""}`,
    links: [{ label: "Review and send", to: "/invoices" }],
  };
}

/** Find homes by ref, address, postcode, owner or tenant. */
export function searchProperties(q: string, properties: Property[]): QuickAnswer {
  const words = q.toLowerCase().split(/\s+/).filter(Boolean);
  const hits = properties.filter((p) => {
    const hay = [p.ref, p.name, p.address, p.zip, p.city, p.owner, p.tenant_label, p.tenant_name].filter(Boolean).join(" ").toLowerCase();
    return words.every((w) => hay.includes(w) || (p.ref && String(p.ref).toLowerCase() === w));
  });
  if (!hits.length) return { text: `No property matches "${q}". Try a ref number, part of the address, a postcode or a tenant's name.` };
  return {
    text: hits.length === 1 ? "Found it:" : `Found ${hits.length}:`,
    links: hits.slice(0, 12).map((p) => ({ label: `${p.ref ? `${p.ref} · ` : ""}${p.name}`, to: `/properties/${p.id}` })),
  };
}
