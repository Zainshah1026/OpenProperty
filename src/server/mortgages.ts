// Mortgages: one row per loan (first charge, second charge, bridge), with the
// rate, when the deal ends, the follow-on rate, the term, balance and payment.
//
// The property keeps summary fields that the dashboard's balance sheet and
// the sheet sync already use (mortgage_balance, lender, fixed_rate_end, and
// the monthly payment in rent_out). Whenever a mortgage changes, those are
// refreshed from the active mortgages on that home so every page agrees.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a full date").optional().nullable();
const money = z.number().min(0).max(1_000_000_000).optional().nullable();
const rate = z.number().min(0).max(100).optional().nullable();
const text = (max: number) => z.string().trim().max(max).optional().nullable();

const MortgageInput = z.object({
  property_id: z.number().int().optional().nullable(),
  lender: z.string().trim().min(1, "Add the lender").max(120),
  account_ref: text(80),
  borrower: text(160),
  broker: text(160),
  charge: z.enum(["first", "second", "bridging", "other"]).optional(),
  repayment_type: z.enum(["interest_only", "repayment", "part_and_part"]).optional(),
  rate_type: z.enum(["fixed", "tracker", "variable", "discount"]).optional(),
  interest_rate: rate,
  deal_end: isoDate,
  follow_on_rate: rate,
  start_date: isoDate,
  term_end: isoDate,
  balance: money,
  balance_as_of: isoDate,
  monthly_payment: money,
  payment_day: z.number().int().min(1).max(31).optional().nullable(),
  erc_until: isoDate,
  erc_note: text(300),
  status: z.enum(["active", "redeemed"]).optional(),
  notes: text(4000),
});

const FIELDS = Object.keys(MortgageInput.shape) as (keyof z.infer<typeof MortgageInput> & string)[];

const SELECT = `
  SELECT m.*, p.name AS property_name, p.ref AS property_ref, p.address AS property_address, p.owner AS property_owner,
         p.market_value, p.ownership_share, p.rent_in, p.section AS property_section,
         p.lease_end, p.lease_years, p.tenure AS property_tenure,
         (SELECT COUNT(*) FROM compliance_documents d WHERE d.mortgage_id = m.id) AS doc_count
  FROM mortgages m
  LEFT JOIN properties p ON p.id = m.property_id`;

const intId = (c: Context) => {
  const n = parseInt(c.req.param("id") ?? "", 10);
  return Number.isFinite(n) ? n : null;
};

/** Bring the property's summary fields in line with its active mortgages. */
async function refreshProperty(propertyId: number | null | undefined, hadMortgages: boolean) {
  if (!propertyId) return;
  const rows = await query<{ lender: string; balance: number | null; deal_end: string | null; monthly_payment: number | null; payment_day: number | null }>(
    "SELECT lender, balance, deal_end, monthly_payment, payment_day FROM mortgages WHERE property_id = ? AND status = 'active' ORDER BY charge = 'first' DESC, id",
    [propertyId],
  );
  if (!rows.length) {
    // The last loan on this home was paid off or removed.
    if (hadMortgages) await run("UPDATE properties SET mortgage_balance = 0, lender = NULL, fixed_rate_end = NULL WHERE id = ?", [propertyId]);
    return;
  }
  const lenders = [...new Set(rows.map((r) => r.lender))].join(", ");
  const balance = rows.some((r) => r.balance != null) ? rows.reduce((a, r) => a + (r.balance ?? 0), 0) : null;
  const dealEnd = rows.map((r) => r.deal_end).filter((d): d is string => !!d).sort()[0] ?? null;
  const sets = ["lender = ?", "fixed_rate_end = ?"];
  const params: unknown[] = [lenders, dealEnd];
  if (balance != null) { sets.push("mortgage_balance = ?"); params.push(balance); }
  // Only homes we own pay a mortgage out; rent to rent uses rent_out for the landlord's rent.
  const owned = await get<{ section: string }>("SELECT section FROM properties WHERE id = ?", [propertyId]);
  if (owned && owned.section !== "managed" && rows.some((r) => r.monthly_payment != null)) {
    sets.push("rent_out = ?");
    params.push(Math.round(rows.reduce((a, r) => a + (r.monthly_payment ?? 0), 0) * 100) / 100);
    const day = rows.find((r) => r.payment_day)?.payment_day;
    if (day) { sets.push("payment_out_day = ?"); params.push(day); }
  }
  await run(`UPDATE properties SET ${sets.join(", ")} WHERE id = ?`, [...params, propertyId]);
}

async function countFor(propertyId: number | null | undefined) {
  if (!propertyId) return 0;
  const r = await get<{ n: number }>("SELECT COUNT(*) AS n FROM mortgages WHERE property_id = ? AND status = 'active'", [propertyId]);
  return Number(r?.n ?? 0);
}

