import { useCallback, useEffect, useRef, useState } from "react";
import { Copy, Eye, EyeOff, ImagePlus, KeyRound, Pencil, Plus, Printer, QrCode, RefreshCw, Trash2 } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney, toIsoDate } from "@/lib/utils";
import type { Property } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { upload, type DocumentRow } from "@/components/compliance/documents";

// ── Keys & access ──────────────────────────────────────────────────

interface Access {
  key_safe_location: string | null;
  key_safe_code: string | null;
  keys_held_by: string | null;
  alarm_code: string | null;
  access_notes: string | null;
  updated_by: string | null;
  updated_at: string | null;
}
const EMPTY: Access = { key_safe_location: null, key_safe_code: null, keys_held_by: null, alarm_code: null, access_notes: null, updated_by: null, updated_at: null };

/** A code stays hidden until someone asks to see it. */
function Secret({ value }: { value: string | null }) {
  const [show, setShow] = useState(false);
  if (!value) return <span className="text-faint">Not set</span>;
  return (
    <span className="inline-flex items-center gap-2">
      <span className="data font-medium tracking-wider">{show ? value : "••••"}</span>
      <button type="button" onClick={() => setShow(!show)} className="text-muted-foreground hover:text-foreground" aria-label={show ? "Hide code" : "Show code"}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </span>
  );
}

export function AccessCard({ property }: { property: Property }) {
  const { setError } = useApp();
  const [a, setA] = useState<Access | null>(null);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Access>(EMPTY);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<{ access: Access | null }>("GET", `/api/properties/${property.id}/access`)
      .then((d) => setA(d.access ?? EMPTY))
      .catch((err) => setError((err as Error).message));
  }, [property.id, setError]);

  async function save() {
    setBusy(true);
    try {
      const d = await api<{ access: Access }>("PUT", `/api/properties/${property.id}/access`, draft);
      setA(d.access);
      setEditing(false);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const field = (k: keyof Access, label: string, opts: { area?: boolean; placeholder?: string } = {}) => (
    <div className={opts.area ? "sm:col-span-2" : undefined}>
      <Label className="mb-1 block">{label}</Label>
      {opts.area ? (
        <Textarea rows={3} value={draft[k] ?? ""} placeholder={opts.placeholder} onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      ) : (
        <Input value={draft[k] ?? ""} placeholder={opts.placeholder} autoComplete="off" onChange={(e) => setDraft({ ...draft, [k]: e.target.value })} />
      )}
    </div>
  );

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-[1.0625rem] font-semibold"><KeyRound className="size-4 text-primary" /> Keys &amp; access</h2>
        {a && !editing && (
          <Button size="sm" variant="ghost" onClick={() => { setDraft(a); setEditing(true); }}><Pencil className="size-4" /> Edit</Button>
        )}
      </div>
      {!a ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : editing ? (
        <div className="grid gap-3 sm:grid-cols-2">
          {field("key_safe_location", "Key safe location", { placeholder: "e.g. left of the front door" })}
          {field("key_safe_code", "Key safe code")}
          {field("keys_held_by", "Who holds keys", { placeholder: "e.g. Zain (2 sets), tenant, Bloggs Lettings" })}
          {field("alarm_code", "Alarm code")}
          {field("access_notes", "Access notes", { area: true, placeholder: "e.g. bin store fob in kitchen drawer; ring before 6pm" })}
          <div className="flex gap-2 sm:col-span-2">
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : "Save"}</Button>
            <Button variant="ghost" onClick={() => setEditing(false)} disabled={busy}>Cancel</Button>
          </div>
        </div>
      ) : (
        <dl className="grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          <div><dt className="text-muted-foreground">Key safe</dt><dd className="mt-0.5">{a.key_safe_location || <span className="text-faint">Not set</span>}</dd></div>
          <div><dt className="text-muted-foreground">Key safe code</dt><dd className="mt-0.5"><Secret value={a.key_safe_code} /></dd></div>
          <div><dt className="text-muted-foreground">Keys held by</dt><dd className="mt-0.5 whitespace-pre-line">{a.keys_held_by || <span className="text-faint">Not set</span>}</dd></div>
          <div><dt className="text-muted-foreground">Alarm code</dt><dd className="mt-0.5"><Secret value={a.alarm_code} /></dd></div>
          {a.access_notes && <div className="sm:col-span-2"><dt className="text-muted-foreground">Notes</dt><dd className="mt-0.5 whitespace-pre-line">{a.access_notes}</dd></div>}
          {a.updated_at && a.updated_by && <p className="text-xs text-faint sm:col-span-2">Updated by {a.updated_by}, {formatDate(a.updated_at)}</p>}
        </dl>
      )}
    </Card>
  );
}

