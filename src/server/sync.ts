// Google Sheet sync.
//
// When a sheet is linked it is the source of truth: its Properties,
// Compliance and Sales tabs are read on start, every SYNC_MINUTES, and on
// demand from the app. Two ways to link it:
//
//   Private (recommended): SHEET_SCRIPT_URL + SHEET_SCRIPT_KEY. A small Apps
//   Script attached to the sheet (scripts/sheet-endpoint.gs) hands out a tab
//   as CSV only to a caller holding the key; the sheet itself stays private.
//
//   Published: SHEET_PUB_URL from File → Share → Publish to web. Simpler, but
//   anyone who obtains that link can read the sheet.
// Properties are
// matched by Ref (or address), so their units, leases and work orders survive
// a sync; homes removed from the sheet are removed here. Leads are replaced.

import { buildPayload } from "./sheet-mapping.js";
import { get, query, run } from "./db";

export interface SyncConfig {
  SHEET_SCRIPT_URL?: string;
  SHEET_SCRIPT_KEY?: string;
  SHEET_PUB_URL?: string;
  SHEET_PROPERTIES_GID?: string;
  SHEET_RENT_TO_RENT_GID?: string;
  SHEET_COMPLIANCE_GID?: string;
  SHEET_SALES_GID?: string;
  SHEET_TENANTS_GID?: string;
}

export interface SyncStatus {
  enabled: boolean;
  running: boolean;
  last_run: string | null;
  last_success: string | null;
  error: string | null;
  properties: number;
  leads: number;
  rooms: number;
}

const status: SyncStatus = {
  enabled: false,
  running: false,
  last_run: null,
  last_success: null,
  error: null,
  properties: 0,
  leads: 0,
  rooms: 0,
};

export function syncEnabled(cfg: SyncConfig): boolean {
  return !!((cfg.SHEET_SCRIPT_URL && cfg.SHEET_SCRIPT_KEY) || cfg.SHEET_PUB_URL);
}

export function syncStatus(cfg: SyncConfig): SyncStatus {
  return { ...status, enabled: syncEnabled(cfg) };
}

/** `…/pub?output=csv` or `…/pubhtml` → the CSV URL for one tab. */
function tabUrl(base: string, gid: string): string {
  const root = base.replace(/\/pub(html)?(\?.*)?$/, "/pub");
  return `${root}?gid=${encodeURIComponent(gid)}&single=true&output=csv`;
}

async function fetchTab(cfg: SyncConfig, gid: string | undefined): Promise<string> {
  if (!gid) return "";
  let url: string;
  let init: RequestInit = { redirect: "follow" };
  if (cfg.SHEET_SCRIPT_URL && cfg.SHEET_SCRIPT_KEY) {
    // The key goes in the body, never the URL, so it stays out of request logs.
    url = `${cfg.SHEET_SCRIPT_URL}?gid=${encodeURIComponent(gid)}`;
    init = { ...init, method: "POST", headers: { "Content-Type": "text/plain" }, body: cfg.SHEET_SCRIPT_KEY };
  } else {
    url = tabUrl(cfg.SHEET_PUB_URL ?? "", gid);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`Sheet tab ${gid}: HTTP ${res.status}`);
  const text = await res.text();
  if (text.startsWith("ERROR:")) throw new Error(`Sheet tab ${gid}: ${text.slice(6).trim()}`);
  if (/^\s*<(!doctype|html)/i.test(text)) {
    throw new Error(`Sheet tab ${gid} returned a web page instead of data. Check the sheet link settings.`);
  }
  return text;
}

const PROPERTY_COLUMNS = [
  "ref", "name", "type", "address", "city", "state", "zip", "owner", "deal_type", "section", "tenure", "bedrooms", "hmo",
  "occupancy", "tenant_label", "rent_in", "rent_out", "other_costs",
  "ground_rent_paid", "service_charge_paid", "ground_rent_received", "service_charge_received", "rent_in_day", "payment_out_day",
  "rent_status", "months_arrears", "arrears_amount", "gas_expiry", "epc_expiry", "eicr_expiry",
  "licence_expiry", "insurance_expiry", "notes",
] as const;

const LEAD_COLUMNS = [
  "landlord_name", "phone", "email", "location", "address", "postcode", "property_type", "bedrooms",
  "bathrooms", "tenure", "asking_price", "estimated_value", "offer_amount", "buyer_agent", "solicitor",
  "status", "next_action", "notes",
] as const;

const ROOM_COLUMNS = ["room", "tenant_name", "rent", "pay_day", "rent_status", "start_date", "end_date", "notes", "sort"] as const;

const keyOf = (ref: unknown, address: unknown) =>
  ref ? `ref:${String(ref).trim().toLowerCase()}` : `addr:${String(address ?? "").trim().toLowerCase()}`;

