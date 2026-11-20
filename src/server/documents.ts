// Compliance documents: the actual certificates (gas safety, EICR, EPC,
// licence, insurance…) uploaded against each property.
//
// File bytes live on the server's disk (Render: next to the database on the
// persistent disk), never in the database or the repository. The store is
// installed by src/server/node.ts with setDocumentStore; without one (e.g.
// on Cloudflare) the routes say uploads aren't available.
//
// Everything sits behind the sign-in like the rest of the app.

import type { Hono } from "hono";
import { get, query, run } from "./db";
import { getUser } from "./auth";
import { readCertificate } from "./cert-reader";

export interface DocumentStore {
  put(name: string, bytes: Uint8Array): Promise<void>;
  get(name: string): Promise<Uint8Array | null>;
  remove(name: string): Promise<void>;
}

let store: DocumentStore | null = null;
export function setDocumentStore(s: DocumentStore): void {
  store = s;
}

export const COMPLIANCE_KINDS = ["gas", "eicr", "epc", "licence", "insurance", "other"] as const;
/** Photos and reports kept for each home, plus photos tenants send with a repair request. */
export const MEDIA_KINDS = ["photo", "inventory", "checkin", "checkout", "repair"] as const;
/** Signed tenancy agreements, notices and letters (Letters & contracts). */
export const LEGAL_KINDS = ["agreement", "notice", "letter"] as const;
/** Mortgage statements, offers and other loan paperwork (Mortgages). */
export const MORTGAGE_KINDS = ["mortgage_statement", "mortgage_offer", "mortgage_other"] as const;
export const DOC_KINDS = [...COMPLIANCE_KINDS, ...MEDIA_KINDS, ...LEGAL_KINDS, ...MORTGAGE_KINDS] as const;
export type DocKind = (typeof DOC_KINDS)[number];

const MAX_BYTES = 20 * 1024 * 1024;

/** What we accept, by extension → the type we serve it back as. */
const TYPES: Record<string, string> = {
  pdf: "application/pdf",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
  heic: "image/heic",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};
/** Shown in the browser; anything else downloads. */
const INLINE = new Set(["application/pdf", "image/jpeg", "image/png", "image/webp"]);

export interface DocRow {
  id: number;
  property_id: number;
  kind: DocKind;
  filename: string;
  content_type: string;
  size: number;
  stored_name: string;
  expiry_date: string | null;
  label: string | null;
  taken_on: string | null;
  work_order_id: number | null;
  letter_id?: number | null;
  mortgage_id?: number | null;
  uploaded_by: string | null;
  created_at: string;
}

export const publicRow = ({ stored_name: _s, ...rest }: DocRow) => rest;

/**
 * Check and store one uploaded file. Shared by the signed-in upload and the
 * public repair form; returns an error message instead of throwing.
 */
