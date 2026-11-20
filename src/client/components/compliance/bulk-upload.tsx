import { useRef, useState } from "react";
import { CheckCircle2, CircleAlert, Sparkles, Upload } from "lucide-react";
import { api } from "@/api";
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
  state: "reading" | "ready" | "uploading" | "done" | "duplicate" | "error";
  error?: string;
  reading?: Reading;
  readError?: string;
  /** Also set the home's own certificate date (what the Safety certificates page shows). */
  updateHome: boolean;
}

interface Reading {
  kind: DocKind | null;
  property_ref: string | null;
  address_on_document: string | null;
  issue_date: string | null;
  expiry_date: string | null;
  expiry_worked_out: boolean;
  company: string | null;
  result: "pass" | "fail" | "unsatisfactory" | "n/a" | null;
  problems: string[];
}

const HOME_FIELD: Partial<Record<DocKind, string>> = { gas: "gas_expiry", eicr: "eicr_expiry", epc: "epc_expiry", licence: "licence_expiry", insurance: "insurance_expiry" };
const ukDate = (iso: string) => new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });

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
  let iso = name.match(/expires?\s*(\d{4}-\d{2}-\d{2})/i)?.[1] ?? "";
  const ukDate = /(?:expiry|expires?|exp)\D{0,3}(\d{1,2})[-./ ](\d{1,2})[-./ ](\d{2,4})/i.exec(name);
  if (!iso && ukDate) {
    const y = ukDate[3].length === 2 ? `20${ukDate[3]}` : ukDate[3];
    iso = `${y}-${ukDate[2].padStart(2, "0")}-${ukDate[1].padStart(2, "0")}`;
  }
  return { propertyId: id ? String(id) : "", kind, expiry: iso };
}

