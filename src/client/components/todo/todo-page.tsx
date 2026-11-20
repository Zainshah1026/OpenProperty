import { useEffect, useMemo, useState } from "react";
import { Banknote, Check, ClipboardCheck, Flame, House, KeyRound, Plus, RotateCcw, ShieldCheck, Trash2, TrendingUp, Wrench } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { PageShell } from "@/components/page-shell";

interface Item {
  key: string;
  kind: "own" | "approval" | "repair" | "certificate" | "rent" | "lead" | "tenancy" | "mortgage" | "review";
  title: string;
  detail?: string | null;
  due?: string | null;
  urgent?: boolean;
  href?: string | null;
  id?: number;
  done?: boolean;
}

const KIND: Record<Item["kind"], { icon: typeof Wrench; color: string; label: string }> = {
  own: { icon: ClipboardCheck, color: "var(--door-blue)", label: "My tasks" },
  approval: { icon: ShieldCheck, color: "var(--door-yellow)", label: "Needs my OK" },
  repair: { icon: Wrench, color: "var(--door-teal)", label: "Repairs" },
  certificate: { icon: Flame, color: "var(--door-plum)", label: "Certificates" },
  rent: { icon: Banknote, color: "var(--door-red)", label: "Rent" },
  lead: { icon: KeyRound, color: "var(--door-blue)", label: "Leads" },
  tenancy: { icon: House, color: "var(--door-green)", label: "Tenancies" },
  mortgage: { icon: Banknote, color: "var(--door-green)", label: "Mortgages" },
  review: { icon: TrendingUp, color: "var(--door-green)", label: "Rent reviews" },
};

