import { useEffect, useMemo, useState } from "react";
import { Building, CalendarClock, ExternalLink, FileText, Info, TrendingUp } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";

interface Tenancy {
  key: string;
  property_id: number;
  ref: string | null;
  home: string;
  room: string | null;
  tenant: string | null;
  rent: number;
  start_date: string | null;
  end_date: string | null;
  kind: "assured" | "company";
  last_increase: string | null;
  earliest_new_rent: string | null;
  notice_from: string | null;
  status: "ready" | "soon" | "wait" | "unknown" | "ending" | "running" | "pending";
  suggested_rent: number;
  pending?: { notice_served: string; takes_effect: string; new_rent: number } | null;
}

const STATUS: Record<Tenancy["status"], { label: string; color: string; text: string }> = {
  ready: { label: "Can review now", color: "var(--door-green)", text: "#fff" },
  unknown: { label: "Start date missing", color: "#f59f0b", text: "#fff" },
  soon: { label: "Coming up", color: "var(--door-blue)", text: "#fff" },
  pending: { label: "New rent on its way", color: "var(--door-plum)", text: "#fff" },
  wait: { label: "Not yet", color: "var(--muted)", text: "var(--muted-foreground)" },
  ending: { label: "Company let ending", color: "var(--door-red)", text: "#fff" },
  running: { label: "Company let", color: "var(--muted)", text: "var(--muted-foreground)" },
};

const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const nice = (iso: string | null | undefined) => (iso ? new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }) : "");