export async function runSync(cfg: SyncConfig): Promise<SyncStatus> {
  if (!syncEnabled(cfg)) throw new Error("Sheet sync is not set up.");
  if (status.running) return syncStatus(cfg);
  status.running = true;
  status.last_run = new Date().toISOString();
  try {
    // One tab at a time: Apps Script handles parallel calls poorly.
    const properties = await fetchTab(cfg, cfg.SHEET_PROPERTIES_GID);
    const rentToRent = await fetchTab(cfg, cfg.SHEET_RENT_TO_RENT_GID);
    const compliance = await fetchTab(cfg, cfg.SHEET_COMPLIANCE_GID);
    const sales = await fetchTab(cfg, cfg.SHEET_SALES_GID);
    const tenants = await fetchTab(cfg, cfg.SHEET_TENANTS_GID);
    const payload = buildPayload({ properties, rentToRent, compliance, sales, tenants });

    // A sheet that comes back empty is far more likely a publishing problem
    // than a sold-off portfolio: never wipe the database on it.
    if (cfg.SHEET_PROPERTIES_GID && payload.properties.length === 0) {
      throw new Error("The Properties tab came back empty; nothing was changed.");
    }

    if (cfg.SHEET_PROPERTIES_GID) {
      const existing = new Map<string, number>();
      const rows = await query<{ id: number; ref: string | null; address: string | null }>(
        "SELECT id, ref, address FROM properties",
      );
      for (const r of rows) existing.set(keyOf(r.ref, r.address), r.id);
      const seen = new Set<number>();

      for (const p of payload.properties) {
        const vals = PROPERTY_COLUMNS.map((c) => (p[c] === undefined ? null : p[c]));
        const id = existing.get(keyOf(p.ref, p.address));
        if (id) {
          seen.add(id);
          await run(`UPDATE properties SET ${PROPERTY_COLUMNS.map((c) => `${c} = ?`).join(", ")} WHERE id = ?`, [...vals, id]);
          await run(
            "UPDATE units SET market_rent = ?, status = CASE WHEN ? = 'vacant' THEN 'vacant' ELSE 'occupied' END WHERE property_id = ? AND name = 'Whole property'",
            [p.rent_in ?? 0, p.occupancy ?? "occupied", id],
          );
        } else {
          const r = await run(
            `INSERT INTO properties (${PROPERTY_COLUMNS.join(", ")}) VALUES (${PROPERTY_COLUMNS.map(() => "?").join(", ")})`,
            vals,
          );
          seen.add(r.lastInsertRowid);
          await run(
            "INSERT INTO units (property_id, name, bedrooms, bathrooms, market_rent, status) VALUES (?, 'Whole property', ?, 1, ?, ?)",
            [r.lastInsertRowid, p.bedrooms ?? 1, p.rent_in ?? 0, p.occupancy === "vacant" ? "vacant" : "occupied"],
          );
        }
      }
      for (const id of existing.values()) {
        if (!seen.has(id)) await run("DELETE FROM properties WHERE id = ?", [id]);
      }
    }

    if (cfg.SHEET_TENANTS_GID) {
      const ids = new Map<string, number>();
      for (const r of await query<{ id: number; ref: string | null }>("SELECT id, ref FROM properties WHERE ref IS NOT NULL")) {
        ids.set(String(r.ref).trim().toLowerCase(), r.id);
      }
      await run("DELETE FROM rooms");
      for (const room of payload.rooms) {
        const pid = ids.get(String(room.ref ?? "").trim().toLowerCase());
        if (!pid) continue;
        await run(
          `INSERT INTO rooms (property_id, ${ROOM_COLUMNS.join(", ")}) VALUES (?, ${ROOM_COLUMNS.map(() => "?").join(", ")})`,
          [pid, ...ROOM_COLUMNS.map((c) => (room[c] === undefined ? null : room[c]))],
        );
      }
    }

    if (cfg.SHEET_SALES_GID) {
      await run("DELETE FROM sales_leads");
      for (const l of payload.leads) {
        await run(
          `INSERT INTO sales_leads (${LEAD_COLUMNS.join(", ")}) VALUES (${LEAD_COLUMNS.map(() => "?").join(", ")})`,
          LEAD_COLUMNS.map((c) => (l[c] === undefined ? null : l[c])),
        );
      }
    }

    const counts = await get<{ p: number; l: number }>(
      "SELECT (SELECT COUNT(*) FROM properties) AS p, (SELECT COUNT(*) FROM sales_leads) AS l, (SELECT COUNT(*) FROM rooms) AS r",
    );
    status.rooms = Number((counts as { r?: number } | undefined)?.r ?? 0);
    status.properties = Number(counts?.p ?? 0);
    status.leads = Number(counts?.l ?? 0);
    status.last_success = new Date().toISOString();
    status.error = null;
  } catch (err) {
    status.error = (err as Error).message;
    throw err;
  } finally {
    status.running = false;
  }
  return syncStatus(cfg);
}
