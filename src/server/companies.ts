// Companies and joint ventures: who holds what share of each company, and
// which homes it owns. Each company shows its monthly profit and equity from
// its homes, and the signed-in person sees their own share of both.
//
// Homes are linked in company_properties rather than by rewriting
// properties.owner, because the Google Sheet sync owns that column.

import type { Context, Hono } from "hono";
import { z } from "zod";
import { get, query, run } from "./db";
import { getUser } from "./auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyApp = Hono<any>;

const text = (max: number) => z.string().trim().max(max).optional().nullable();

const Member = z.object({
  name: z.string().trim().min(1, "Every shareholder needs a name").max(160),
  user_id: z.number().int().optional().nullable(),
  share: z.number().min(0, "Shares can't be negative").max(100, "A share can't be more than 100%"),
  role: text(40),
  invested: z.number().min(0).max(1_000_000_000).optional().nullable(),
});

const CompanyInput = z.object({
  name: z.string().trim().min(1, "Add the company's name").max(160),
  kind: z.enum(["ltd", "jv", "llp", "partnership", "personal", "other"]).optional(),
  company_number: text(20),
  incorporated_on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  registered_address: text(300),
  notes: text(4000),
  members: z.array(Member).max(50).optional(),
  property_ids: z.array(z.number().int()).max(1000).optional(),
});

type PropRow = {
  id: number; ref: string | null; name: string; address: string | null; owner: string | null; deal_type: string | null;
  rent_in: number; rent_out: number; other_costs: number;
  ground_rent_paid: number; service_charge_paid: number; ground_rent_received: number; service_charge_received: number;
  market_value: number | null; mortgage_balance: number | null; ownership_share: number | null;
};
type MemberRow = { id: number; company_id: number; name: string; user_id: number | null; share: number; role: string | null; invested: number | null };
type CompanyRow = { id: number; name: string; kind: string; company_number: string | null; incorporated_on: string | null; registered_address: string | null; notes: string | null; created_at: string };

const round = (n: number) => Math.round(n * 100) / 100;
/** The company's part of a home: the property's ownership share, or all of it. */
const stake = (p: PropRow) => (p.ownership_share && p.ownership_share > 0 ? p.ownership_share / 100 : 1);
const monthlyNet = (p: PropRow) =>
  (p.rent_in || 0) - (p.rent_out || 0) - (p.other_costs || 0)
  - ((p.ground_rent_paid || 0) + (p.service_charge_paid || 0)) / 12
  + ((p.ground_rent_received || 0) + (p.service_charge_received || 0)) / 12;
const equity = (p: PropRow) => (p.market_value != null ? p.market_value - (p.mortgage_balance ?? 0) : null);

const intId = (c: Context) => {
  const n = parseInt(c.req.param("id") ?? "", 10);
  return Number.isFinite(n) ? n : null;
};

async function overview(me: { id: number; name: string } | null) {
  const companies = await query<CompanyRow>("SELECT * FROM companies ORDER BY name COLLATE NOCASE").catch(() => []);
  const members = await query<MemberRow>("SELECT * FROM company_members ORDER BY sort, id").catch(() => []);
  const links = await query<{ property_id: number; company_id: number }>("SELECT property_id, company_id FROM company_properties").catch(() => []);
  const props = await query<PropRow>(
    `SELECT id, ref, name, address, owner, deal_type, rent_in, rent_out, other_costs,
            ground_rent_paid, service_charge_paid, ground_rent_received, service_charge_received,
            market_value, mortgage_balance, ownership_share
     FROM properties`,
  ).catch(() => []);
  const byId = new Map(props.map((p) => [p.id, p]));
  const isMe = (m: MemberRow) =>
    !!me && ((m.user_id != null && m.user_id === me.id) || (m.user_id == null && m.name.trim().toLowerCase() === me.name.trim().toLowerCase()));

  const out = companies.map((co) => {
    const ms = members.filter((m) => m.company_id === co.id);
    const homes = links.filter((l) => l.company_id === co.id).map((l) => byId.get(l.property_id)).filter((p): p is PropRow => !!p);
    const monthly = homes.reduce((a, p) => a + monthlyNet(p) * stake(p), 0);
    const rentIn = homes.reduce((a, p) => a + (p.rent_in || 0) * stake(p), 0);
    const valued = homes.filter((p) => equity(p) != null);
    const eq = valued.length ? valued.reduce((a, p) => a + (equity(p) as number) * stake(p), 0) : null;
    const value = valued.length ? valued.reduce((a, p) => a + (p.market_value ?? 0) * stake(p), 0) : null;
    const allocated = ms.reduce((a, m) => a + (m.share || 0), 0);
    const mine = ms.filter(isMe);
    const myShare = mine.reduce((a, m) => a + (m.share || 0), 0);
    return {
      ...co,
      members: ms.map((m) => ({ ...m, is_me: isMe(m) })),
      properties: homes.map((p) => ({
        id: p.id, ref: p.ref, name: p.name, address: p.address, owner: p.owner,
        stake: round(stake(p) * 100), monthly_net: round(monthlyNet(p) * stake(p)), rent_in: round((p.rent_in || 0) * stake(p)),
        equity: equity(p) != null ? round((equity(p) as number) * stake(p)) : null,
      })),
      allocated: round(allocated),
      monthly_net: round(monthly),
      rent_in: round(rentIn),
      equity: eq != null ? round(eq) : null,
      value: value != null ? round(value) : null,
      my_share: mine.length ? round(myShare) : null,
      my_monthly: mine.length ? round((monthly * myShare) / 100) : null,
      my_equity: mine.length && eq != null ? round((eq * myShare) / 100) : null,
      my_invested: mine.length ? round(mine.reduce((a, m) => a + (m.invested || 0), 0)) : null,
    };
  });

  // Owner names from the sheet that aren't set up as a company yet, with their homes, as one-click starts.
  const linked = new Set(links.map((l) => l.property_id));
  const known = new Set(companies.map((c) => c.name.trim().toLowerCase()));
  const groups = new Map<string, { name: string; property_ids: number[] }>();
  for (const p of props) {
    const owner = (p.owner ?? "").trim();
    if (!owner || linked.has(p.id) || p.deal_type === "rent_to_rent" || known.has(owner.toLowerCase())) continue;
    const g = groups.get(owner.toLowerCase()) ?? { name: owner, property_ids: [] };
    g.property_ids.push(p.id);
    groups.set(owner.toLowerCase(), g);
  }
  const suggestions = [...groups.values()].sort((a, b) => b.property_ids.length - a.property_ids.length);

  const people = await query<{ id: number; name: string }>("SELECT id, name FROM users WHERE active = 1 ORDER BY name COLLATE NOCASE").catch(() => []);

  const mineAll = out.filter((c) => c.my_share != null);
  return {
    companies: out,
    suggestions,
    people,
    me: me ? { id: me.id, name: me.name } : null,
    totals: {
      companies: out.length,
      my_companies: mineAll.length,
      my_monthly: round(mineAll.reduce((a, c) => a + (c.my_monthly ?? 0), 0)),
      my_equity: round(mineAll.reduce((a, c) => a + (c.my_equity ?? 0), 0)),
    },
  };
}

