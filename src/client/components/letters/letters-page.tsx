import { useEffect, useMemo, useState } from "react";
import { FilePlus2, Paperclip, PenLine, Search, Stamp } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate } from "@/lib/utils";
import type { Letter } from "@/types";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";
import { CATEGORY_LABEL, TEMPLATES, type Category, type Letterhead } from "./templates";
import { CATEGORY_ICON, StatusBadge } from "./letter-bits";
import { LegalNote, NewLetterDialog } from "./new-letter-dialog";
import { useLetterhead } from "./use-letterhead";

type Filter = "all" | Category;

export function LettersPage({ navigate }: { navigate: (to: string) => void }) {
  const { setError } = useApp();
  const [letters, setLetters] = useState<Letter[] | null>(null);
  const [filter, setFilter] = useState<Filter>("all");
  const [status, setStatus] = useState<string>("all");
  const [q, setQ] = useState("");
  const [creating, setCreating] = useState<{ template?: string } | null>(null);
  const [editingLh, setEditingLh] = useState(false);
  const lh = useLetterhead();

  useEffect(() => {
    api<{ letters: Letter[] }>("GET", "/api/letters").then((r) => setLetters(r.letters)).catch((e) => setError((e as Error).message));
  }, [setError]);

  const rows = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (letters ?? []).filter(
      (l) =>
        (filter === "all" || l.category === filter) &&
        (status === "all" || l.status === status) &&
        (!needle || [l.title, l.property_name, l.property_ref, l.tenant_name].some((x) => x?.toLowerCase().includes(needle))),
    );
  }, [letters, filter, status, q]);

  const count = (c: Filter) => (letters ?? []).filter((l) => c === "all" || l.category === c).length;
  const drafts = (letters ?? []).filter((l) => l.status === "draft").length;
  const signed = (letters ?? []).filter((l) => l.status === "signed").length;

  return (
    <PageShell
      title="Letters & contracts"
      meta={letters ? `${letters.length} documents · ${drafts} draft${drafts === 1 ? "" : "s"} · ${signed} signed` : "Loading…"}
      actions={
        <>
          <Button variant="secondary" onClick={() => setEditingLh(true)}><Stamp /> <span className="hidden sm:inline">Letterhead</span></Button>
          <Button onClick={() => setCreating({})}><FilePlus2 /> New</Button>
        </>
      }
    >
      {lh.loaded && !lh.letterhead.address && (
        <button
          type="button"
          onClick={() => setEditingLh(true)}
          className="flex w-full items-center gap-3 rounded-xl bg-warning-tint px-4 py-3 text-left text-sm text-warning"
        >
          <PenLine className="size-4 shrink-0" />
          <span><strong>Add your letterhead</strong>: company address, phone, who signs and the bank account for rent. It's printed on every letter.</span>
        </button>
      )}

      <section>
        <h2 className="mb-3 text-[1.0625rem] font-semibold">Start from a template</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {TEMPLATES.map((t) => {
            const Icon = CATEGORY_ICON[t.category];
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setCreating({ template: t.id })}
                className="group flex items-start gap-3 rounded-xl bg-card p-4 text-left shadow-card transition hover:-translate-y-px hover:shadow-float focus-visible:outline-2"
              >
                <span className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-lg", t.category === "arrears" ? "bg-destructive-tint text-destructive" : t.category === "company" ? "bg-info-tint text-info" : "bg-brand-tint text-brand-text")}>
                  <Icon className="size-[18px]" />
                </span>
                <span className="min-w-0">
                  <span className="block font-semibold leading-snug">{t.name}</span>
                  <span className="mt-0.5 block text-[0.8125rem] leading-snug text-muted-foreground">{t.blurb}</span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      <section>
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <div className="flex flex-wrap gap-1 rounded-xl bg-muted p-1">
            {(["all", "arrears", "tenancy", "company"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setFilter(f)}
                className={cn("rounded-lg px-3 py-1.5 text-sm font-medium transition", filter === f ? "bg-card text-foreground shadow-edge" : "text-muted-foreground hover:text-foreground")}
              >
                {f === "all" ? "All" : CATEGORY_LABEL[f]} <span className="tabular-nums text-faint">{count(f)}</span>
              </button>
            ))}
          </div>
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm" aria-label="Status">
            <option value="all">Any status</option>
            <option value="draft">Drafts</option>
            <option value="sent">Sent</option>
            <option value="signed">Signed</option>
            <option value="void">Cancelled</option>
          </select>
          <div className="relative ml-auto w-full sm:w-64">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-faint" />
            <Input className="pl-8" placeholder="Search property, tenant…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
        </div>

        {letters === null ? (
          <Card className="p-8 text-center text-sm text-muted-foreground">Loading…</Card>
        ) : rows.length === 0 ? (
          <Card className="flex flex-col items-center gap-2 p-10 text-center">
            <FilePlus2 className="size-7 text-faint" />
            <p className="font-medium">{letters.length ? "Nothing matches" : "No letters or contracts yet"}</p>
            <p className="max-w-sm text-sm text-muted-foreground">
              {letters.length ? "Try another filter." : "Start from a template above, or add signed agreements you already have so everything is in one place."}
            </p>
          </Card>
        ) : (
          <LetterList rows={rows} navigate={navigate} />
        )}
      </section>

      <LegalNote />

      <NewLetterDialog
        open={!!creating}
        onOpenChange={(o) => !o && setCreating(null)}
        templateId={creating?.template}
        onCreated={(l) => navigate(`/letters/${l.id}`)}
      />
      <LetterheadDialog open={editingLh} onOpenChange={setEditingLh} value={lh.letterhead} onSave={lh.save} />
    </PageShell>
  );
}

