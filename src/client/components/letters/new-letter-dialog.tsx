import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, FileUp, Scale } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, toIsoDate } from "@/lib/utils";
import { tenantDisplayName } from "@/lib/portfolio";
import type { Letter, Property, Room, Tenant } from "@/types";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CATEGORY_LABEL, LETTER_CSS, TEMPLATES, type Category, type Ctx, type Template } from "./templates";
import { useLetterhead } from "./use-letterhead";
import { CATEGORY_ICON } from "./letter-bits";

const selectCls = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground";

/** A stand-in tenant when the home or room only has a name from the sheet. */
const nameOnly = (name: string): Tenant => ({
  id: 0, first_name: name, last_name: "", email: null, phone: null, date_of_birth: null, emergency_contact: null,
  employer: null, monthly_income: null, notes: null, created_at: "",
});

export function NewLetterDialog({
  open, onOpenChange, onCreated, propertyId, tenantId, templateId,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated: (l: Letter) => void;
  propertyId?: number | null;
  tenantId?: number | null;
  templateId?: string;
}) {
  const app = useApp();
  const { letterhead } = useLetterhead();
  const [mode, setMode] = useState<"pick" | "fill" | "upload">("pick");
  const [tpl, setTpl] = useState<Template | null>(null);
  const [pid, setPid] = useState<number | null>(propertyId ?? null);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [room, setRoom] = useState<string>("");
  const [tid, setTid] = useState<number | null>(tenantId ?? null);
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const lastAuto = useRef<string>("");

  // Reset each time it opens.
  useEffect(() => {
    if (!open) return;
    const t = templateId ? TEMPLATES.find((x) => x.id === templateId) ?? null : null;
    setTpl(t);
    setMode(t ? "fill" : "pick");
    setPid(propertyId ?? null);
    setTid(tenantId ?? null);
    setRoom("");
    lastAuto.current = "";
    app.listTenants().then(setTenants).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const property: Property | null = useMemo(() => app.properties.find((p) => p.id === pid) ?? null, [app.properties, pid]);

  useEffect(() => {
    setRooms([]);
    if (!pid) return;
    api<{ rooms: Room[] }>("GET", `/api/properties/${pid}/rooms`).then((r) => setRooms(r.rooms)).catch(() => {});
  }, [pid]);

  // Pick the tenant who lives there when the home or room changes.
  useEffect(() => {
    const key = `${pid}|${room}`;
    if (lastAuto.current === key) return;
    lastAuto.current = key;
    if (tenantId && key === `${propertyId ?? null}|`) return;
    const r = rooms.find((x) => (x.room ?? "") === room);
    if (room && r) setTid(r.linked_tenant_id ?? null);
    else if (!room && property) setTid(property.tenant_id ?? tenantId ?? null);
  }, [pid, room, rooms, property, tenantId, propertyId]);

  const roomRow = rooms.find((x) => (x.room ?? "") === room) ?? null;
  const linked = tenants.find((t) => t.id === tid) ?? null;
  const tenant: Tenant | null =
    linked ?? (roomRow?.tenant_name ? nameOnly(roomRow.tenant_name) : !room && property?.tenant_label ? nameOnly(property.tenant_label.trim()) : null);

  const ctx: Ctx = useMemo(
    () => ({
      today: toIsoDate(new Date()),
      property,
      tenant,
      room: room || null,
      rent: roomRow ? roomRow.rent : property?.rent_in ?? 0,
      rentDay: roomRow?.pay_day ?? property?.rent_in_day ?? null,
      letterhead,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [property, tenant?.id, tenant?.first_name, room, roomRow?.rent, letterhead],
  );

  // Fill the answers from the property / tenant whenever those change.
  useEffect(() => {
    if (!tpl) return;
    setValues(Object.fromEntries(tpl.fields.map((f) => [f.key, f.initial(ctx)])));
  }, [tpl, ctx]);

  const preview = useMemo(() => (tpl ? tpl.render(ctx, values) : ""), [tpl, ctx, values]);

  async function create() {
    if (!tpl) return;
    setBusy(true);
    try {
      const r = await api<{ letter: Letter }>("POST", "/api/letters", {
        template: tpl.id,
        category: tpl.category,
        title: tpl.title(ctx, values),
        property_id: pid,
        tenant_id: linked?.id ?? null,
        room: room || null,
        body: preview,
        fields: values,
      });
      onOpenChange(false);
      onCreated(r.letter);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sortedTenants = useMemo(() => {
    const wantCompany = tpl?.for === "company";
    return [...tenants].sort((a, b) => {
      const ca = a.tenant_type === "company" ? 0 : 1;
      const cb = b.tenant_type === "company" ? 0 : 1;
      if (wantCompany && ca !== cb) return ca - cb;
      return tenantDisplayName(a).localeCompare(tenantDisplayName(b));
    });
  }, [tenants, tpl]);

  const sortedProps = useMemo(
    () => [...app.properties].sort((a, b) => (parseInt(a.ref ?? "9999", 10) || 9999) - (parseInt(b.ref ?? "9999", 10) || 9999)),
    [app.properties],
  );

  const whoFields = (
    <div className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2">
        <Label className="mb-1 block">Property</Label>
        <select className={selectCls} value={pid ?? ""} onChange={(e) => { setPid(e.target.value ? Number(e.target.value) : null); setRoom(""); }}>
          <option value="">Choose a property…</option>
          {sortedProps.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
        </select>
      </div>
      {rooms.length > 0 && (
        <div>
          <Label className="mb-1 block">Room</Label>
          <select className={selectCls} value={room} onChange={(e) => setRoom(e.target.value)}>
            <option value="">Whole property</option>
            {rooms.filter((r) => r.room).map((r) => <option key={r.id} value={r.room!}>{r.room}{r.tenant_name ? ` · ${r.tenant_name}` : ""}</option>)}
          </select>
        </div>
      )}
      <div className={rooms.length ? "" : "sm:col-span-2"}>
        <Label className="mb-1 block">Tenant</Label>
        <select className={selectCls} value={tid ?? ""} onChange={(e) => setTid(e.target.value ? Number(e.target.value) : null)}>
          <option value="">{tenant && !linked ? `${tenantName0(tenant)} (from the sheet)` : "No tenant chosen"}</option>
          {sortedTenants.map((t) => <option key={t.id} value={t.id}>{tenantDisplayName(t)}{t.tenant_type === "company" ? " (company)" : ""}</option>)}
        </select>
      </div>
    </div>
  );

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[92vh] overflow-hidden p-0", mode === "fill" ? "max-w-6xl" : "max-w-3xl")}>
        {mode === "pick" && (
          <div className="max-h-[92vh] overflow-y-auto p-5">
            <DialogHeader>
              <DialogTitle className="display text-2xl font-medium">New letter or contract</DialogTitle>
              <p className="text-sm text-muted-foreground">Pick a template. It's filled in from the property and tenant, and you can change any wording before printing.</p>
            </DialogHeader>
            {(Object.keys(CATEGORY_LABEL) as Category[]).map((cat) => {
              const Icon = CATEGORY_ICON[cat];
              return (
                <section key={cat} className="mt-5">
                  <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-muted-foreground"><Icon className="size-4" />{CATEGORY_LABEL[cat]}</h3>
                  <div className="grid gap-2 sm:grid-cols-2">
                    {TEMPLATES.filter((t) => t.category === cat).map((t) => (
                      <button
                        key={t.id}
                        type="button"
                        onClick={() => { setTpl(t); setMode("fill"); }}
                        className="rounded-xl p-3.5 text-left shadow-edge transition hover:bg-muted hover:shadow-raised focus-visible:outline-2"
                      >
                        <div className="text-[0.9375rem] font-semibold">{t.name}</div>
                        <div className="mt-0.5 text-[0.8125rem] leading-snug text-muted-foreground">{t.blurb}</div>
                      </button>
                    ))}
                  </div>
                </section>
              );
            })}
            <button
              type="button"
              onClick={() => setMode("upload")}
              className="mt-5 flex w-full items-center gap-3 rounded-xl border border-dashed border-border p-3.5 text-left hover:bg-muted"
            >
              <FileUp className="size-5 text-primary" />
              <span>
                <span className="block text-[0.9375rem] font-semibold">Add a document you already have</span>
                <span className="block text-[0.8125rem] text-muted-foreground">Upload a signed AST, company let, notice or letter made elsewhere so it's kept here too.</span>
              </span>
            </button>
            <LegalNote className="mt-5" />
          </div>
        )}

        {mode === "fill" && tpl && (
          <div className="grid max-h-[92vh] min-h-0 lg:grid-cols-[minmax(0,440px)_minmax(0,1fr)]">
            <div className="flex min-h-0 flex-col border-b lg:border-b-0 lg:border-r">
              <div className="flex items-center gap-2 border-b px-5 py-3.5">
                {!templateId && (
                  <Button size="icon" variant="ghost" onClick={() => setMode("pick")} aria-label="Back to templates"><ArrowLeft /></Button>
                )}
                <div className="min-w-0">
                  <div className="truncate font-semibold">{tpl.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{CATEGORY_LABEL[tpl.category]}</div>
                </div>
              </div>
              <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-5 py-4">
                {whoFields}
                <div className="grid gap-3 sm:grid-cols-2">
                  {tpl.fields.map((f) => (
                    <FieldInput key={f.key} field={f} value={values[f.key] ?? ""} onChange={(v) => setValues((s) => ({ ...s, [f.key]: v }))} />
                  ))}
                </div>
                <LegalNote />
              </div>
              <div className="flex items-center justify-end gap-2 border-t px-5 py-3">
                <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
                <Button onClick={create} disabled={busy || !pid}>{busy ? "Creating…" : "Create"}</Button>
              </div>
            </div>
            <div className="hidden min-h-0 overflow-y-auto bg-muted/60 p-6 lg:block">
              <Paper html={preview} />
            </div>
          </div>
        )}

        {mode === "upload" && (
          <UploadExisting
            whoFields={whoFields}
            pid={pid}
            tenantId={linked?.id ?? null}
            room={room || null}
            onBack={() => setMode("pick")}
            onDone={(l) => { onOpenChange(false); onCreated(l); }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

const tenantName0 = (t: Tenant) => `${t.first_name} ${t.last_name}`.trim();

function FieldInput({ field: f, value, onChange }: { field: Template["fields"][number]; value: string; onChange: (v: string) => void }) {
  const wide = f.wide || f.type === "textarea" || f.type === "checks";
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <Label className="mb-1 block">{f.label}</Label>
      {f.type === "textarea" ? (
        <Textarea rows={f.key === "schedule" ? 5 : 3} value={value} onChange={(e) => onChange(e.target.value)} className={f.key === "schedule" ? "font-mono text-xs" : undefined} />
      ) : f.type === "select" ? (
        <select className={selectCls} value={value} onChange={(e) => onChange(e.target.value)}>
          {f.options?.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      ) : f.type === "checks" ? (
        <div className="grid gap-1.5 rounded-lg p-2.5 shadow-edge">
          {f.options?.map((o) => {
            const set = new Set(value.split(",").filter(Boolean));
            return (
              <label key={o.value} className="flex items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 accent-[var(--primary)]"
                  checked={set.has(o.value)}
                  onChange={(e) => {
                    if (e.target.checked) set.add(o.value); else set.delete(o.value);
                    onChange([...set].join(","));
                  }}
                />
                {o.label}
              </label>
            );
          })}
        </div>
      ) : (
        <Input
          type={f.type === "date" ? "date" : "text"}
          inputMode={f.type === "money" || f.type === "number" ? "decimal" : undefined}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete="off"
        />
      )}
      {f.help && <p className="mt-1 text-xs text-muted-foreground">{f.help}</p>}
    </div>
  );
}

/** A sheet of A4 on screen. */
export function Paper({ html, editable, innerRef, className }: { html: string; editable?: boolean; innerRef?: React.Ref<HTMLDivElement>; className?: string }) {
  return (
    <div className={cn("mx-auto w-full max-w-[820px] rounded-md bg-white px-[7%] py-[6%] shadow-float ring-1 ring-black/5", editable && "ring-2 ring-primary/60", className)}>
      <style>{LETTER_CSS}</style>
      <div
        ref={innerRef}
        className="letter-doc outline-none"
        contentEditable={editable}
        suppressContentEditableWarning
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}

export function LegalNote({ className }: { className?: string }) {
  return (
    <p className={cn("flex gap-2 rounded-lg bg-muted p-3 text-xs leading-relaxed text-muted-foreground", className)}>
      <Scale className="mt-0.5 size-4 shrink-0" />
      <span>
        Templates for homes in England under the Renters' Rights Act 2025 (in force since 1 May 2026): no section 21 and no new
        ASTs, so tenancies to people are assured periodic tenancies. They're a starting point, not legal advice. Check anything
        you're unsure of, and have contracts and eviction notices reviewed by a solicitor or the NRLA before relying on them.
      </span>
    </p>
  );
}

function UploadExisting({
  whoFields, pid, tenantId, room, onBack, onDone,
}: {
  whoFields: React.ReactNode;
  pid: number | null;
  tenantId: number | null;
  room: string | null;
  onBack: () => void;
  onDone: (l: Letter) => void;
}) {
  const app = useApp();
  const [category, setCategory] = useState<Category>("tenancy");
  const [title, setTitle] = useState("");
  const [status, setStatus] = useState<"signed" | "sent">("signed");
  const [date, setDate] = useState(toIsoDate(new Date()));
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!pid || !file) return;
    setBusy(true);
    try {
      const r = await api<{ letter: Letter }>("POST", "/api/letters", {
        template: "upload",
        category,
        title: title.trim() || file.name.replace(/\.[^.]+$/, ""),
        property_id: pid,
        tenant_id: tenantId,
        room,
        status,
        ...(status === "signed" ? { signed_on: date } : { sent_on: date }),
      });
      const fd = new FormData();
      fd.append("file", file);
      fd.append("property_id", String(pid));
      fd.append("kind", category === "arrears" ? "notice" : "agreement");
      fd.append("label", r.letter.title);
      fd.append("letter_id", String(r.letter.id));
      const res = await fetch("/api/documents", { method: "POST", body: fd });
      if (!res.ok) {
        await api("DELETE", `/api/letters/${r.letter.id}`).catch(() => {});
        throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error ?? "Upload failed");
      }
      onDone({ ...r.letter, file_count: 1 });
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="max-h-[92vh] overflow-y-auto p-5">
      <div className="mb-4 flex items-center gap-2">
        <Button size="icon" variant="ghost" onClick={onBack} aria-label="Back"><ArrowLeft /></Button>
        <DialogTitle className="text-lg font-semibold">Add a document you already have</DialogTitle>
      </div>
      <div className="space-y-4">
        {whoFields}
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label className="mb-1 block">What is it?</Label>
            <select className={selectCls} value={category} onChange={(e) => setCategory(e.target.value as Category)}>
              <option value="tenancy">Tenancy agreement (AST / periodic)</option>
              <option value="company">Company let agreement or notice</option>
              <option value="arrears">Arrears letter or eviction notice</option>
            </select>
          </div>
          <div>
            <Label className="mb-1 block">Name</Label>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. AST signed 2024" />
          </div>
          <div>
            <Label className="mb-1 block">Status</Label>
            <select className={selectCls} value={status} onChange={(e) => setStatus(e.target.value as "signed" | "sent")}>
              <option value="signed">Signed</option>
              <option value="sent">Sent / served</option>
            </select>
          </div>
          <div>
            <Label className="mb-1 block">{status === "signed" ? "Date signed" : "Date sent"}</Label>
            <Input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="sm:col-span-2">
            <Label className="mb-1 block">File (PDF, photo or Word)</Label>
            <Input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp,.heic,.doc,.docx" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
          </div>
        </div>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onBack}>Cancel</Button>
          <Button onClick={save} disabled={busy || !pid || !file}>{busy ? "Uploading…" : "Save"}</Button>
        </div>
      </div>
    </div>
  );
}