export function registerMortgages(app: AnyApp) {
  app.get("/api/mortgages", async (c) => {
    const pid = parseInt(c.req.query("property_id") ?? "", 10);
    const rows = await query(
      `${SELECT} ${Number.isFinite(pid) ? "WHERE m.property_id = ?" : ""} ORDER BY m.status = 'redeemed', m.deal_end IS NULL, m.deal_end, m.id`,
      Number.isFinite(pid) ? [pid] : [],
    ).catch(() => []);
    return c.json({ mortgages: rows });
  });

  /**
   * Homes that have a lender or balance on the property record (from the
   * sheet) but no mortgage entered yet: offered as a one-click start.
   */
  app.get("/api/mortgages/suggestions", async (c) => {
    const rows = await query(
      `SELECT p.id, p.ref, p.name, p.owner, p.lender, p.mortgage_balance, p.fixed_rate_end, p.rent_out, p.payment_out_day
       FROM properties p
       WHERE p.section != 'managed'
         AND (COALESCE(p.lender, '') != '' OR COALESCE(p.mortgage_balance, 0) > 0 OR COALESCE(p.fixed_rate_end, '') != '')
         AND NOT EXISTS (SELECT 1 FROM mortgages m WHERE m.property_id = p.id)
       ORDER BY p.name`,
    ).catch(() => []);
    return c.json({ properties: rows });
  });

  app.post("/api/mortgages/import", async (c) => {
    const body = z.object({ property_ids: z.array(z.number().int()).max(500) }).safeParse(await c.req.json().catch(() => null));
    if (!body.success) return c.json({ error: "Choose the homes to add" }, 400);
    let added = 0;
    for (const id of body.data.property_ids) {
      const p = await get<{ id: number; owner: string | null; lender: string | null; mortgage_balance: number | null; fixed_rate_end: string | null; rent_out: number; payment_out_day: number | null; section: string }>(
        "SELECT id, owner, lender, mortgage_balance, fixed_rate_end, rent_out, payment_out_day, section FROM properties WHERE id = ?",
        [id],
      );
      if (!p || p.section === "managed") continue;
      const already = await get("SELECT id FROM mortgages WHERE property_id = ?", [id]);
      if (already) continue;
      await run(
        `INSERT INTO mortgages (property_id, lender, borrower, rate_type, deal_end, balance, monthly_payment, payment_day)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          id, p.lender?.trim() || "Lender not recorded", p.owner, p.fixed_rate_end ? "fixed" : "variable", p.fixed_rate_end,
          p.mortgage_balance, p.rent_out > 0 ? p.rent_out : null, p.payment_out_day,
        ],
      );
      added++;
    }
    return c.json({ added });
  });

  app.post("/api/mortgages", async (c) => {
    const parsed = MortgageInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const d = parsed.data;
    const cols = FIELDS.filter((k) => d[k] !== undefined);
    const r = await run(
      `INSERT INTO mortgages (${cols.join(", ")}) VALUES (${cols.map(() => "?").join(", ")})`,
      cols.map((k) => d[k] ?? null),
    );
    await refreshProperty(d.property_id, true);
    return c.json({ mortgage: await get(`${SELECT} WHERE m.id = ?`, [r.lastInsertRowid]) }, 201);
  });

  app.put("/api/mortgages/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = MortgageInput.partial().safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    const before = await get<{ property_id: number | null }>("SELECT property_id FROM mortgages WHERE id = ?", [id]);
    if (!before) return c.json({ error: "Not found" }, 404);
    const sets: string[] = [];
    const params: unknown[] = [];
    for (const k of FIELDS) {
      const v = parsed.data[k];
      if (v === undefined) continue;
      sets.push(`${k} = ?`);
      params.push(v);
    }
    if (!sets.length) return c.json({ error: "No changes" }, 400);
    sets.push("updated_at = datetime('now')");
    await run(`UPDATE mortgages SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
    const after = await get<{ property_id: number | null }>("SELECT property_id FROM mortgages WHERE id = ?", [id]);
    if (after?.property_id && after.property_id !== before.property_id) {
      await run("UPDATE compliance_documents SET property_id = ? WHERE mortgage_id = ?", [after.property_id, id]);
    }
    await refreshProperty(after?.property_id, true);
    if (before.property_id && before.property_id !== after?.property_id) await refreshProperty(before.property_id, true);
    return c.json({ mortgage: await get(`${SELECT} WHERE m.id = ?`, [id]) });
  });

  app.delete("/api/mortgages/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const row = await get<{ property_id: number | null }>("SELECT property_id FROM mortgages WHERE id = ?", [id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    const files = await get<{ n: number }>("SELECT COUNT(*) AS n FROM compliance_documents WHERE mortgage_id = ?", [id]);
    if (files && Number(files.n) > 0) return c.json({ error: "Delete this mortgage's documents first, or tick 'paid off' to keep it on record." }, 409);
    const had = (await countFor(row.property_id)) > 0;
    await run("DELETE FROM mortgages WHERE id = ?", [id]);
    await refreshProperty(row.property_id, had);
    return c.json({ ok: true });
  });
}