export async function saveUpload(
  file: File,
  row: { property_id: number; kind: DocKind; expiry_date?: string | null; label?: string | null; taken_on?: string | null; work_order_id?: number | null; letter_id?: number | null; mortgage_id?: number | null; uploaded_by?: string | null },
  opts: { maxBytes?: number; imagesOnly?: boolean } = {},
): Promise<{ ok: true; document: DocRow; duplicate?: boolean } | { ok: false; status: 400 | 413 | 415 | 503; error: string }> {
  if (!store) return { ok: false, status: 503, error: "Uploads aren't available on this server." };
  const max = opts.maxBytes ?? MAX_BYTES;
  if (file.size > max) return { ok: false, status: 413, error: `That file is over ${Math.round(max / 1024 / 1024)} MB. Try a smaller photo or scan.` };
  if (file.size === 0) return { ok: false, status: 400, error: "That file is empty." };
  const ext = (file.name.split(".").pop() ?? "").toLowerCase();
  const type = TYPES[ext];
  if (!type || (opts.imagesOnly && !type.startsWith("image/"))) {
    return { ok: false, status: 415, error: opts.imagesOnly ? "Send a photo (JPG, PNG or HEIC)." : "Upload a PDF, photo (JPG, PNG, HEIC) or Word document." };
  }
  const cleanName = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 150) || `document.${ext}`;
  // The same file uploaded twice (e.g. a bulk upload run again) is kept once.
  const dupe = await get<DocRow>(
    "SELECT * FROM compliance_documents WHERE property_id = ? AND kind = ? AND filename = ? AND size = ?",
    [row.property_id, row.kind, cleanName, file.size],
  );
  if (dupe && !row.work_order_id && !row.letter_id && !row.mortgage_id) return { ok: true, document: dupe, duplicate: true };
  const stored = randomName(ext);
  await store.put(stored, new Uint8Array(await file.arrayBuffer()));
  const r = await run(
    `INSERT INTO compliance_documents (property_id, kind, filename, content_type, size, stored_name, expiry_date, label, taken_on, work_order_id, letter_id, mortgage_id, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.property_id, row.kind, cleanName, type, file.size, stored, row.expiry_date || null, row.label || null, row.taken_on || null, row.work_order_id ?? null, row.letter_id ?? null, row.mortgage_id ?? null, row.uploaded_by ?? null],
  );
  return { ok: true, document: (await get<DocRow>("SELECT * FROM compliance_documents WHERE id = ?", [r.lastInsertRowid]))! };
}

const randomName = (ext: string) => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}.${ext}`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const CERT_FIELD: Record<string, string> = { gas: "gas_expiry", eicr: "eicr_expiry", epc: "epc_expiry", licence: "licence_expiry", insurance: "insurance_expiry" };

/**
 * A certificate's file is the evidence; the home's own date drives the
 * Certificates page, the to-do list and reminders. Whenever a certificate
 * with a LATER expiry is on file, move the home's date up to match. Never
 * moves a date backwards. Pass a property to do just that home.
 */
export async function applyCertificateDates(propertyId?: number) {
  let changed = 0;
  for (const [kind, field] of Object.entries(CERT_FIELD)) {
    const r = await run(
      `UPDATE properties SET ${field} = (
         SELECT MAX(d.expiry_date) FROM compliance_documents d WHERE d.property_id = properties.id AND d.kind = ? AND d.expiry_date IS NOT NULL
       )
       WHERE ${propertyId ? "id = ? AND " : ""}EXISTS (
         SELECT 1 FROM compliance_documents d WHERE d.property_id = properties.id AND d.kind = ? AND d.expiry_date IS NOT NULL
           AND d.expiry_date > COALESCE(properties.${field}, '')
       )`,
      propertyId ? [kind, propertyId, kind] : [kind, kind],
    ).catch(() => ({ changes: 0 }));
    changed += Number(r.changes) || 0;
  }
  return changed;
}

/**
 * Jarvis reads a stored certificate that has no expiry date, saves the date
 * on the document, and moves the home's date up if it's later. Returns the
 * date found (or null). Problems on the certificate are kept in its label.
 */
export async function readStoredCertificate(env: Record<string, unknown>, doc: DocRow): Promise<string | null> {
  if (!store || !CERT_FIELD[doc.kind] || doc.expiry_date || !String(env.ANTHROPIC_API_KEY ?? "").trim()) return null;
  const bytes = await store.get(doc.stored_name);
  if (!bytes) return null;
  const file = new File([bytes], doc.filename, { type: doc.content_type });
  const r = await readCertificate(env, file);
  if (!r.expiry_date) return null;
  const flag = r.result === "fail" || r.result === "unsatisfactory" ? `${r.result === "fail" ? "Failed" : "Unsatisfactory"}: ${r.problems.join("; ")}`.slice(0, 200) : null;
  await run("UPDATE compliance_documents SET expiry_date = ?, label = COALESCE(label, ?) WHERE id = ? AND expiry_date IS NULL", [r.expiry_date, flag, doc.id]);
  await applyCertificateDates(doc.property_id);
  return r.expiry_date;
}

/** Read every certificate on file that has no expiry date (newest first, up to `limit`). */
export async function readMissingCertificateDates(env: Record<string, unknown>, limit = 25) {
  const rows = await query<DocRow>(
    `SELECT * FROM compliance_documents WHERE expiry_date IS NULL AND kind IN (${Object.keys(CERT_FIELD).map((k) => `'${k}'`).join(", ")}) ORDER BY id DESC LIMIT ?`,
    [limit],
  ).catch(() => [] as DocRow[]);
  let found = 0;
  for (const d of rows) {
    try {
      if (await readStoredCertificate(env, d)) found++;
    } catch (err) {
      console.error(`Reading certificate ${d.id} (${d.filename}): ${(err as Error).message}`);
    }
  }
  return { checked: rows.length, found };
}

export function registerDocumentRoutes(app: Hono<any>) {
  const unavailable = { error: "Document uploads aren't available on this server." };

  /** Documents for one property, newest first. */
  app.get("/api/documents", async (c) => {
    const letter = parseInt(c.req.query("letter_id") ?? "", 10);
    if (Number.isFinite(letter)) {
      const rows = await query<DocRow>("SELECT * FROM compliance_documents WHERE letter_id = ? ORDER BY id", [letter]).catch(() => [] as DocRow[]);
      return c.json({ enabled: true, documents: rows.map(publicRow) });
    }
    const mortgage = parseInt(c.req.query("mortgage_id") ?? "", 10);
    if (Number.isFinite(mortgage)) {
      const rows = await query<DocRow>("SELECT * FROM compliance_documents WHERE mortgage_id = ? ORDER BY COALESCE(taken_on, created_at) DESC, id DESC", [mortgage]).catch(() => [] as DocRow[]);
      return c.json({ enabled: !!store, documents: rows.map(publicRow) });
    }
    const wo = parseInt(c.req.query("work_order_id") ?? "", 10);
    if (Number.isFinite(wo)) {
      const rows = await query<DocRow>("SELECT * FROM compliance_documents WHERE work_order_id = ? ORDER BY id", [wo]).catch(() => [] as DocRow[]);
      return c.json({ enabled: !!store, documents: rows.map(publicRow) });
    }
    const pid = parseInt(c.req.query("property_id") ?? "", 10);
    if (!Number.isFinite(pid)) return c.json({ error: "property_id is required" }, 400);
    const rows = await query<DocRow>("SELECT * FROM compliance_documents WHERE property_id = ? ORDER BY COALESCE(taken_on, created_at) DESC, id DESC", [pid]).catch(() => [] as DocRow[]);
    return c.json({ enabled: !!store, documents: rows.map(publicRow) });
  });

  /** The document vault: every document, newest first, with its home. Optional ?q= search and ?property_id=. */
  app.get("/api/documents/all", async (c) => {
    const where: string[] = [];
    const params: unknown[] = [];
    const q = (c.req.query("q") ?? "").trim();
    if (q) {
      const like = `%${q}%`;
      where.push("(d.filename LIKE ? OR d.label LIKE ? OR p.name LIKE ? OR p.address LIKE ? OR p.ref = ? OR p.zip LIKE ?)");
      params.push(like, like, like, like, q.replace(/^ref\s*/i, ""), like);
    }
    const pid = parseInt(c.req.query("property_id") ?? "", 10);
    if (Number.isFinite(pid)) { where.push("d.property_id = ?"); params.push(pid); }
    const rows = await query<DocRow & { property_ref: string | null; property_name: string | null }>(
      `SELECT d.*, p.ref AS property_ref, p.name AS property_name FROM compliance_documents d LEFT JOIN properties p ON p.id = d.property_id
       ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY COALESCE(d.taken_on, d.created_at) DESC, d.id DESC LIMIT 500`,
      params,
    ).catch(() => []);
    return c.json({ enabled: !!store, documents: rows.map(publicRow) });
  });

  /** How many documents each property has, per kind (for the Compliance table). */
  app.get("/api/documents/summary", async (c) => {
    const rows = await query<{ property_id: number; kind: string; n: number }>(
      `SELECT property_id, kind, COUNT(*) AS n FROM compliance_documents WHERE kind IN (${COMPLIANCE_KINDS.map((k) => `'${k}'`).join(", ")}) GROUP BY property_id, kind`,
    ).catch(() => []);
    const out: Record<number, Record<string, number>> = {};
    for (const r of rows) (out[r.property_id] ??= {})[r.kind] = Number(r.n);
    return c.json({ enabled: !!store, counts: out });
  });

  app.post("/api/documents", async (c) => {
    if (!store) return c.json(unavailable, 503);
    let body: Record<string, unknown>;
    try {
      body = (await c.req.parseBody()) as Record<string, unknown>;
    } catch {
      return c.json({ error: "Couldn't read the upload." }, 400);
    }
    const file = body.file;
    if (!(file instanceof File)) return c.json({ error: "Choose a file to upload." }, 400);
    const pid = parseInt(String(body.property_id ?? ""), 10);
    if (!Number.isFinite(pid) || !(await get("SELECT id FROM properties WHERE id = ?", [pid]))) {
      return c.json({ error: "Unknown property." }, 400);
    }
    const kind = String(body.kind ?? "") as DocKind;
    if (!DOC_KINDS.includes(kind)) return c.json({ error: "Choose what kind of document it is." }, 400);
    const expiry = String(body.expiry_date ?? "").trim();
    if (expiry && !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) return c.json({ error: "Expiry date must be a date." }, 400);
    const takenOn = String(body.taken_on ?? "").trim();
    if (takenOn && !/^\d{4}-\d{2}-\d{2}$/.test(takenOn)) return c.json({ error: "The date must be a date." }, 400);
    const mortgageId = parseInt(String(body.mortgage_id ?? ""), 10);
    if (Number.isFinite(mortgageId)) {
      const m = await get<{ property_id: number | null }>("SELECT property_id FROM mortgages WHERE id = ?", [mortgageId]);
      if (!m || m.property_id !== pid) return c.json({ error: "That mortgage isn't linked to this home." }, 400);
    }
    const res = await saveUpload(file, {
      property_id: pid,
      mortgage_id: Number.isFinite(mortgageId) ? mortgageId : null,
      kind,
      expiry_date: expiry || null,
      label: String(body.label ?? "").trim().slice(0, 200) || null,
      taken_on: takenOn || null,
      letter_id: Number.isFinite(parseInt(String(body.letter_id ?? ""), 10)) ? parseInt(String(body.letter_id), 10) : null,
      uploaded_by: getUser(c)?.name ?? null,
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
    if (CERT_FIELD[kind] && expiry) await applyCertificateDates(pid);
    // No date typed in: Jarvis reads it off the certificate.
    let read: string | null = null;
    if (CERT_FIELD[kind] && !expiry && !res.duplicate) {
      read = await readStoredCertificate(c.env as Record<string, unknown>, res.document).catch((err) => {
        console.error(`Reading uploaded certificate: ${(err as Error).message}`);
        return null;
      });
      if (read) res.document.expiry_date = read;
    }
    return c.json({ document: publicRow(res.document), ...(res.duplicate ? { duplicate: true } : {}) }, res.duplicate ? 200 : 201);
  });

  app.get("/api/documents/:id/file", async (c) => {
    if (!store) return c.json(unavailable, 503);
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = Number.isFinite(id) ? await get<DocRow>("SELECT * FROM compliance_documents WHERE id = ?", [id]) : undefined;
    if (!row) return c.json({ error: "Document not found." }, 404);
    const bytes = await store.get(row.stored_name);
    if (!bytes) return c.json({ error: "The file is missing from the server." }, 404);
    const download = c.req.query("download") === "1" || !INLINE.has(row.content_type);
    const ascii = row.filename.replace(/[^\x20-\x7e]+/g, "_").replace(/"/g, "'");
    return new Response(bytes, {
      headers: {
        "Content-Type": row.content_type,
        "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${ascii}"; filename*=UTF-8''${encodeURIComponent(row.filename)}`,
        "X-Content-Type-Options": "nosniff",
        // Images can't run anything; PDFs need the browser's viewer, which a sandbox blocks.
        ...(row.content_type.startsWith("image/") ? { "Content-Security-Policy": "sandbox; default-src 'none'; img-src 'self'" } : {}),
        "Cache-Control": "private, no-store",
      },
    });
  });

  app.delete("/api/documents/:id", async (c) => {
    if (!store) return c.json(unavailable, 503);
    const id = parseInt(c.req.param("id") ?? "", 10);
    const row = Number.isFinite(id) ? await get<DocRow>("SELECT * FROM compliance_documents WHERE id = ?", [id]) : undefined;
    if (!row) return c.json({ error: "Document not found." }, 404);
    await run("DELETE FROM compliance_documents WHERE id = ?", [id]);
    await store.remove(row.stored_name).catch(() => {});
    return c.json({ ok: true });
  });
}