/** When each tenancy's rent can next go up (England, from 1 May 2026), and company lets coming to an end. */
export function RenewalsPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const [data, setData] = useState<{ items: Tenancy[]; form_url: string; guide_url: string; today: string } | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [filter, setFilter] = useState<"todo" | "all">("todo");

  async function load() {
    try {
      setData(await api("GET", "/api/renewals"));
    } catch (err) {
      app.setError((err as Error).message);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  const items = data?.items ?? [];
  const shown = useMemo(() => (filter === "all" ? items : items.filter((t) => ["ready", "unknown", "soon", "ending", "pending"].includes(t.status))), [items, filter]);
  const count = (s: Tenancy["status"]) => items.filter((t) => t.status === s).length;

  return (
    <PageShell title="Rent reviews" meta={data ? `${items.length} tenancies` : "Loading…"} width="max-w-4xl">
      <div className="space-y-5 pb-10">
        <div className="flex gap-3 rounded-2xl bg-brand-tint p-4 text-sm text-brand-text">
          <Info className="mt-0.5 size-5 shrink-0" />
          <div className="space-y-1">
            <p>
              Since 1 May 2026, tenancies with people roll on with no end date. Rent can go up <b>once a year</b>, never in the first year,
              by sending the tenant <b>Form 4A</b> at least <b>2 months</b> before the new rent starts.
            </p>
            {data && (
              <p className="flex flex-wrap gap-x-4">
                <a href={data.form_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-semibold underline">Get Form 4A on GOV.UK <ExternalLink className="size-3.5" /></a>
                <a href={data.guide_url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline">Read the rules <ExternalLink className="size-3.5" /></a>
              </p>
            )}
            <p className="text-xs opacity-80">Dates here are worked out from your records as a guide. Check them before you serve a notice.</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Tile n={count("ready")} label="Can review now" color="var(--door-green)" />
          <Tile n={count("soon")} label="Coming up (2 months)" color="var(--door-blue)" />
          <Tile n={count("unknown")} label="Need a start date" color="#f59f0b" />
          <Tile n={count("ending")} label="Company lets ending" color="var(--door-red)" />
        </div>

        <div className="flex gap-1.5">
          <Pill on={filter === "todo"} onClick={() => setFilter("todo")}>Needs attention</Pill>
          <Pill on={filter === "all"} onClick={() => setFilter("all")}>All tenancies</Pill>
        </div>

        {data && !shown.length && (
          <div className="rounded-3xl bg-card px-6 py-12 text-center shadow-card">
            <p className="display text-2xl">Nothing to review right now 🎉</p>
            <p className="mt-1 text-muted-foreground">You'll see tenancies here a couple of months before their rent can go up.</p>
          </div>
        )}

        <ul className="space-y-3">
          {shown.map((t) => {
            const st = STATUS[t.status];
            return (
              <li key={t.key} className="rounded-2xl bg-card p-4 shadow-card">
                <div className="flex flex-wrap items-start gap-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: t.kind === "company" ? "var(--door-plum)" : "var(--door-green)" }}>
                    {t.kind === "company" ? <Building className="size-5" /> : <TrendingUp className="size-5" />}
                  </span>
                  <button type="button" onClick={() => navigate(`/properties/${t.property_id}`)} className="min-w-0 flex-1 text-left">
                    <span className="block font-semibold leading-snug">{t.tenant || "Tenant"}</span>
                    <span className="block truncate text-[0.8125rem] text-muted-foreground">
                      {t.ref ? `Ref ${t.ref}, ` : ""}{t.home}{t.room ? ` · ${t.room}` : ""} · {pounds(t.rent)} a month
                    </span>
                  </button>
                  <span className="shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold" style={{ background: st.color, color: st.text }}>{st.label}</span>
                </div>

                <p className="mt-3 text-sm">
                  {t.kind === "company"
                    ? (t.end_date ? `The agreement ends on ${nice(t.end_date)}. Agree a renewal with the company and write a new company let agreement.` : "Company lets still have a fixed term. Add the end date to the tenancy to get a reminder.")
                    : t.status === "pending" && t.pending
                      ? `Form 4A sent on ${nice(t.pending.notice_served)}. The new rent of ${pounds(t.pending.new_rent)} starts on ${nice(t.pending.takes_effect)}.`
                      : t.status === "unknown"
                        ? `We don't know when this tenancy started or when the rent last went up, so check that a year has passed before sending Form 4A. If you send it today, the new rent could start on ${nice(t.earliest_new_rent)} at the earliest.`
                        : t.status === "ready"
                          ? `You can send Form 4A now. The new rent could start on ${nice(t.earliest_new_rent)}.`
                          : `You can send Form 4A from ${nice(t.notice_from)}, for a new rent starting on ${nice(t.earliest_new_rent)}.`}
                  {t.kind === "assured" && t.status !== "pending" && t.suggested_rent > t.rent && (
                    <> Suggested new rent: <b>{pounds(t.suggested_rent)}</b> (check what similar homes let for).</>
                  )}
                </p>

                <div className="mt-3 flex flex-wrap gap-2">
                  {t.kind === "assured" && t.status !== "pending" && data && (
                    <>
                      <a href={data.form_url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold shadow-raised hover:bg-muted">
                        <FileText className="size-4" /> Get Form 4A
                      </a>
                      <Button className="h-10 rounded-full" variant={open === t.key ? "outline" : "default"} onClick={() => setOpen(open === t.key ? null : t.key)}>
                        <CalendarClock className="size-4" /> I've sent the notice
                      </Button>
                    </>
                  )}
                  {t.kind === "company" && (
                    <Button className="h-10 rounded-full" variant="outline" onClick={() => navigate("/letters")}>
                      <FileText className="size-4" /> Write a new agreement
                    </Button>
                  )}
                </div>

                {open === t.key && <RecordNotice t={t} onSaved={() => { setOpen(null); void load(); }} />}
              </li>
            );
          })}
        </ul>
      </div>
    </PageShell>
  );
}

function RecordNotice({ t, onSaved }: { t: Tenancy; onSaved: () => void }) {
  const app = useApp();
  const today = new Date().toISOString().slice(0, 10);
  const [served, setServed] = useState(today);
  const [starts, setStarts] = useState(t.earliest_new_rent ?? "");
  const [rent, setRent] = useState(String(t.suggested_rent || t.rent || ""));
  const [busy, setBusy] = useState(false);
  async function save() {
    setBusy(true);
    try {
      await api("POST", "/api/renewals/review", { property_id: t.property_id, room: t.room, notice_served: served, takes_effect: starts, old_rent: t.rent, new_rent: Number(rent) });
      onSaved();
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="mt-3 grid gap-3 rounded-2xl bg-muted p-3 sm:grid-cols-4">
      <label className="text-xs font-semibold text-muted-foreground">Sent on<input type="date" value={served} onChange={(e) => setServed(e.target.value)} className="mt-1 h-10 w-full rounded-xl border bg-card px-2 text-sm text-foreground" /></label>
      <label className="text-xs font-semibold text-muted-foreground">New rent starts<input type="date" value={starts} onChange={(e) => setStarts(e.target.value)} className="mt-1 h-10 w-full rounded-xl border bg-card px-2 text-sm text-foreground" /></label>
      <label className="text-xs font-semibold text-muted-foreground">New rent (£ a month)<input inputMode="decimal" value={rent} onChange={(e) => setRent(e.target.value)} className="mt-1 h-10 w-full rounded-xl border bg-card px-2 text-sm text-foreground" /></label>
      <div className="flex items-end"><Button className="h-10 w-full" disabled={busy || !served || !starts || !(Number(rent) > 0)} onClick={save}>{busy ? "Saving…" : "Save"}</Button></div>
      <p className="text-xs text-muted-foreground sm:col-span-4">Saving keeps a record and adds a reminder to your to-do list for the day the new rent starts.</p>
    </div>
  );
}

function Tile({ n, label, color }: { n: number; label: string; color: string }) {
  return (
    <div className="rounded-2xl bg-card p-3.5 shadow-card">
      <span className="display block text-3xl" style={{ color: n ? color : "var(--muted-foreground)" }}>{n}</span>
      <span className="text-sm font-medium text-muted-foreground">{label}</span>
    </div>
  );
}

function Pill({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} className={cn("h-9 rounded-full px-4 text-sm font-semibold", on ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-card")}>
      {children}
    </button>
  );
}