// ── Empty periods ──────────────────────────────────────────────────

interface Void {
  id: number;
  room: string | null;
  start_date: string;
  end_date: string | null;
  monthly_rent: number;
}
interface VoidStats { days_this_year: number; room_days_this_year: number; lost_rent_this_year: number; empty_now: number }

const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000) + 1;

export function VoidsCard({ property }: { property: Property }) {
  const { settings, setError } = useApp();
  const [voids, setVoids] = useState<Void[] | null>(null);
  const [stats, setStats] = useState<VoidStats | null>(null);
  const [edit, setEdit] = useState<Partial<Void> | null>(null);
  const [deleting, setDeleting] = useState<Void | null>(null);
  const money = (n: number) => formatMoney(n, settings.currency);
  const today = toIsoDate(new Date());

  const load = useCallback(async () => {
    try {
      const d = await api<{ voids: Void[]; stats: VoidStats }>("GET", `/api/voids?property_id=${property.id}`);
      setVoids(d.voids);
      setStats(d.stats);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [property.id, setError]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    if (!edit) return;
    try {
      if (edit.id) await api("PUT", `/api/voids/${edit.id}`, edit);
      else await api("POST", "/api/voids", { ...edit, property_id: property.id });
      setEdit(null);
      await load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div>
          <h2 className="text-[1.0625rem] font-semibold">Empty periods</h2>
          {stats && (
            <p className="mt-0.5 text-sm text-muted-foreground">
              {stats.days_this_year} day{stats.days_this_year === 1 ? "" : "s"} empty this year
              {stats.room_days_this_year ? `, plus ${stats.room_days_this_year} room-days` : ""}
              {stats.lost_rent_this_year ? `: about ${money(stats.lost_rent_this_year)} of rent lost` : ""}
            </p>
          )}
        </div>
        {!edit && <Button size="sm" variant="ghost" onClick={() => setEdit({ start_date: today, end_date: null, monthly_rent: property.rent_in, room: null })}><Plus className="size-4" /> Add</Button>}
      </div>

      {edit && (
        <div className="mb-3 grid gap-3 rounded-lg bg-muted p-3 sm:grid-cols-4">
          <div><Label className="mb-1 block">Empty from</Label><Input type="date" value={edit.start_date ?? ""} onChange={(e) => setEdit({ ...edit, start_date: e.target.value })} /></div>
          <div><Label className="mb-1 block">Let again on</Label><Input type="date" value={edit.end_date ?? ""} onChange={(e) => setEdit({ ...edit, end_date: e.target.value || null })} /></div>
          <div><Label className="mb-1 block">Room (blank = whole home)</Label><Input value={edit.room ?? ""} onChange={(e) => setEdit({ ...edit, room: e.target.value || null })} /></div>
          <div><Label className="mb-1 block">Rent it would earn (£/month)</Label><Input inputMode="decimal" value={String(edit.monthly_rent ?? "")} onChange={(e) => setEdit({ ...edit, monthly_rent: Number(e.target.value.replace(/[£,]/g, "")) || 0 })} /></div>
          <div className="flex gap-2 sm:col-span-4">
            <Button size="sm" onClick={save}>Save</Button>
            <Button size="sm" variant="ghost" onClick={() => setEdit(null)}>Cancel</Button>
          </div>
        </div>
      )}

      {!voids ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : voids.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No empty periods recorded. They're logged automatically when the sheet marks this home (or a room) as empty, and closed when it's let again. Add earlier ones with Add.
        </p>
      ) : (
        <ul className="divide-y text-sm">
          {voids.map((v) => {
            const days = daysBetween(v.start_date, v.end_date ?? today);
            return (
              <li key={v.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                <span className={cn("badge-tone", v.end_date ? "tone-neutral" : "tone-warning")}>{v.end_date ? "Ended" : "Empty now"}</span>
                <span className="font-medium">{v.room || "Whole home"}</span>
                <span className="text-muted-foreground">{formatDate(v.start_date)} to {v.end_date ? formatDate(v.end_date) : "today"} · {days} day{days === 1 ? "" : "s"}</span>
                <span className="ml-auto tabular-nums text-muted-foreground">{v.monthly_rent ? `${money((days * v.monthly_rent * 12) / 365)} lost` : ""}</span>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted" aria-label="Edit" onClick={() => setEdit(v)}><Pencil className="size-4" /></button>
                <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" aria-label="Delete" onClick={() => setDeleting(v)}><Trash2 className="size-4" /></button>
              </li>
            );
          })}
        </ul>
      )}
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Delete this empty period?"
        description="It will no longer count towards days empty or lost rent."
        onConfirm={async () => { if (deleting) { await api("DELETE", `/api/voids/${deleting.id}`); setDeleting(null); load(); } }}
      />
    </Card>
  );
}

// ── Photos & check-in / check-out reports ──────────────────────────

const MEDIA = [
  { kind: "photo", label: "Photos" },
  { kind: "checkin", label: "Check-in reports" },
  { kind: "checkout", label: "Check-out reports" },
  { kind: "inventory", label: "Inventories" },
] as const;
type MediaKind = (typeof MEDIA)[number]["kind"];

export function MediaCard({ property }: { property: Property }) {
  const { setError } = useApp();
  const [docs, setDocs] = useState<DocumentRow[] | null>(null);
  const [tab, setTab] = useState<MediaKind>("photo");
  const [pending, setPending] = useState<File[]>([]);
  const [label, setLabel] = useState("");
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState<DocumentRow | null>(null);
  const input = useRef<HTMLInputElement>(null);

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/documents?property_id=${property.id}`);
      const d = (await r.json()) as { documents: DocumentRow[] };
      setDocs(d.documents);
    } catch (err) {
      setError((err as Error).message);
    }
  }, [property.id, setError]);
  useEffect(() => { load(); }, [load]);

  async function save() {
    setBusy(true);
    try {
      for (const f of pending) await upload(property.id, tab as never, f, "", { label, taken_on: date });
      setPending([]);
      setLabel("");
      if (input.current) input.current.value = "";
      await load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const list = (docs ?? []).filter((d) => (d.kind as string) === tab);
  const isImg = (d: DocumentRow) => /^image\/(jpeg|png|webp)$/.test(d.content_type);

  return (
    <Card className="p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.0625rem] font-semibold">Photos &amp; reports</h2>
        <div className="flex flex-wrap gap-1">
          {MEDIA.map((m) => {
            const n = (docs ?? []).filter((d) => (d.kind as string) === m.kind).length;
            return (
              <button key={m.kind} type="button" onClick={() => setTab(m.kind)} className={cn("rounded-full px-3 py-1 text-sm", tab === m.kind ? "bg-brand-tint font-medium text-brand-text" : "text-muted-foreground hover:bg-muted")}>
                {m.label}{n ? ` (${n})` : ""}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mb-3 flex flex-wrap items-end gap-2 rounded-lg bg-muted p-3">
        <input ref={input} type="file" multiple accept={tab === "photo" ? "image/*" : "image/*,.pdf,.doc,.docx"} className="hidden" onChange={(e) => setPending([...(e.target.files ?? [])])} />
        <Button size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}><ImagePlus className="size-4" /> {pending.length ? `${pending.length} file${pending.length === 1 ? "" : "s"} chosen` : "Choose files"}</Button>
        <label className="text-xs"><span className="mb-0.5 block text-muted-foreground">Date taken</span><Input type="date" className="h-8 w-40" value={date} onChange={(e) => setDate(e.target.value)} /></label>
        <label className="min-w-[10rem] flex-1 text-xs"><span className="mb-0.5 block text-muted-foreground">{tab === "photo" ? "Note (e.g. kitchen after refit)" : "Tenant or room"}</span><Input className="h-8" value={label} onChange={(e) => setLabel(e.target.value)} /></label>
        <Button size="sm" onClick={save} disabled={busy || !pending.length}>{busy ? "Uploading…" : "Upload"}</Button>
      </div>

      {!docs ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : list.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing here yet.</p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {list.map((d) => (
            <div key={d.id} className="group relative overflow-hidden rounded-lg bg-muted">
              <a href={`/api/documents/${d.id}/file`} target="_blank" rel="noreferrer" className="block">
                {isImg(d) ? (
                  <img src={`/api/documents/${d.id}/file`} alt={d.label ?? d.filename} loading="lazy" className="aspect-[4/3] w-full object-cover" />
                ) : (
                  <div className="flex aspect-[4/3] w-full items-center justify-center p-3 text-center text-xs text-muted-foreground">{d.filename}</div>
                )}
              </a>
              <div className="px-2 py-1.5 text-xs">
                <div className="truncate font-medium">{d.label || d.filename}</div>
                <div className="text-muted-foreground">{formatDate(d.taken_on ?? d.created_at)}</div>
              </div>
              <button type="button" onClick={() => setDeleting(d)} className="absolute right-1.5 top-1.5 rounded-md bg-card/90 p-1 text-muted-foreground opacity-0 shadow-sm transition-opacity hover:text-destructive group-hover:opacity-100 focus:opacity-100" aria-label="Delete">
                <Trash2 className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}
      <ConfirmDelete
        open={!!deleting}
        onOpenChange={(o) => { if (!o) setDeleting(null); }}
        title="Delete this file?"
        description="It's removed from the server. This cannot be undone."
        onConfirm={async () => { if (deleting) { await fetch(`/api/documents/${deleting.id}`, { method: "DELETE" }); setDeleting(null); load(); } }}
      />
    </Card>
  );
}

// ── Repair requests (QR code) ──────────────────────────────────────

export function RepairQrCard({ property }: { property: Property }) {
  const { setError } = useApp();
  const [url, setUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [v, setV] = useState(0);

  useEffect(() => {
    api<{ url: string }>("GET", `/api/properties/${property.id}/report-link`).then((d) => setUrl(d.url)).catch((err) => setError((err as Error).message));
  }, [property.id, setError]);

  async function copy() {
    if (!url) return;
    try { await navigator.clipboard.writeText(url); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch { /* clipboard blocked */ }
  }
  async function reset() {
    try {
      const d = await api<{ url: string }>("POST", `/api/properties/${property.id}/report-link/reset`);
      setUrl(d.url);
      setV((x) => x + 1);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <Card className="p-5">
      <h2 className="mb-1 flex items-center gap-2 text-[1.0625rem] font-semibold"><QrCode className="size-4 text-primary" /> Tenant repair requests</h2>
      <p className="mb-3 text-sm text-muted-foreground">Tenants scan this code to report a repair with photos. Reports arrive in Maintenance.</p>
      <div className="flex flex-wrap items-center gap-4">
        <img key={v} src={`/properties/${property.id}/qr.svg?v=${v}`} alt="Repair request QR code" className="size-32 rounded-lg bg-white p-1.5 shadow-card" />
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <a href={`/properties/${property.id}/repair-poster`} target="_blank" rel="noreferrer" className="inline-flex w-fit items-center gap-1.5 rounded-lg bg-primary px-3.5 py-2 text-sm font-semibold text-primary-foreground hover:bg-primary/90">
            <Printer className="size-4" /> Print poster
          </a>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" onClick={copy} disabled={!url}><Copy className="size-4" /> {copied ? "Copied" : "Copy link"}</Button>
            <Button size="sm" variant="ghost" onClick={() => setConfirmReset(true)}><RefreshCw className="size-4" /> New link</Button>
          </div>
          {url && <p className="truncate text-xs text-faint">{url}</p>}
        </div>
      </div>
      <ConfirmDelete
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Make a new link?"
        description="The old QR code and link stop working, so any printed posters need replacing. Use this if a link has been shared somewhere it shouldn't be."
        confirmLabel="Make new link"
        onConfirm={() => { setConfirmReset(false); reset(); }}
      />
    </Card>
  );
}
