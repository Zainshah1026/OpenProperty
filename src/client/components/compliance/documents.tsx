import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Paperclip, Trash2, Upload } from "lucide-react";
import { useApp } from "@/context";
import { formatDate } from "@/lib/utils";
import type { Property } from "@/types";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

export const DOC_KINDS = [
  { kind: "gas", label: "Gas safety certificate", short: "Gas safety", certKey: "gas_expiry" },
  { kind: "eicr", label: "Electrical certificate (EICR)", short: "EICR", certKey: "eicr_expiry" },
  { kind: "epc", label: "EPC", short: "EPC", certKey: "epc_expiry" },
  { kind: "licence", label: "Licence", short: "Licence", certKey: "licence_expiry" },
  { kind: "insurance", label: "Insurance", short: "Insurance", certKey: "insurance_expiry" },
  { kind: "other", label: "Other documents", short: "Other", certKey: null },
] as const;

export type DocKind = (typeof DOC_KINDS)[number]["kind"];

export interface DocumentRow {
  id: number;
  property_id: number;
  kind: DocKind;
  filename: string;
  content_type: string;
  size: number;
  expiry_date: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*";
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Upload with a plain multipart POST (the JSON api helper can't send files). */
async function upload(propertyId: number, kind: DocKind, file: File, expiry: string): Promise<void> {
  const form = new FormData();
  form.append("file", file);
  form.append("property_id", String(propertyId));
  form.append("kind", kind);
  if (expiry) form.append("expiry_date", expiry);
  const r = await fetch("/api/documents", { method: "POST", body: form });
  if (r.status === 401) window.location.reload();
  if (!r.ok) {
    const d = (await r.json().catch(() => null)) as { error?: string } | null;
    throw new Error(d?.error || `Upload failed (${r.status})`);
  }
}

/** All of one property's certificates and documents, with upload per type. */
export function DocumentsPanel({ property, onChanged }: { property: Property; onChanged?: () => void }) {
  const { setError } = useApp();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/documents?property_id=${property.id}`);
      const d = (await r.json()) as { enabled: boolean; documents: DocumentRow[] };
      setDocs(d.documents);
      setEnabled(d.enabled);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [property.id, setError]);

  useEffect(() => { load(); }, [load]);

  async function remove(d: DocumentRow) {
    try {
      const r = await fetch(`/api/documents/${d.id}`, { method: "DELETE" });
      if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error || "Couldn't delete it.");
      await load();
      onChanged?.();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  if (!docs) return <p className="py-6 text-center text-sm text-muted-foreground">Loading documents…</p>;
  if (!enabled) return <p className="text-sm text-muted-foreground">Document uploads aren't available on this server.</p>;

  return (
    <div className="grid gap-3">
      {DOC_KINDS.map((k) => (
        <KindSection
          key={k.kind}
          kind={k.kind}
          label={k.label}
          sheetExpiry={k.certKey ? (property[k.certKey] as string | null) : null}
          docs={docs.filter((d) => d.kind === k.kind)}
          propertyId={property.id}
          onUploaded={() => { load(); onChanged?.(); }}
          onDelete={setDeleting}
        />
      ))}
      <p className="text-xs text-muted-foreground">
        PDFs, photos or Word documents up to 20 MB. Files are kept privately on the server and only signed-in users can open them. Expiry dates on the Compliance page still come from the Google Sheet.
      </p>
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete ${deleting?.filename ?? "this document"}?`}
        description="The file is removed from the server. This cannot be undone."
        onConfirm={() => { if (deleting) remove(deleting); setDeleting(null); }}
      />
    </div>
  );
}

function KindSection({
  kind, label, sheetExpiry, docs, propertyId, onUploaded, onDelete,
}: {
  kind: DocKind; label: string; sheetExpiry: string | null; docs: DocumentRow[]; propertyId: number;
  onUploaded: () => void; onDelete: (d: DocumentRow) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [expiry, setExpiry] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  async function save() {
    if (!file) return;
    setBusy(true);
    setMsg(null);
    try {
      await upload(propertyId, kind, file, expiry);
      setFile(null);
      setExpiry("");
      if (input.current) input.current.value = "";
      onUploaded();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="rounded-md border p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold">{label}</h3>
          {sheetExpiry !== null && <p className="text-xs text-muted-foreground">Sheet says it expires {sheetExpiry ? formatDate(sheetExpiry) : "— not recorded"}</p>}
        </div>
        {!file && (
          <Button size="sm" variant="outline" onClick={() => input.current?.click()}>
            <Upload className="h-4 w-4" /> Upload
          </Button>
        )}
        <input
          ref={input}
          type="file"
          accept={ACCEPT}
          className="hidden"
          onChange={(e) => { setFile(e.target.files?.[0] ?? null); setMsg(null); }}
        />
      </div>

      {file && (
        <div className="mt-2 flex flex-wrap items-end gap-2 rounded-md bg-brand-tint p-2 text-sm">
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium"><Paperclip className="mr-1 inline size-3.5" />{file.name}</div>
            <div className="text-xs text-muted-foreground">{kb(file.size)}</div>
          </div>
          {kind !== "other" && (
            <label className="text-xs">
              <span className="mb-0.5 block text-muted-foreground">Expiry date on it (optional)</span>
              <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} className="h-8 w-40 bg-card" />
            </label>
          )}
          <Button size="sm" onClick={save} disabled={busy}>{busy ? "Uploading…" : "Save"}</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => { setFile(null); if (input.current) input.current.value = ""; }}>Cancel</Button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-destructive" role="alert">{msg}</p>}

      {docs.length > 0 && (
        <ul className="mt-2 divide-y text-sm">
          {docs.map((d, i) => (
            <li key={d.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-1.5">
              <FileText className="size-4 shrink-0 text-primary" aria-hidden />
              <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">
                {d.filename}
              </a>
              {i === 0 && docs.length > 1 && <span className="rounded bg-success-tint px-1.5 text-[11px] text-success">latest</span>}
              <span className="text-xs text-muted-foreground">
                {d.expiry_date ? `expires ${formatDate(d.expiry_date)} · ` : ""}{kb(d.size)} · {formatDate(d.created_at)}{d.uploaded_by ? ` · ${d.uploaded_by}` : ""}
              </span>
              <span className="flex gap-1">
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="rounded p-1 hover:bg-muted" aria-label="Open"><ExternalLink className="size-4" /></a>
                <a href={`/api/documents/${d.id}/file?download=1`} className="rounded p-1 hover:bg-muted" aria-label="Download"><Download className="size-4" /></a>
                <button type="button" onClick={() => onDelete(d)} className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Delete"><Trash2 className="size-4" /></button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/** The documents for a property, in a dialog (used from the Compliance table). */
export function DocumentsDialog({ property, onClose, onEditDates }: { property: Property | null; onClose: (changed: boolean) => void; onEditDates?: (p: Property) => void }) {
  const [changed, setChanged] = useState(false);
  useEffect(() => { if (property) setChanged(false); }, [property]);
  return (
    <Dialog open={!!property} onOpenChange={(o) => { if (!o) onClose(changed); }}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{property ? `${property.ref ? `${property.ref} · ` : ""}${property.name}` : ""}</DialogTitle>
        </DialogHeader>
        {property && onEditDates && (
          <button type="button" className="-mt-2 w-fit text-xs font-medium text-primary hover:underline" onClick={() => onEditDates(property)}>
            Edit expiry dates
          </button>
        )}
        {property && <DocumentsPanel property={property} onChanged={() => setChanged(true)} />}
      </DialogContent>
    </Dialog>
  );
}
