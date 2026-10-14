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

export const DOC_KINDS = ["gas", "eicr", "epc", "licence", "insurance", "other"] as const;
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
  uploaded_by: string | null;
  created_at: string;
}

const publicRow = ({ stored_name: _s, ...rest }: DocRow) => rest;

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
    const pid = parseInt(c.req.query("property_id") ?? "", 10);
    if (!Number.isFinite(pid)) return c.json({ error: "property_id is required" }, 400);
    const rows = await query<DocRow>("SELECT * FROM compliance_documents WHERE property_id = ? ORDER BY created_at DESC, id DESC", [pid]).catch(() => [] as DocRow[]);
    return c.json({ enabled: !!store, documents: rows.map(publicRow) });
  });

  /** How many documents each property has, per kind (for the Compliance table). */
  app.get("/api/documents/summary", async (c) => {
    const rows = await query<{ property_id: number; kind: string; n: number }>(
      "SELECT property_id, kind, COUNT(*) AS n FROM compliance_documents GROUP BY property_id, kind",
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
    if (file.size > MAX_BYTES) return c.json({ error: "That file is over 20 MB. Try a smaller scan or a PDF." }, 413);
    if (file.size === 0) return c.json({ error: "That file is empty." }, 400);

    const ext = (file.name.split(".").pop() ?? "").toLowerCase();
    const type = TYPES[ext];
    if (!type) return c.json({ error: "Upload a PDF, photo (JPG, PNG, HEIC) or Word document." }, 415);

    // The same file uploaded twice (e.g. a bulk upload run again) is kept once.
    const cleanFirst = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 150) || `document.${ext}`;
    const dupe = await get<DocRow>(
      "SELECT * FROM compliance_documents WHERE property_id = ? AND kind = ? AND filename = ? AND size = ?",
      [pid, kind, cleanFirst, file.size],
    );
    if (dupe) return c.json({ document: publicRow(dupe), duplicate: true });

    const stored = randomName(ext);
    await store.put(stored, new Uint8Array(await file.arrayBuffer()));
    const cleanName = file.name.replace(/[\\/:*?"<>|\u0000-\u001f]+/g, "_").slice(0, 150) || `document.${ext}`;
    const r = await run(
      `INSERT INTO compliance_documents (property_id, kind, filename, content_type, size, stored_name, expiry_date, uploaded_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [pid, kind, cleanName, type, file.size, stored, expiry || null, getUser(c)?.name ?? null],
    );
    const row = await get<DocRow>("SELECT * FROM compliance_documents WHERE id = ?", [r.lastInsertRowid]);
    return c.json({ document: row ? publicRow(row) : null }, 201);
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