const dayLabel = (due: string, today: string) => {
  const diff = Math.round((Date.parse(`${due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
  if (diff < -1) return `${-diff} days late`;
  if (diff === -1) return "Yesterday";
  if (diff === 0) return "Today";
  if (diff === 1) return "Tomorrow";
  if (diff < 7) return new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return new Date(`${due}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
};

type When = "now" | "week" | "later" | "done";
const whenOf = (i: Item, today: string): When => {
  if (i.done) return "done";
  if (i.urgent || (i.due && i.due <= today)) return "now";
  if (i.due && Date.parse(`${i.due}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`) <= 7 * 86_400_000) return "week";
  return "later";
};
const WHEN_LABEL: Record<When, string> = { now: "Do now", week: "This week", later: "Later", done: "Done this week" };

/** Everything that needs doing, from every corner of the app, plus your own tasks. */
export function TodoPage({ navigate }: { navigate: (to: string) => void }) {
  const app = useApp();
  const [items, setItems] = useState<Item[] | null>(null);
  const [today, setToday] = useState("");
  const [filter, setFilter] = useState<Item["kind"] | "all">("all");
  const [title, setTitle] = useState("");
  const [due, setDue] = useState("");
  const [home, setHome] = useState("");
  const [note, setNote] = useState<string | null>(null);

  async function load() {
    try {
      const r = await api<{ items: Item[]; today: string }>("GET", "/api/todo");
      setItems(r.items);
      setToday(r.today);
    } catch (err) {
      app.setError((err as Error).message);
    }
  }
  useEffect(() => { void load(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    try {
      await api("POST", "/api/todo", { title: title.trim(), due_date: due || null, property_id: home ? Number(home) : null });
      setTitle(""); setDue(""); setHome("");
      setNote("Added.");
    } catch (err) {
      app.setError((err as Error).message);
    }
    void load();
  }

  async function tick(i: Item) {
    try {
      if (i.kind === "own" && i.id) {
        await api("PUT", `/api/todo/${i.id}`, { done: !i.done });
        setNote(i.done ? null : "Nice one. ✓");
      } else {
        await api("POST", "/api/todo/hide", { key: i.key, days: 7 });
        setNote("Ticked off for a week. If it still needs doing then, it comes back.");
      }
    } catch (err) {
      app.setError((err as Error).message);
    }
    void load();
  }

  async function remove(i: Item) {
    if (!i.id) return;
    await api("DELETE", `/api/todo/${i.id}`).catch((err) => app.setError((err as Error).message));
    void load();
  }

  const shown = useMemo(() => (items ?? []).filter((i) => filter === "all" || i.kind === filter), [items, filter]);
  const groups = (["now", "week", "later", "done"] as When[]).map((w) => ({ w, rows: shown.filter((i) => whenOf(i, today) === w) })).filter((g) => g.rows.length);
  const kinds = [...new Set((items ?? []).map((i) => i.kind))];
  const nowCount = (items ?? []).filter((i) => whenOf(i, today) === "now").length;
  const sorted = [...app.properties].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true }));

  return (
    <PageShell title="To-do" meta={items ? (nowCount ? `${nowCount} to do now` : "Nothing urgent. Well done!") : "Loading…"} width="max-w-3xl">
      <div className="space-y-5 pb-10">
        <form onSubmit={add} className="flex flex-wrap gap-2 rounded-2xl bg-card p-3 shadow-card">
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Add something to do…"
            className="h-11 min-w-0 flex-[1_1_16rem] rounded-xl border bg-transparent px-3 text-[0.9375rem] outline-none focus:ring-2 focus:ring-ring"
          />
          <input type="date" value={due} onChange={(e) => setDue(e.target.value)} aria-label="When" className="h-11 rounded-xl border bg-transparent px-2 text-sm" />
          <select value={home} onChange={(e) => setHome(e.target.value)} aria-label="Which home" className="h-11 max-w-[12rem] rounded-xl border bg-card px-2 text-sm">
            <option value="">Any home</option>
            {sorted.map((p) => <option key={p.id} value={p.id}>{p.ref ? `${p.ref} · ` : ""}{p.name}</option>)}
          </select>
          <Button type="submit" className="h-11" disabled={!title.trim()}><Plus className="size-4" /> Add</Button>
        </form>
        <p className="-mt-2 text-xs text-muted-foreground">Or tell Jarvis: "remind me to call the plumber on Friday".</p>

        {kinds.length > 1 && (
          <div className="flex gap-1.5 overflow-x-auto pb-1">
            <Chip on={filter === "all"} onClick={() => setFilter("all")}>Everything</Chip>
            {kinds.map((k) => <Chip key={k} on={filter === k} color={KIND[k].color} onClick={() => setFilter(k)}>{KIND[k].label}</Chip>)}
          </div>
        )}

        {note && <p className="text-sm font-medium text-primary">{note}</p>}

        {items && !shown.length && (
          <div className="rounded-3xl bg-card px-6 py-12 text-center shadow-card">
            <p className="display text-2xl">All clear 🎉</p>
            <p className="mt-1 text-muted-foreground">Nothing to do here right now.</p>
          </div>
        )}

        {groups.map((g) => (
          <section key={g.w} className="space-y-2">
            <h2 className={cn("display text-lg", g.w === "now" && "text-[var(--door-red)]")}>
              {WHEN_LABEL[g.w]} <span className="text-muted-foreground">{g.rows.length}</span>
            </h2>
            <ul className="space-y-2">
              {g.rows.map((i) => {
                const k = KIND[i.kind];
                const Icon = k.icon;
                return (
                  <li key={i.key} className={cn("flex items-center gap-3 rounded-2xl bg-card p-3 shadow-card", i.done && "opacity-60")}>
                    <button
                      type="button"
                      onClick={() => tick(i)}
                      aria-label={i.done ? "Not done yet" : "Done"}
                      title={i.kind === "own" ? (i.done ? "Not done yet" : "Done") : "Done for now"}
                      className={cn(
                        "inline-flex size-9 shrink-0 items-center justify-center rounded-full border-2 transition",
                        i.done ? "border-[var(--door-green)] bg-[var(--door-green)] text-white" : "border-input text-transparent hover:border-[var(--door-green)] hover:text-[var(--door-green)]",
                      )}
                    >
                      {i.done ? <RotateCcw className="size-4" /> : <Check className="size-5" />}
                    </button>
                    <button type="button" disabled={!i.href} onClick={() => i.href && navigate(i.href)} className="flex min-w-0 flex-1 items-center gap-3 text-left">
                      <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-xl" style={{ background: k.color, color: k.color.includes("yellow") ? "var(--door-ink)" : "#fff" }}>
                        <Icon className="size-[18px]" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={cn("block font-medium leading-snug", i.done && "line-through")}>{i.title}</span>
                        {i.detail && <span className="block truncate text-[0.8125rem] text-muted-foreground">{i.detail}</span>}
                      </span>
                    </button>
                    {i.due && !i.done && (
                      <span className={cn("shrink-0 rounded-full px-2.5 py-1 text-xs font-semibold", i.due < today ? "bg-destructive-tint text-destructive" : i.due === today ? "bg-warning-tint text-warning" : "bg-muted text-muted-foreground")}>
                        {dayLabel(i.due, today)}
                      </span>
                    )}
                    {i.kind === "own" && i.id && (
                      <button type="button" aria-label="Delete" onClick={() => remove(i)} className="shrink-0 rounded-lg p-1.5 text-muted-foreground hover:text-destructive">
                        <Trash2 className="size-4" />
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>
        ))}
      </div>
    </PageShell>
  );
}

function Chip({ on, color, onClick, children }: { on: boolean; color?: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-semibold transition-colors",
        on ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-card hover:text-foreground",
      )}
    >
      {color && <span className="size-2 rounded-full" style={{ background: color }} aria-hidden />}
      {children}
    </button>
  );
}
