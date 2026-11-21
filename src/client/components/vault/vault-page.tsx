import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Download, ExternalLink, FileText, Flame, FolderOpen, Image as ImageIcon, Landmark, Search, Sparkles, Umbrella, Upload } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";
import { BulkUploadDialog } from "@/components/compliance/bulk-upload";

interface Doc {
  id: number;
  property_id: number;
  property_ref: string | null;
  property_name: string | null;
  kind: string;
  filename: string;
  content_type: string;
  size: number;
  expiry_date: string | null;
  label: string | null;
  taken_on: string | null;
  uploaded_by: string | null;
  created_at: string;
}

/** Folders a person thinks in; each holds several of the server's document kinds. */
const FOLDERS = [
  { id: "certs", name: "Safety certificates", color: "var(--door-plum)", icon: Flame, kinds: ["gas", "eicr", "epc", "licence"] },
  { id: "insurance", name: "Insurance", color: "var(--door-teal)", icon: Umbrella, kinds: ["insurance"] },
  { id: "legal", name: "Tenancy & legal", color: "var(--door-blue)", icon: FileText, kinds: ["agreement", "notice", "letter"] },
  { id: "money", name: "Mortgages", color: "var(--door-green)", icon: Landmark, kinds: ["mortgage_statement", "mortgage_offer", "mortgage_other"] },
  { id: "photos", name: "Photos & inventories", color: "var(--door-teal)", icon: ImageIcon, kinds: ["photo", "inventory", "checkin", "checkout", "repair"] },
  { id: "other", name: "Everything else", color: "#8a90b8", icon: FolderOpen, kinds: ["other"] },
] as const;

const KIND_LABEL: Record<string, string> = {
  gas: "Gas safety", eicr: "EICR", epc: "EPC", licence: "Licence", insurance: "Insurance", other: "Other",
  agreement: "Tenancy agreement", notice: "Notice", letter: "Letter",
  mortgage_statement: "Mortgage statement", mortgage_offer: "Mortgage offer", mortgage_other: "Mortgage paper",
  photo: "Photo", inventory: "Inventory", checkin: "Check-in report", checkout: "Check-out report", repair: "Repair photo",
};

/** What you can file from here (certificates go through Jarvis's reader instead). */
const UPLOAD_KINDS = ["agreement", "notice", "letter", "inventory", "checkin", "checkout", "photo", "mortgage_statement", "mortgage_offer", "mortgage_other", "other"];

