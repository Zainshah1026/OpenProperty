// Rent invoices, prepared automatically ahead of each rent due date.
//
// Every hour (and after each sheet sync) this looks at who pays rent and on
// which day of the month, and for any rent falling due within the next
// `rent_invoice_days_before` days (Settings → Invoicing, default 7) creates
// a DRAFT invoice dated today and due on the rent day. Drafts are never
// emailed by this code: a person reviews them on the Invoices page and
// presses "Send" (see POST /api/invoices/send-batch in invoices.ts).
//
// Who pays:
//   - a home with rooms on the Tenants tab: each occupied room with a rent,
//     billed to that room's tenant on their pay day;
//   - otherwise the whole home's Rent In on its Rent In Day, billed to the
//     Tenant / Agent, unless the home is vacant or a ground-rent deal.
//
// Each rent is drafted once per month. rent_invoice_log remembers what was
// drafted, so deleting a draft does not make it come back an hour later.

import { createInvoiceDraft } from "./invoices";
import { get, query, run } from "./db";

interface Prop {
  id: number;
  ref: string | null;
  name: string;
  address: string | null;
  zip: string | null;
  deal_type: string;
  occupancy: string | null;
  tenant_label: string | null;
  tenant_email: string | null;
  rent_in: number;
  rent_in_day: number | null;
}

interface Room {
  property_id: number;
  room: string | null;
  tenant_name: string | null;
  tenant_email: string | null;
  rent: number;
  pay_day: number | null;
  rent_status: string | null;
  start_date: string | null;
  end_date: string | null;
}

/** Today's date in the UK, as YYYY-MM-DD. */
export function londonToday(now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(now);
}

const addDays = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

/** The rent day in a given month, e.g. the 31st becomes the 30th in November. */
function dueIn(year: number, month0: number, day: number): string {
  const last = new Date(Date.UTC(year, month0 + 1, 0)).getUTCDate();
  return new Date(Date.UTC(year, month0, Math.min(day, last))).toISOString().slice(0, 10);
}

/** Rent dates for this pay day between from and to (inclusive). */
function dueDatesBetween(day: number, from: string, to: string): string[] {
  const [y, m] = from.split("-").map(Number);
  const out: string[] = [];
  for (let k = 0; k < 3; k++) {
    const d = dueIn(y, m - 1 + k, day);
    if (d >= from && d <= to) out.push(d);
  }
  return out;
}

const monthName = (iso: string) => new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
const slug = (s: string | null | undefined) => String(s ?? "").trim().toLowerCase().replace(/\s+/g, " ");

async function setting(key: string, fallback: string): Promise<string> {
  const r = await get<{ value: string }>("SELECT value FROM settings WHERE key = ?", [key]).catch(() => undefined);
  return r?.value?.trim() || fallback;
}

export interface RentRunResult {
  created: number;
  skipped_no_day: number;
}

let running = false;

export async function generateRentInvoices(now = new Date()): Promise<RentRunResult> {
  const result: RentRunResult = { created: 0, skipped_no_day: 0 };
  if (running) return result;
  running = true;
  try {
    if ((await setting("rent_invoices_auto", "on")) === "off") return result;
    const daysBefore = Math.min(31, Math.max(0, parseInt(await setting("rent_invoice_days_before", "7"), 10) || 7));
    const today = londonToday(now);
    const horizon = addDays(today, daysBefore);

    const props = await query<Prop>("SELECT * FROM properties");
    const rooms = await query<Room>("SELECT * FROM rooms ORDER BY sort");
    const roomsBy = new Map<number, Room[]>();
    for (const r of rooms) roomsBy.set(r.property_id, [...(roomsBy.get(r.property_id) ?? []), r]);

    for (const p of props) {
      if (p.deal_type === "ground_rent") continue;
      const address = [p.address, p.zip].filter(Boolean).join("\n") || p.name;
      const propKey = p.ref ? `ref:${slug(p.ref)}` : `id:${p.id}`;

      // Who pays, and when.
      const payers: { key: string; name: string; email: string | null; amount: number; day: number | null; label: string; start: string | null; end: string | null }[] = [];
      const paying = (roomsBy.get(p.id) ?? []).filter((r) => r.rent > 0 && r.rent_status !== "empty" && r.tenant_name);
      if (paying.length) {
        for (const r of paying) {
          payers.push({
            key: `${propKey}:room:${slug(r.room) || slug(r.tenant_name)}`,
            name: r.tenant_name!,
            email: r.tenant_email,
            amount: r.rent,
            day: r.pay_day ?? p.rent_in_day,
            label: r.room ? `${r.room}, ${p.name}` : p.name,
            start: r.start_date,
            end: r.end_date,
          });
        }
      } else if (p.rent_in > 0 && p.occupancy !== "vacant" && p.tenant_label) {
        payers.push({ key: `${propKey}:whole`, name: p.tenant_label, email: p.tenant_email, amount: p.rent_in, day: p.rent_in_day, label: p.name, start: null, end: null });
      }

      for (const payer of payers) {
        if (!payer.day) {
          result.skipped_no_day++;
          continue;
        }
        for (const due of dueDatesBetween(payer.day, today, horizon)) {
          // Not before the tenancy starts or after it ends.
          if (payer.start && due < payer.start) continue;
          if (payer.end && due > payer.end) continue;
          const logKey = `rent:${payer.key}:${due.slice(0, 7)}`;
          if (await get("SELECT key FROM rent_invoice_log WHERE key = ?", [logKey])) continue;
          const inv = await createInvoiceDraft(
            {
              property_id: p.id,
              bill_to_name: payer.name,
              bill_to_email: payer.email || null,
              bill_to_address: address,
              issue_date: today,
              due_date: due,
              items: [{ description: `Rent for ${monthName(due)}, ${payer.label}`, amount: payer.amount }],
              notes: null,
            },
            "auto",
          );
          await run("INSERT OR IGNORE INTO rent_invoice_log (key, invoice_id) VALUES (?, ?)", [logKey, inv.id]);
          result.created++;
        }
      }
    }
    if (result.created) console.log(`Rent invoices: drafted ${result.created} for rent due by ${horizon}.`);
    return result;
  } finally {
    running = false;
  }
}
