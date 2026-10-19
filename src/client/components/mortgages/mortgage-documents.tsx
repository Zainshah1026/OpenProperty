import { useCallback, useEffect, useRef, useState } from "react";
import { Download, ExternalLink, FileText, Trash2, Upload } from "lucide-react";
import { api } from "@/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export const MORTGAGE_DOC_KINDS = [
  { kind: "mortgage_statement", label: "Statement" },
  { kind: "mortgage_offer", label: "Mortgage offer" },
  { kind: "mortgage_other", label: "Other" },
] as const;
type Kind = (typeof MORTGAGE_DOC_KINDS)[number]["kind"];
const KIND_LABEL: Record<string, string> = Object.fromEntries(MORTGAGE_DOC_KINDS.map((k) => [k.kind, k.label]));

interface Doc {
  id: number;
  kind: string;
  filename: string;
  size: number;
  label: string | null;
  taken_on: string | null;
  uploaded_by: string | null;
  created_at: string;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*";
const size = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const selectCls = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

/** Statements, the mortgage offer and other paperwork for one loan. */
export function MortgageDocuments({ mortgageId, propertyId, onChanged }: { mortgageId: number; propertyId: number | null; onChanged?: () => void }) {
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [kind, setKind] = useState<Kind>("mortgage_statement");
  const [dated, setDated] = useState("");
  const [label, setLabel] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [deleting, setDeleting] = useState<Doc | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ enabled: boolean; documents: Doc[] }>("GET", `/api/documents?mortgage_id=${mortgageId}`)
      .then((r) => { setDocs(r.documents); setEnabled(r.enabled); })
      .catch(() => setDocs([]));
  }, [mortgageId]);
  useEffect(load, [load]);

  async function uploadFiles(files: FileList | null) {
    if (!files?.length || !propertyId) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("property_id", String(propertyId));
        form.append("mortgage_id", String(mortgageId));
        form.append("kind", kind);
        if (dated) form.append("taken_on", dated);
        if (label.trim()) form.append("label", label.trim());
        const r = await fetch("/api/documents", { method: "POST", body: form });
        if (r.status === 401) window.location.reload();
        if (!r.ok) {
          const d = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(`${file.name}: ${d?.error || `upload failed (${r.status})`}`);
        }
      }
      setLabel("");
      setDated("");
      load();
      onChanged?.();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function remove(d: Doc) {
    try {
      await api("DELETE", `/api/documents/${d.id}`);
      load();
      onChanged?.();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <fieldset className="grid gap-3">
      <legend className="section-label mb-2">Documents</legend>
      {!propertyId ? (
        <p className="text-sm text-muted-foreground">Link this mortgage to a home and save to add statements and the mortgage offer.</p>
      ) : !enabled ? (
        <p className="text-sm text-muted-foreground">Document uploads aren't available on this server.</p>
      ) : (
        <>
          {docs === null ? (
            <p className="text-sm text-muted-foreground">Loading…</p>
          ) : docs.length === 0 ? (
            <p className="text-sm text-muted-foreground">No documents yet. Add the mortgage offer and each annual statement so they're to hand when you remortgage.</p>
          ) : (
            <ul className="divide-y rounded-lg border">
              {docs.map((d) => (
                <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <FileText className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="block truncate font-medium hover:underline">
                      {d.label || d.filename}
                    </a>
                    <span className="block truncate text-xs text-muted-foreground">
                      {KIND_LABEL[d.kind] ?? "Document"}
                      {d.taken_on ? ` · ${formatDate(d.taken_on)}` : ""} · {size(d.size)}
                      {d.label ? ` · ${d.filename}` : ""}
                    </span>
                  </span>
                  <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" aria-label={`Open ${d.filename}`} className="rounded p-1.5 hover:bg-muted">
                    <ExternalLink className="size-4 text-muted-foreground" />
                  </a>
                  <a href={`/api/documents/${d.id}/file?download=1`} aria-label={`Download ${d.filename}`} className="rounded p-1.5 hover:bg-muted">
                    <Download className="size-4 text-muted-foreground" />
                  </a>
                  <button type="button" onClick={() => setDeleting(d)} aria-label={`Delete ${d.filename}`} className="rounded p-1.5 hover:bg-muted">
                    <Trash2 className="size-4 text-muted-foreground" />
                  </button>
                </li>
              ))}
            </ul>
          )}

          <div className="grid gap-3 rounded-lg bg-muted/50 p-3 sm:grid-cols-3">
            <div>
              <Label className="mb-1 block" htmlFor="mgd-kind">Type</Label>
              <select id="mgd-kind" className={selectCls} value={kind} onChange={(e) => setKind(e.target.value as Kind)}>
                {MORTGAGE_DOC_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.label}</option>)}
              </select>
            </div>
            <div>
              <Label className="mb-1 block" htmlFor="mgd-date">{kind === "mortgage_statement" ? "Statement date" : "Date"}</Label>
              <Input id="mgd-date" type="date" value={dated} onChange={(e) => setDated(e.target.value)} />
            </div>
            <div>
              <Label className="mb-1 block" htmlFor="mgd-label">Name (optional)</Label>
              <Input id="mgd-label" value={label} placeholder={kind === "mortgage_statement" ? "e.g. Annual statement 2026" : ""} onChange={(e) => setLabel(e.target.value)} />
            </div>
            <div className="sm:col-span-3">
              <input ref={fileRef} type="file" accept={ACCEPT} multiple className="hidden" onChange={(e) => uploadFiles(e.target.files)} />
              <Button type="button" variant="secondary" disabled={busy} onClick={() => fileRef.current?.click()}>
                <Upload /> {busy ? "Uploading…" : "Upload files"}
              </Button>
              <span className="ml-3 text-xs text-muted-foreground">PDF, photo or Word, up to 20 MB each.</span>
            </div>
          </div>
          {msg && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{msg}</p>}
        </>
      )}
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title={`Delete ${deleting?.label || deleting?.filename || "this document"}?`}
        description="The file is removed for good."
        onConfirm={() => { if (deleting) remove(deleting); setDeleting(null); }}
      />
    </fieldset>
  );
}