const folderOf = (kind: string) => FOLDERS.find((f) => (f.kinds as readonly string[]).includes(kind)) ?? FOLDERS[4];
const when = (d: Doc) => new Date((d.taken_on ?? d.created_at.slice(0, 10)) + "T12:00:00Z").toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
const kb = (n: number) => (n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Every document for every home: folders, search, open, add. */
export function VaultPage() {
  const app = useApp();
  const [docs, setDocs] = useState<Doc[] | null>(null);
  const [q, setQ] = useState("");
  const [folder, setFolder] = useState<string>("all");
  const [home, setHome] = useState("");
  const [certsOpen, setCertsOpen] = useState(false);
  const [adding, setAdding] = useState<File[] | null>(null);
  const [addHome, setAddHome] = useState("");
  const [addKind, setAddKind] = useState("agreement");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  async function load() {
    try {
      const qs = new URLSearchParams();
      if (home) qs.set("property_id", home);
      const r = await api<{ documents: Doc[] }>("GET", `/api/documents/all?${qs}`);
      setDocs(r.documents);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [home]);

  const needle = q.trim().toLowerCase();
  const shown = useMemo(
    () => (docs ?? []).filter((d) =>
      (folder === "all" || folderOf(d.kind).id === folder) &&
      (!needle || [d.filename, d.label, d.property_name, d.property_ref ? `ref ${d.property_ref}` : "", KIND_LABEL[d.kind]].some((v) => v?.toLowerCase().includes(needle)))),
    [docs, folder, needle],
  );
  const counts = useMemo(() => {
    const m: Record<string, number> = {};
    for (const d of docs ?? []) m[folderOf(d.kind).id] = (m[folderOf(d.kind).id] ?? 0) + 1;
    return m;
  }, [docs]);
  const homes = [...app.properties].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));

  async function saveAdded() {
    if (!adding?.length || !addHome) return;
    setBusy(true);
    let ok = 0;
    for (const file of adding) {
      const form = new FormData();
      form.append("file", file);
      form.append("property_id", addHome);
      form.append("kind", addKind);
      const r = await fetch("/api/documents", { method: "POST", body: form }).catch(() => null);
      if (r?.ok) ok++;
      else {
        const d = (await r?.json().catch(() => null)) as { error?: string } | null;
        app.setError(d?.error || `Couldn't add ${file.name}`);
      }
    }
    setBusy(false);
    setAdding(null);
    setNote(`Added ${ok} ${ok === 1 ? "document" : "documents"}.`);
    void load();
  }

  return (
    <PageShell
      title="Documents"
      meta={docs ? `${docs.length} ${docs.length === 1 ? "document" : "documents"}` : "Loading…"}
      width="max-w-5xl"
      actions={
        <>
          <Button variant="outline" onClick={() => setCertsOpen(true)}><Sparkles className="size-4" /> Add certificates</Button>
          <Button onClick={() => picker.current?.click()}><Upload className="size-4" /> Add documents</Button>
        </>
      }
    >
      <input ref={picker} type="file" multiple accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx,application/pdf,image/*" className="hidden"
        onChange={(e) => { if (e.target.files?.length) { setAdding([...e.target.files]); setAddHome(home); } e.target.value = ""; }} />

      <div className="space-y-5 pb-10">
        {/* Folders */}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          <FolderTile on={folder === "all"} color="var(--door-ink)" name="All documents" count={docs?.length ?? 0} Icon={FolderOpen} onClick={() => setFolder("all")} />
          {FOLDERS.map((f) => (
            <FolderTile key={f.id} on={folder === f.id} color={f.color} name={f.name} count={counts[f.id] ?? 0} Icon={f.icon} onClick={() => setFolder(f.id)} />
          ))}
        </div>

        <div className="flex flex-wrap gap-2">
          <div className="relative min-w-0 flex-[1_1_16rem]">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name, home or ref…" className="h-11 w-full rounded-xl border bg-card pl-9 pr-3 text-[0.9375rem] outline-none focus:ring-2 focus:ring-ring" />
          </div>
          <select value={home} onChange={(e) => setHome(e.target.value)} aria-label="Which home" className="h-11 max-w-[16rem] rounded-xl border bg-card px-2 text-sm">
            <option value="">Every home</option>
            {homes.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
          </select>
        </div>

        {note && <p className="text-sm font-medium text-primary">{note}</p>}

        {adding && (
          <div className="space-y-3 rounded-2xl border-2 border-dashed border-primary/40 bg-card p-4">
            <p className="font-medium">Add {adding.length === 1 ? adding[0].name : `${adding.length} files`}</p>
            <div className="flex flex-wrap gap-2">
              <select value={addHome} onChange={(e) => setAddHome(e.target.value)} className="h-11 rounded-xl border bg-card px-2 text-sm">
                <option value="">Which home?</option>
                {homes.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
              </select>
              <select value={addKind} onChange={(e) => setAddKind(e.target.value)} className="h-11 rounded-xl border bg-card px-2 text-sm">
                {UPLOAD_KINDS.map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
              </select>
              <Button className="h-11" disabled={!addHome || busy} onClick={saveAdded}>{busy ? "Adding…" : "Save"}</Button>
              <Button className="h-11" variant="ghost" disabled={busy} onClick={() => setAdding(null)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted-foreground">Certificates? Use <b>Add certificates</b> instead: Jarvis reads the home, type and dates for you.</p>
          </div>
        )}

        {docs && !shown.length && (
          <div className="rounded-3xl bg-card px-6 py-12 text-center shadow-card">
            <p className="display text-xl">{docs.length ? "Nothing matches" : "No documents yet"}</p>
            <p className="mt-1 text-muted-foreground">{docs.length ? "Try another word or folder." : "Add tenancy agreements, inventories, photos and mortgage papers here."}</p>
            {!docs.length && <Button className="mt-4" onClick={() => picker.current?.click()}><Camera className="size-4" /> Add the first one</Button>}
          </div>
        )}

        <ul className="space-y-2">
          {shown.map((d) => {
            const f = folderOf(d.kind);
            const Icon = f.icon;
            const expired = d.expiry_date && d.expiry_date < new Date().toISOString().slice(0, 10);
            return (
              <li key={d.id} className="flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: f.color }}>
                  <Icon className="size-5" />
                </span>
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" className="min-w-0 flex-1">
                  <span className="block truncate font-medium hover:underline">{d.label || d.filename}</span>
                  <span className="block truncate text-[0.8125rem] text-muted-foreground">
                    {KIND_LABEL[d.kind] ?? d.kind} · {d.property_ref ? `Ref ${d.property_ref}, ` : ""}{d.property_name ?? "?"} · {when(d)} · {kb(d.size)}
                  </span>
                </a>
                {d.expiry_date && (
                  <span className={cn("hidden shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold sm:inline", expired ? "bg-destructive-tint text-destructive" : "bg-muted text-muted-foreground")}>
                    {expired ? "Expired" : "Expires"} {new Date(`${d.expiry_date}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}
                  </span>
                )}
                <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noopener noreferrer" aria-label="Open" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="size-4" /></a>
                <a href={`/api/documents/${d.id}/file?download=1`} aria-label="Download" className="shrink-0 rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Download className="size-4" /></a>
              </li>
            );
          })}
        </ul>
      </div>

      <BulkUploadDialog open={certsOpen} onClose={(changed) => { setCertsOpen(false); if (changed) void load(); }} />
    </PageShell>
  );
}

function FolderTile({ on, color, name, count, Icon, onClick }: { on: boolean; color: string; name: string; count: number; Icon: typeof FolderOpen; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("flex flex-col items-start gap-2 rounded-2xl p-3.5 text-left transition", on ? "text-white shadow-[inset_0_-4px_0_rgba(0,0,0,0.15)]" : "bg-card shadow-card hover:-translate-y-0.5")}
      style={on ? { background: color } : undefined}
    >
      <span className="inline-flex size-9 items-center justify-center rounded-xl" style={{ background: on ? "rgba(255,255,255,0.2)" : color, color: "#fff" }}>
        <Icon className="size-5" />
      </span>
      <span className="text-sm font-semibold leading-tight">{name}</span>
      <span className={cn("display text-2xl", !on && "text-muted-foreground")}>{count}</span>
    </button>
  );
}
