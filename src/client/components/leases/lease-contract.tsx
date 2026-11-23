import { useCallback, useEffect, useRef, useState } from "react";
import { FileSignature, Link2, Paperclip, Unlink, Upload } from "lucide-react";
import { api } from "@/api";
import { formatDate } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Doc {
  id: number;
  kind: string;
  filename: string;
  label: string | null;
  taken_on: string | null;
  lease_id?: number | null;
  created_at: string;
}

const ACCEPT = ".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*";
const CONTRACT_KINDS = new Set(["agreement", "notice", "letter", "other"]);

/**
 * The signed contract for one tenancy (AST or company let): open it, upload
 * it, or pick one that's already in the home's documents.
 */
export function LeaseContract({ leaseId, propertyId }: { leaseId: number; propertyId: number | null | undefined }) {
  const [attached, setAttached] = useState<Doc[] | null>(null);
  const [onFile, setOnFile] = useState<Doc[]>([]);
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const load = useCallback(() => {
    api<{ documents: Doc[] }>("GET", `/api/documents?lease_id=${leaseId}`)
      .then((r) => setAttached(r.documents))
      .catch(() => setAttached([]));
    if (propertyId) {
      api<{ documents: Doc[] }>("GET", `/api/documents?property_id=${propertyId}`)
        .then((r) => setOnFile(r.documents.filter((d) => CONTRACT_KINDS.has(d.kind) && d.lease_id !== leaseId)))
        .catch(() => setOnFile([]));
    }
  }, [leaseId, propertyId]);
  useEffect(load, [load]);

  async function upload(files: FileList | null) {
    if (!files?.length || !propertyId) return;
    setBusy(true);
    setMsg(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        form.append("property_id", String(propertyId));
        form.append("lease_id", String(leaseId));
        form.append("kind", "agreement");
        form.append("label", "Tenancy contract");
        const r = await fetch("/api/documents", { method: "POST", body: form });
        if (r.status === 401) window.location.reload();
        if (!r.ok) {
          const d = (await r.json().catch(() => null)) as { error?: string } | null;
          throw new Error(`${file.name}: ${d?.error || `upload failed (${r.status})`}`);
        }
      }
      load();
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function link(doc: Doc, to: number | null) {
    setMsg(null);
    try {
      await api("PUT", `/api/documents/${doc.id}/lease`, { lease_id: to });
      setPicking(false);
      load();
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <fieldset className="grid gap-2 rounded-lg border p-3">
      <legend className="section-label px-1">Contract (AST or company let)</legend>
      {attached === null ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : attached.length === 0 ? (
        <p className="text-sm text-muted-foreground">No contract attached yet.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {attached.map((d) => (
            <li key={d.id} className="flex items-center gap-2 px-3 py-2 text-sm">
              <FileSignature className="size-4 shrink-0 text-primary" />
              <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate font-medium hover:underline">
                {d.label || d.filename}
              </a>
              <Button type="button" size="sm" variant="ghost" title="Detach from this tenancy (the file stays in Documents)" onClick={() => link(d, null)}>
                <Unlink className="size-3.5" />
              </Button>
            </li>
          ))}
        </ul>
      )}

      {propertyId ? (
        <div className="flex flex-wrap gap-2">
          <input ref={fileRef} type="file" accept={ACCEPT} multiple hidden onChange={(e) => upload(e.target.files)} />
          <Button type="button" size="sm" variant="outline" disabled={busy} onClick={() => fileRef.current?.click()}>
            <Upload className="size-3.5" /> {busy ? "Uploading…" : "Upload contract"}
          </Button>
          {onFile.length > 0 && (
            <Button type="button" size="sm" variant="outline" onClick={() => setPicking((v) => !v)}>
              <Link2 className="size-3.5" /> Attach from this home's documents ({onFile.length})
            </Button>
          )}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">Save the tenancy with a unit first.</p>
      )}

      {picking && (
        <ul className="max-h-56 divide-y overflow-y-auto rounded-md border">
          {onFile.map((d) => (
            <li key={d.id}>
              <button type="button" className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent" onClick={() => link(d, leaseId)}>
                <Paperclip className="size-3.5 shrink-0 text-muted-foreground" />
                <span className="min-w-0 flex-1 truncate">{d.label || d.filename}</span>
                <span className="shrink-0 text-xs text-muted-foreground">
                  {d.lease_id ? "on another tenancy" : d.taken_on ? formatDate(d.taken_on) : formatDate(d.created_at.slice(0, 10))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
      {msg && <p className="text-sm text-destructive">{msg}</p>}
    </fieldset>
  );
}