/** Upload many certificates at once; each row says where it will be filed. */
export function BulkUploadDialog({ open, onClose }: { open: boolean; onClose: (changed: boolean) => void }) {
  const { properties, refreshLookups } = useApp();
  const input = useRef<HTMLInputElement>(null);
  const [rows, setRowsState] = useState<Row[]>([]);
  // The latest rows, so reads that finish later land on the right line.
  const rowsRef = useRef<Row[]>([]);
  const setRows = (next: Row[] | ((r: Row[]) => Row[])) => {
    rowsRef.current = typeof next === "function" ? next(rowsRef.current) : next;
    setRowsState(rowsRef.current);
  };
  const [busy, setBusy] = useState(false);
  const [changed, setChanged] = useState(false);
  const [dragging, setDragging] = useState(false);

  const refToId = new Map(properties.filter((p) => p.ref).map((p) => [String(p.ref).toLowerCase(), p.id]));
  const sorted = [...properties].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));

  function add(files: FileList | File[]) {
    const list = [...files];
    const next: Row[] = list.map((file) => {
      const guess = parseName(file.name, refToId);
      const complete = !!(guess.propertyId && guess.kind && (guess.expiry || guess.kind === "other"));
      return { file, ...guess, state: complete ? "ready" : "reading", updateHome: true };
    });
    const start = rowsRef.current.length;
    rowsRef.current = [...rowsRef.current, ...next];
    setRows(rowsRef.current);
    // Read the ones the file name didn't fully explain, one after another.
    void (async () => {
      for (let k = 0; k < next.length; k++) if (next[k].state === "reading") await readOne(start + k, next[k]);
    })();
  }
  const update = (i: number, patch: Partial<Row>) => setRows((r) => r.map((x, j) => (j === i ? { ...x, ...patch } : x)));

  async function readOne(i: number, row: Row) {
    const form = new FormData();
    form.append("file", row.file);
    try {
      const res = await fetch("/api/documents/read", { method: "POST", body: form });
      const json = (await res.json().catch(() => ({}))) as { reading?: Reading; error?: string };
      if (!res.ok || !json.reading) throw new Error(json.error || `Couldn't read it (${res.status})`);
      const r = json.reading;
      update(i, {
        state: "ready",
        reading: r,
        propertyId: row.propertyId || (r.property_ref ? String(refToId.get(r.property_ref.toLowerCase()) ?? "") : ""),
        kind: row.kind || r.kind || "",
        expiry: row.expiry || r.expiry_date || "",
      });
    } catch (err) {
      update(i, { state: "ready", readError: (err as Error).message });
    }
  }

  const ready = rows.filter((r) => r.state === "ready" || r.state === "error");
  const reading = rows.filter((r) => r.state === "reading").length;
  const unsorted = ready.filter((r) => !r.propertyId || !r.kind).length;

  async function uploadAll() {
    setBusy(true);
    for (let i = 0; i < rows.length; i++) {
      const r = rows[i];
      if (!(r.state === "ready" || r.state === "error") || !r.propertyId || !r.kind) continue;
      update(i, { state: "uploading", error: undefined });
      try {
        const res = await upload(Number(r.propertyId), r.kind, r.file, r.kind === "other" ? "" : r.expiry);
        const field = HOME_FIELD[r.kind];
        if (r.updateHome && field && r.expiry) {
          await api("PUT", `/api/properties/${r.propertyId}`, { [field]: r.expiry });
        }
        update(i, { state: res.duplicate ? "duplicate" : "done" });
        setChanged(true);
      } catch (err) {
        update(i, { state: "error", error: (err as Error).message });
      }
    }
    setBusy(false);
    void refreshLookups().catch(() => {});
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
        <DialogHeader><DialogTitle>Add certificates</DialogTitle></DialogHeader>
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
            PDFs or photos. On a phone you can take a photo of the certificate. Jarvis reads each one and fills in the home, the type and the expiry date for you to check.
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
                      <td className="max-w-[18rem] py-1.5 pr-2 align-top">
                        <div className="truncate" title={r.file.name}>{r.file.name}</div>
                        {r.state === "reading" && <div className="flex items-center gap-1 text-xs text-primary"><Sparkles className="size-3.5 animate-pulse" /> Jarvis is reading it…</div>}
                        {r.reading && (
                          <div className="text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1 text-success"><Sparkles className="size-3.5" /> Read by Jarvis</span>
                            {r.reading.company ? ` · ${r.reading.company}` : ""}
                            {r.reading.issue_date ? ` · done ${ukDate(r.reading.issue_date)}` : ""}
                            {!r.reading.property_ref && r.reading.address_on_document ? <div>Address on it: {r.reading.address_on_document}. Pick the home.</div> : null}
                            {r.reading.expiry_worked_out && r.reading.expiry_date ? <div>No expiry printed: worked out from the date it was done.</div> : null}
                          </div>
                        )}
                        {(r.reading?.result === "fail" || r.reading?.result === "unsatisfactory" || !!r.reading?.problems.length) && (
                          <div className="mt-1 rounded-md bg-destructive-tint px-2 py-1 text-xs text-destructive">
                            {r.reading?.result === "fail" || r.reading?.result === "unsatisfactory" ? <b>{r.reading.result === "fail" ? "Failed. " : "Unsatisfactory. "}</b> : null}
                            {r.reading?.problems.join(" · ")}
                          </div>
                        )}
                        {r.readError && <div className="text-xs text-warning">{r.readError}</div>}
                      </td>
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
                        {r.kind && HOME_FIELD[r.kind as DocKind] && r.expiry && (
                          <label className="mt-1 flex items-center gap-1.5 text-xs text-muted-foreground">
                            <input type="checkbox" disabled={locked} checked={r.updateHome} onChange={(e) => update(i, { updateHome: e.target.checked })} />
                            Update the home's date
                          </label>
                        )}
                      </td>
                      <td className="py-1.5 text-xs">
                        {r.state === "done" && <span className="inline-flex items-center gap-1 text-success"><CheckCircle2 className="size-4" /> Uploaded</span>}
                        {r.state === "duplicate" && <span className="inline-flex items-center gap-1 text-muted-foreground"><CheckCircle2 className="size-4" /> Already there</span>}
                        {r.state === "uploading" && <span className="text-muted-foreground">Uploading…</span>}
                        {r.state === "error" && <span className="inline-flex items-center gap-1 text-destructive" title={r.error}><CircleAlert className="size-4" /> {r.error}</span>}
                        {r.state === "ready" && !locked && reading === 0 && (
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
              {reading ? `Jarvis is reading ${reading}… ` : ""}
              {unsorted ? `${unsorted} still need a home or type. ` : ""}
              Check what Jarvis filled in, then upload. If the home's date also lives in the Google Sheet, update it there too.
            </p>
            <div className="flex gap-2">
              <Button variant="ghost" onClick={close} disabled={busy}>{done ? "Done" : "Cancel"}</Button>
              <Button onClick={uploadAll} disabled={busy || reading > 0 || ready.length - unsorted === 0}>
                <Upload className="h-4 w-4" /> {busy ? "Uploading…" : `Upload ${ready.length - unsorted}`}
              </Button>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
