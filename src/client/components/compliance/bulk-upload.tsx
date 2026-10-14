import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Upload } from "lucide-react";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DOC_KINDS, upload, type DocKind } from "./documents";

interface Row {
  file: File;
  propertyId: string; // "" = not chosen
  kind: DocKind | "";
  expiry: string;
  state: "ready" | "uploading" | "done" | "duplicate" | "error";
  error?: string;
}

const KIND_WORDS: [RegExp, DocKind][] = [
  [/gas|cp12/i, "gas"],
  [/eicr|electric/i, "eicr"],
  [/epc|energy performance/i, "epc"],
  [/licen[cs]e/i, "licence"],
  [/insurance/i, "insurance"],
  [/\bother\b|fire risk|\bfra\b/i, "other"],
];

/**
 * Read "Ref 15 - Gas Safety - expires 2027-05-06 - …" (how Claude names
 * certificates), falling back to guessing the type from the file name.
 */
function parseName(name: string, refToId: Map<string, number>): Pick<Row, "propertyId" | "kind" | "expiry"> {
  const ref = name.match(/^\s*ref\s*([a-z0-9]+)\b/i)?.[1]?.toLowerCase();
  const id = ref ? refToId.get(ref) : undefined;
  // "Ref 15 - Gas Safety - …": read the type from its own part first, so an
  // address can't be mistaken for one.
  const typePart = /^\s*ref\s*[a-z0-9]+\s*-\s*([^-]+)/i.exec(name)?.[1] ?? "";
  const kind = KIND_WORDS.find(([re]) => re.test(typePart))?.[1] ?? KIND_WORDS.find(([re]) => re.test(name))?.[1] ?? "";
  const iso = name.match(/expires?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
  return { propertyId: id ? String(id) : "", kind, expiry: iso };
}

/** Upload many certificates at once; each row says where it will be filed. */
export function BulkUploadDialog({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const { properties } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [dragging, setDragging] = useState(false);

  const refToId = new Map(properties.filter((p) => p.ref).map((p) => [String(p.ref).toLowerCase(), p.id]));
  const sorted = [...properties].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));

  function add(files: FileList | File[]) {
    const next = [...files].map((file) => ({ file, ...parseName(file.name, refToId), state: "ready" as const }));
    setRows((r) => [...r, ...next]);
  }
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  const ready = rows.filter((r) => r.state === "ready" || r.state === "error");
  const unsorted = ready.filter((r) => !r.propertyId || !r.kind).length;

  async function uploadAll() {
    setBusy(true);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!(r.state === "ready" || r.state === "error") || !r.propertyId || !r.kind) continue;
      update(i, { state: "uploading", error: undefined });
      try {
        const res = await upload(Number(r.propertyId), r.kind, r.file, r.kind === "other" ? "" : r.expiry);
        update(i, { state: res.duplicate ? "duplicate" : "done" });
        setChanged(true);
      } catch (err) {
        update(i, { state: "error", error: (err as Error).message });
      }
    }
    setBusy(false);
  }

  function close() {
    if (busy) return;
    onClose(changed);
    setRows([]);
    setChanged(false);
  }

  const done = rows.filter((r) => r.state === "done" || r.state === "duplicate").length;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) close(); }}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogHeader><DialogTitle>Upload certificates</DialogTitle></DialogHeader>
        <div
          onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
          onDragLeave={() => setDragging(false)}
          onDrop={(e) => { e.preventDefault(); setDragging(false); add(e.dataTransfer.files); }}
          className={cn("flex flex-col items-center gap-2 rounded-lg border-2 border-dashed p-6 text-center text-sm", dragging ? "border-primary bg-brand-tint" : "border-muted-foreground/30")}
        >
          <Upload className="size-6 text-primary" />
          <p><b>Drag certificates here</b>, or</p>
          <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>Choose files</Button>
          <p className="max-w-lg text-xs text-muted-foreground">
            Files named like <i>Ref 15 - Gas Safety - expires 2027-05-06 - …pdf</i> are filed automatically. For anything else, pick the property and type below.
          </p>
          <input ref={input} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*" className="hidden"
            onChange={(e) => { if (e.target.files) add(e.target.files); e.target.value = ""; }} />
        </div>

        {rows.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr><th className="py-2 pr-2 font-medium">File</th><th className="py-2 pr-2 font-medium">Property</th><th className="py-2 pr-2 font-medium">Type</th><th className="py-2 pr-2 font-medium">Expires</th><th className="py-2 font-medium" /></tr>
              </thead>
              <tbody className="divide-y">
                {rows.map((r, i) => {
                  const locked = r.state === "done" || r.state === "duplicate" || r.state === "uploading";
                  return (
                    <tr key={i} className={cn(!r.propertyId || !r.kind ? "bg-warning-tint/40" : "")}>
                      <td className="max-w-[16rem] truncate py-1.5 pr-2" title={r.file.name}>{r.file.name}</td>
                      <td className="py-1.5 pr-2">
                        <select disabled={locked} value={r.propertyId} onChange={(e) => update(i, { propertyId: e.target.value })} className="h-8 w-56 rounded-md border bg-card px-2 text-sm">
                          <option value="">Choose property…</option>
                          {sorted.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <select disabled={locked} value={r.kind} onChange={(e) => update(i, { kind: e.target.value as DocKind })} className="h-8 w-36 rounded-md border bg-card px-2 text-sm">
                          <option value="">Choose type…</option>
                          {DOC_KINDS.map((k) => <option key={k.kind} value={k.kind}>{k.short}</option>)}
                        </select>
                      </td>
                      <td className="py-1.5 pr-2">
                        <input type="date" disabled={locked || r.kind === "other"} value={r.expiry} onChange={(e) => update(i, { expiry: e.target.value })} className="h-8 rounded-md border bg-card px-2 text-sm" />
                      </td>
                      <td className="py-1.5 text-xs">
                        {r.state === "done" && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" /> Uploaded</span>}
                        {r.state === "duplicate" && <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="size-4" /> Already there</span>}
                        {r.state === "uploading" && <span className="text-muted-foreground">Uploading…</span>}
                        {r.state === "error" && <span className="inline-flex items-center gap-1 text-destructive" title={r.error}><CircleAlert className="size-4" /> {r.error}</span>}
                        {r.state === "ready" && !locked && (
                          <button type="button" className="text-muted-foreground hover:text-destructive" onClick={() => setRows(rows.filter((_, j) => j !== i))}>Remove</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {rows.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-xs text-muted-foreground">
              {done ? `${done} of ${rows.length} uploaded. ` : ""}
              {unsorted ? `${unsorted} still need a property or type. ` : ""}
              Expiry dates here are saved with the file; the Compliance table's dates come from the Google Sheet.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={close} disabled={busy}>{done ? "Done" : "Cancel"}</Button>
              <Button onClick={uploadAll} disabled={busy || ready.length - unsorted === 0}>
                <Upload className="h-4 w-4" /> {busy ? "Uploading…" : `Upload ${ready.length - unsorted}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