async function save(id: number | null, d: z.infer<typeof CompanyInput>) {
  if (d.members) {
    const total = d.members.reduce((a, m) => a + m.share, 0);
    if (total > 100.01) throw new Error(`The shares add up to ${round(total)}%. They can't be more than 100%.`);
  }
  let companyId = id;
  if (companyId == null) {
    const r = await run(
      "INSERT INTO companies (name, kind, company_number, incorporated_on, registered_address, notes) VALUES (?, ?, ?, ?, ?, ?)",
      [d.name, d.kind ?? "ltd", d.company_number ?? null, d.incorporated_on ?? null, d.registered_address ?? null, d.notes ?? null],
    );
    companyId = Number(r.lastInsertRowid);
  } else {
    const r = await run(
      `UPDATE companies SET name = ?, kind = COALESCE(?, kind), company_number = ?, incorporated_on = ?, registered_address = ?, notes = ?, updated_at = datetime('now') WHERE id = ?`,
      [d.name, d.kind ?? null, d.company_number ?? null, d.incorporated_on ?? null, d.registered_address ?? null, d.notes ?? null, companyId],
    );
    if (!r.changes) throw new Error("Not found");
  }
  if (d.members) {
    await run("DELETE FROM company_members WHERE company_id = ?", [companyId]);
    let sort = 0;
    for (const m of d.members) {
      await run("INSERT INTO company_members (company_id, name, user_id, share, role, invested, sort) VALUES (?, ?, ?, ?, ?, ?, ?)", [
        companyId, m.name, m.user_id ?? null, m.share, m.role ?? null, m.invested ?? null, sort++,
      ]);
    }
  }
  if (d.property_ids) {
    await run("DELETE FROM company_properties WHERE company_id = ?", [companyId]);
    for (const pid of new Set(d.property_ids)) {
      // A home belongs to one company: moving it here takes it off any other.
      await run("INSERT INTO company_properties (property_id, company_id) VALUES (?, ?) ON CONFLICT(property_id) DO UPDATE SET company_id = excluded.company_id", [pid, companyId]);
    }
  }
  return companyId;
}

export function registerCompanies(app: AnyApp) {
  app.get("/api/companies", async (c) => {
    const u = getUser(c);
    return c.json(await overview(u && u.id ? { id: u.id, name: u.name } : null));
  });

  app.post("/api/companies", async (c) => {
    const parsed = CompanyInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    try {
      const id = await save(null, parsed.data);
      return c.json({ id }, 201);
    } catch (err) {
      return c.json({ error: (err as Error).message }, 400);
    }
  });

  app.put("/api/companies/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const parsed = CompanyInput.safeParse(await c.req.json().catch(() => null));
    if (!parsed.success) return c.json({ error: parsed.error.issues[0]?.message ?? "Invalid" }, 400);
    try {
      await save(id, parsed.data);
      return c.json({ id });
    } catch (err) {
      const msg = (err as Error).message;
      return c.json({ error: msg }, msg === "Not found" ? 404 : 400);
    }
  });

  app.delete("/api/companies/:id", async (c) => {
    const id = intId(c);
    if (!id) return c.json({ error: "Invalid ID" }, 400);
    const row = await get("SELECT id FROM companies WHERE id = ?", [id]);
    if (!row) return c.json({ error: "Not found" }, 404);
    await run("DELETE FROM company_members WHERE company_id = ?", [id]);
    await run("DELETE FROM company_properties WHERE company_id = ?", [id]);
    await run("DELETE FROM companies WHERE id = ?", [id]);
    return c.json({ ok: true });
  });
}