export function LetterList({ rows, navigate, compact }: { rows: Letter[]; navigate: (to: string) => void; compact?: boolean }) {
  return (
    <Card className="divide-y overflow-hidden">
      {rows.map((l) => {
        const Icon = CATEGORY_ICON[l.category] ?? FilePlus2;
        return (
          <button key={l.id} type="button" onClick={() => navigate(`/letters/${l.id}`)} className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-muted">
            <span className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg", l.category === "arrears" ? "bg-destructive-tint text-destructive" : l.category === "company" ? "bg-info-tint text-info" : "bg-brand-tint text-brand-text")}>
              <Icon className="size-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">{l.title}</span>
              <span className="block truncate text-xs text-muted-foreground">
                {[!compact && (l.property_ref ? `${l.property_ref} · ${l.property_name}` : l.property_name), l.room, l.tenant_name, l.template === "upload" ? "uploaded" : null].filter(Boolean).join(" · ") || "—"}
              </span>
            </span>
            {l.file_count > 0 && <span className="flex items-center gap-0.5 text-xs text-muted-foreground"><Paperclip className="size-3.5" />{l.file_count}</span>}
            <StatusBadge status={l.status} />
            <span className="hidden w-24 shrink-0 text-right text-xs tabular-nums text-muted-foreground sm:block">
              {formatDate(l.signed_on || l.sent_on || l.updated_at)}
            </span>
          </button>
        );
      })}
    </Card>
  );
}

function LetterheadDialog({ open, onOpenChange, value, onSave }: { open: boolean; onOpenChange: (o: boolean) => void; value: Letterhead; onSave: (l: Letterhead) => Promise<void> }) {
  const { setError } = useApp();
  const [d, setD] = useState<Letterhead>(value);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setD(value); }, [open, value]);
  const f = (k: keyof Letterhead, label: string, area = false, placeholder?: string) => (
    <div className={area ? "sm:col-span-2" : undefined}>
      <Label className="mb-1 block">{label}</Label>
      {area ? (
        <Textarea rows={3} value={d[k]} placeholder={placeholder} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
      ) : (
        <Input value={d[k]} placeholder={placeholder} onChange={(e) => setD({ ...d, [k]: e.target.value })} />
      )}
    </div>
  );
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl">
        <DialogHeader>
          <DialogTitle>Letterhead</DialogTitle>
          <p className="text-sm text-muted-foreground">Printed at the top and bottom of every letter and contract.</p>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {f("company", "Company name")}
          {f("email", "Email")}
          {f("address", "Address", true, "Street\nTown\nPostcode")}
          {f("phone", "Phone")}
          {f("signatory", "Signed by", false, "e.g. Nabeel Shahid")}
          {f("position", "Their role", false, "Director")}
          {f("bank", "Bank details for rent", true, "Account name\nSort code 00-00-00\nAccount 00000000")}
        </div>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              try { await onSave(d); onOpenChange(false); } catch (e) { setError((e as Error).message); } finally { setBusy(false); }
            }}
          >
            {busy ? "Saving…" : "Save"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
