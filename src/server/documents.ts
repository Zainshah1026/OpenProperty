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
export const DOC_KINDS = [...COMPLIANCE_KINDS, ...MEDIA_KINDS, ...LEGAL_KINDS] as const;
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
  row: { property_id: number; kind: DocKind; expiry_date?: string | null; label?: string | null; taken_on?: string | null; work_order_id?: number | null; letter_id?: number | null; uploaded_by?: string | null },
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
  if (dupe && !row.work_order_id && !row.letter_id) return { ok: true, document: dupe, duplicate: true };
  const stored = randomName(ext);
  await store.put(stored, new Uint8Array(await file.arrayBuffer()));
  const r = await run(
    `INSERT INTO compliance_documents (property_id, kind, filename, content_type, size, stored_name, expiry_date, label, taken_on, work_order_id, letter_id, uploaded_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [row.property_id, row.kind, cleanName, type, file.size, stored, row.expiry_date || null, row.label || null, row.taken_on || null, row.work_order_id ?? null, row.letter_id ?? null, row.uploaded_by ?? null],
  );
  return { ok: true, document: (await get<DocRow>("SELECT * FROM compliance_documents WHERE id = ?", [r.lastInsertRowid]))! };
}

const randomName = (ext: string) => {
  const b = new Uint8Array(16);
  crypto.getRandomValues(b);
  return `${Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("")}.${ext}`;
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function registerDocumentRoutes(app: Hono<any>) {
  const unavailable = { error: "Document uploads aren't available on this server." };

  /** Documents for one property, newest first. */
  app.get("/api/documents", async (c) => {
    const letter = parseInt(c.req.query("letter_id") ?? "", 10);
    if (Number.isFinite(letter)) {
      const rows = await query<DocRow>("SELECT * FROM compliance_documents WHERE letter_id = ? ORDER BY id", [letter]).catch(() => [] as DocRow[]);
      return c.json({ enabled: true, documents: rows.map(publicRow) });
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
    const res = await saveUpload(file, {
      property_id: pid,
      kind,
      expiry_date: expiry || null,
      label: String(body.label ?? "").trim().slice(0, 200) || null,
      taken_on: takenOn || null,
      letter_id: Number.isFinite(parseInt(String(body.letter_id ?? ""), 10)) ? parseInt(String(body.letter_id), 10) : null,
      uploaded_by: getUser(c)?.name ?? null,
    });
    if (!res.ok) return c.json({ error: res.error }, res.status);
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
