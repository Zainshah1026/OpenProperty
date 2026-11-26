import { useCallback, useEffect, useMemo, useState } from "react";
import { Building, Handshake, PieChart, Plus, Sparkles, Trash2, Wallet } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn, formatDate, formatMoney } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ConfirmDelete } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { PageShell } from "@/components/page-shell";

type Kind = "ltd" | "jv" | "llp" | "partnership" | "personal" | "other";
const KIND_LABEL: Record<Kind, string> = {
  ltd: "Limited company (SPV)",
  jv: "Joint venture",
  llp: "LLP",
  partnership: "Partnership",
  personal: "Owned personally",
  other: "Other",
};
const ROLES = ["Shareholder", "Director & shareholder", "Partner", "Investor", "Director"];

interface Member { id?: number; name: string; user_id: number | null; share: number; role: string | null; invested: number | null; is_me?: boolean }
interface Home { id: number; ref: string | null; name: string; address: string | null; owner: string | null; stake: number; monthly_net: number; rent_in: number; equity: number | null }
interface Company {
  id: number; name: string; kind: Kind; company_number: string | null; incorporated_on: string | null; registered_address: string | null; notes: string | null;
  members: Member[]; properties: Home[]; allocated: number; monthly_net: number; rent_in: number; equity: number | null; value: number | null;
  my_share: number | null; my_monthly: number | null; my_equity: number | null; my_invested: number | null;
}
interface Overview {
  companies: Company[];
  suggestions: { name: string; property_ids: number[] }[];
  people: { id: number; name: string }[];
  me: { id: number; name: string } | null;
  totals: { companies: number; my_companies: number; my_monthly: number; my_equity: number };
}

const norm = (name: string) => name.trim().toLowerCase().replace(/\s+/g, " ");
const round2 = (n: number) => Math.round(n * 100) / 100;
const PERSON_KEY = "companies-person";

interface PersonStats { key: string; name: string; companies: number; monthly: number; equity: number; invested: number; homes: number }

/** Each shareholder's totals across every company, matched by name (case and spacing ignored). */
function statsByPerson(companies: Company[]): PersonStats[] {
  const map = new Map<string, PersonStats>();
  for (const c of companies) {
    const shares = new Map<string, { name: string; share: number; invested: number }>();
    for (const m of c.members) {
      const k = norm(m.name);
      if (!k) continue;
      const cur = shares.get(k) ?? { name: m.name.trim(), share: 0, invested: 0 };
      cur.share += m.share || 0;
      cur.invested += m.invested || 0;
      shares.set(k, cur);
    }
    for (const [k, v] of shares) {
      const p = map.get(k) ?? { key: k, name: v.name, companies: 0, monthly: 0, equity: 0, invested: 0, homes: 0 };
      // Prefer the capitalised spelling of a name.
      if (/^[A-Z]/.test(v.name) && !/^[A-Z]/.test(p.name)) p.name = v.name;
      p.companies += 1;
      p.monthly += (c.monthly_net * v.share) / 100;
      p.equity += ((c.equity ?? 0) * v.share) / 100;
      p.invested += v.invested;
      p.homes += c.properties.length;
      map.set(k, p);
    }
  }
  return [...map.values()]
    .map((p) => ({ ...p, monthly: round2(p.monthly), equity: round2(p.equity), invested: round2(p.invested) }))
    .sort((a, b) => b.companies - a.companies || b.equity - a.equity);
}

const pct = (n: number) => `${Number.isInteger(n) ? n : n.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}%`;

export function CompaniesPage({ navigate }: { navigate: (to: string) => void }) {
  const { setError } = useApp();
  const [data, setData] = useState<Overview | null>(null);
  const [editing, setEditing] = useState<{ company: Company | null; preset?: { name: string; property_ids: number[] } } | null>(null);

  const load = useCallback(() => {
    api<Overview>("GET", "/api/companies").then(setData).catch((e) => setError((e as Error).message));
  }, [setError]);
  useEffect(load, [load]);

  const people = useMemo(() => statsByPerson(data?.companies ?? []), [data]);
  const [personKey, setPersonKey] = useState<string>(() => {
    try { return localStorage.getItem(PERSON_KEY) ?? ""; } catch { return ""; }
  });
  // Default: Nabeel Shahid if he's a shareholder, otherwise whoever is in the most companies.
  const person = people.find((p) => p.key === personKey) ?? people.find((p) => p.key === "nabeel shahid") ?? people[0] ?? null;
  const choose = (k: string) => {
    setPersonKey(k);
    try { localStorage.setItem(PERSON_KEY, k); } catch { /* storage unavailable */ }
  };
  // Each company seen from the chosen person's side.
  const companies = useMemo(
    () =>
      (data?.companies ?? []).map((c) => {
        const ms = c.members.map((m) => ({ ...m, is_me: !!person && norm(m.name) === person.key }));
        const theirs = ms.filter((m) => m.is_me);
        const share = theirs.length ? round2(theirs.reduce((a, m) => a + (m.share || 0), 0)) : null;
        return {
          ...c,
          members: ms,
          my_share: share,
          my_monthly: share != null ? round2((c.monthly_net * share) / 100) : null,
          my_equity: share != null && c.equity != null ? round2((c.equity * share) / 100) : null,
          my_invested: share != null ? round2(theirs.reduce((a, m) => a + (m.invested || 0), 0)) : null,
        };
      }),
    [data, person],
  );
  const mine = useMemo(() => companies.filter((c) => c.my_share != null), [companies]);
  const all = useMemo(
    () => ({
      monthly: round2(companies.reduce((a, c) => a + c.monthly_net, 0)),
      equity: round2(companies.reduce((a, c) => a + (c.equity ?? 0), 0)),
      homes: companies.reduce((a, c) => a + c.properties.length, 0),
    }),
    [companies],
  );

  return (
    <PageShell
      title="Companies & JVs"
      meta={data ? `${data.totals.companies} compan${data.totals.companies === 1 ? "y" : "ies"} · ${all.homes} homes · ${formatMoney(all.monthly)} a month profit · ${formatMoney(all.equity)} equity` : "Loading…"}
      actions={<Button onClick={() => setEditing({ company: null })}><Plus /> Add company or JV</Button>}
    >
      {data && data.suggestions.length > 0 && (
        <div className="flex flex-col gap-3 rounded-xl bg-info-tint px-4 py-3 text-sm text-info">
          <span className="flex items-center gap-2 font-semibold"><Sparkles className="size-4 shrink-0" /> Owners from your sheet that aren't set up yet</span>
          <div className="flex flex-wrap gap-2">
            {data.suggestions.slice(0, 12).map((s) => (
              <Button key={s.name} size="sm" variant="secondary" onClick={() => setEditing({ company: null, preset: s })}>
                {s.name} · {s.property_ids.length} home{s.property_ids.length === 1 ? "" : "s"}
              </Button>
            ))}
          </div>
        </div>
      )}

      {people.length > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <label htmlFor="co-person" className="text-sm font-medium">Show shares for</label>
          <select id="co-person" className="h-9 rounded-lg border border-input bg-card px-2.5 text-sm" value={person?.key ?? ""} onChange={(e) => choose(e.target.value)}>
            {people.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
          </select>
        </div>
      )}

      <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat icon={<PieChart className="size-4" />} label={`Companies ${person ? person.name.split(" ")[0] : "you"} holds shares in`} value={person ? String(person.companies) : "–"} sub={person ? `${person.homes} homes between them` : ""} />
        <Stat icon={<Wallet className="size-4" />} label="Share of monthly profit" value={person ? formatMoney(person.monthly) : "–"} sub={person ? `${formatMoney(person.monthly * 12)} a year · rent in less costs` : ""} />
        <Stat icon={<Building className="size-4" />} label="Share of equity" value={person ? formatMoney(person.equity) : "–"} sub="Value less mortgages, where a value is recorded" />
        <Stat icon={<Handshake className="size-4" />} label="Money put in" value={person ? formatMoney(person.invested) : "–"} sub={person && person.invested ? `${formatMoney(person.equity - person.invested)} equity above that` : "Add it on each shareholder"} />
      </section>

      {data && data.companies.length === 0 && (
        <Card className="flex flex-col items-center gap-3 p-10 text-center">
          <Handshake className="size-10 text-brand" aria-hidden />
          <p className="text-lg font-semibold">No companies or JVs yet</p>
          <p className="max-w-md text-sm text-muted-foreground">Add each company or joint venture that buys homes, who holds its shares, and which homes it owns. You'll see your own share of each.</p>
          <Button onClick={() => setEditing({ company: null })}><Plus /> Add company or JV</Button>
        </Card>
      )}

      {mine.length > 0 && <h2 className="section-label">{person?.name}'s companies</h2>}
      <div className="grid gap-4 lg:grid-cols-2">
        {mine.map((c) => <CompanyCard key={c.id} c={c} onEdit={() => setEditing({ company: c })} navigate={navigate} />)}
      </div>

      {data && companies.length > mine.length && <h2 className="section-label">{mine.length ? `Not ${person?.name ?? "yours"}` : "All companies"}</h2>}
      <div className="grid gap-4 lg:grid-cols-2">
        {companies.filter((c) => c.my_share == null).map((c) => <CompanyCard key={c.id} c={c} onEdit={() => setEditing({ company: c })} navigate={navigate} />)}
      </div>

      {people.length > 1 && (
        <section className="space-y-3">
          <h2 className="section-label">Every shareholder</h2>
          <Card className="overflow-x-auto p-0">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="text-left text-muted-foreground">
                <tr className="border-b border-border">
                  <th scope="col" className="px-4 py-3 font-medium">Shareholder</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Companies</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Homes</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Profit a month</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Equity</th>
                  <th scope="col" className="px-4 py-3 text-right font-medium">Put in</th>
                </tr>
              </thead>
              <tbody>
                {people.map((p) => (
                  <tr key={p.key} className={cn("border-b border-border last:border-0", p.key === person?.key && "bg-brand-tint")}>
                    <th scope="row" className="px-4 py-3 text-left font-medium">
                      <button type="button" className="text-left hover:underline" onClick={() => choose(p.key)}>{p.name}</button>
                    </th>
                    <td className="data px-4 py-3 text-right">{p.companies}</td>
                    <td className="data px-4 py-3 text-right">{p.homes}</td>
                    <td className="data px-4 py-3 text-right">{formatMoney(p.monthly)}</td>
                    <td className="data px-4 py-3 text-right">{formatMoney(p.equity)}</td>
                    <td className="data px-4 py-3 text-right">{p.invested ? formatMoney(p.invested) : "–"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
          <p className="text-xs text-muted-foreground">Names are matched across companies ignoring capitals and spaces, so "Nabeel shahid" and "Nabeel Shahid" count as one person. "Homes" counts every home in companies they hold shares in.</p>
        </section>
      )}

      {data && (
        <CompanyDialog
          state={editing}
          people={data.people}
          me={person ? { id: 0, name: person.name } : data.me}
          companies={data.companies}
          onClose={(changed) => { setEditing(null); if (changed) load(); }}
        />
      )}
    </PageShell>
  );
}

function CompanyCard({ c, onEdit, navigate }: { c: Company; onEdit: () => void; navigate: (to: string) => void }) {
  const unallocated = Math.round((100 - c.allocated) * 100) / 100;
  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <p className="display truncate text-xl font-medium">{c.name}</p>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {KIND_LABEL[c.kind] ?? c.kind}
            {c.company_number ? ` · No. ${c.company_number}` : ""}
            {c.incorporated_on ? ` · since ${formatDate(c.incorporated_on)}` : ""}
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={onEdit}>Edit</Button>
      </div>

      {c.my_share != null ? (
        <div className="rounded-xl bg-brand-tint px-4 py-3">
          <p className="text-sm text-brand-text">{c.members.find((m) => m.is_me)?.name ?? "Your"}'s share</p>
          <p className="display data text-[2rem] font-medium leading-tight">{pct(c.my_share)}</p>
          <p className="text-sm text-muted-foreground">
            {formatMoney(c.my_monthly ?? 0)} a month{c.my_equity != null ? ` · ${formatMoney(c.my_equity)} equity` : ""}
            {c.my_invested ? ` · you put in ${formatMoney(c.my_invested)}` : ""}
          </p>
        </div>
      ) : (
        <p className="rounded-xl bg-muted px-4 py-3 text-sm text-muted-foreground">No shares held by the person selected above.</p>
      )}

      <div>
        <p className="section-label mb-2">Shareholders</p>
        {c.members.length ? (
          <ul className="space-y-1.5">
            {c.members.map((m, i) => (
              <li key={m.id ?? i} className="flex items-center gap-3 text-sm">
                <span className="min-w-0 flex-1 truncate">
                  <span className={cn("font-medium", m.is_me && "text-brand-text")}>{m.name}</span>
                  {m.role ? <span className="text-muted-foreground"> · {m.role}</span> : null}
                </span>
                <span className="h-2 w-24 overflow-hidden rounded-full bg-muted" aria-hidden>
                  <span className="block h-full rounded-full bg-brand" style={{ width: `${Math.min(100, m.share)}%` }} />
                </span>
                <span className="data w-14 text-right font-medium">{pct(m.share)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No shareholders added yet.</p>
        )}
        {c.members.length > 0 && Math.abs(unallocated) > 0.01 && (
          <p className="mt-2 text-xs text-warning">{unallocated > 0 ? `${pct(unallocated)} not allocated to anyone yet.` : `Shares add up to more than 100%.`}</p>
        )}
      </div>

      <div>
        <p className="section-label mb-2">Homes ({c.properties.length})</p>
        {c.properties.length ? (
          <ul className="space-y-1">
            {c.properties.map((p) => (
              <li key={p.id}>
                <a
                  href={`/properties/${p.id}`}
                  onClick={(e) => { e.preventDefault(); navigate(`/properties/${p.id}`); }}
                  className="flex items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-accent"
                >
                  <span className="min-w-0 flex-1 truncate">{p.ref ? <span className="text-muted-foreground">{p.ref} · </span> : null}{p.name}</span>
                  {p.stake < 100 && <Badge variant="brand">{pct(p.stake)} owned</Badge>}
                  <span className="data text-right">{formatMoney(p.monthly_net)}/mo</span>
                </a>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted-foreground">No homes linked yet. Edit the company to add them.</p>
        )}
        <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 border-t border-border pt-3 text-sm">
          <span>Rent in <b className="data">{formatMoney(c.rent_in)}</b>/mo</span>
          <span>Profit <b className="data">{formatMoney(c.monthly_net)}</b>/mo</span>
          {c.equity != null && <span>Equity <b className="data">{formatMoney(c.equity)}</b></span>}
        </div>
      </div>
    </Card>
  );
}

type Draft = {
  name: string; kind: Kind; company_number: string; incorporated_on: string; registered_address: string; notes: string;
  members: { name: string; user_id: string; share: string; role: string; invested: string }[];
  property_ids: number[];
};

const num = (v: string) => {
  const n = parseFloat(v.replace(/[£,%\s]/g, ""));
  return Number.isFinite(n) ? n : null;
};
const selectCls = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

function CompanyDialog({
  state, people, me, companies, onClose,
}: {
  state: { company: Company | null; preset?: { name: string; property_ids: number[] } } | null;
  people: { id: number; name: string }[];
  me: { id: number; name: string } | null;
  companies: Company[];
  onClose: (changed: boolean) => void;
}) {
  const { properties } = useApp();
  const open = state !== null;
  const company = state?.company ?? null;
  const [d, setD] = useState<Draft | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [homeFilter, setHomeFilter] = useState("");

  useEffect(() => {
    if (!state) return;
    const c = state.company;
    setD({
      name: c?.name ?? state.preset?.name ?? "",
      kind: c?.kind ?? (/\bjv\b|joint/i.test(state.preset?.name ?? "") ? "jv" : "ltd"),
      company_number: c?.company_number ?? "",
      incorporated_on: c?.incorporated_on ?? "",
      registered_address: c?.registered_address ?? "",
      notes: c?.notes ?? "",
      members: c?.members.length
        ? c.members.map((m) => ({ name: m.name, user_id: m.user_id != null ? String(m.user_id) : "", share: String(m.share), role: m.role ?? "", invested: m.invested != null ? String(m.invested) : "" }))
        : me ? [{ name: me.name, user_id: me.id ? String(me.id) : "", share: "100", role: "Director & shareholder", invested: "" }] : [],
      property_ids: c?.properties.map((p) => p.id) ?? state.preset?.property_ids ?? [],
    });
    setMsg(null);
    setHomeFilter("");
  }, [state, me]);

  if (!d) return null;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => (x ? { ...x, [k]: v } : x));
  const setMember = (i: number, patch: Partial<Draft["members"][number]>) =>
    set("members", d.members.map((m, j) => (j === i ? { ...m, ...patch } : m)));
  const total = d.members.reduce((a, m) => a + (num(m.share) ?? 0), 0);
  const otherOwner = new Map<number, string>();
  for (const c of companies) if (c.id !== company?.id) for (const p of c.properties) otherOwner.set(p.id, c.name);
  const homes = properties
    .filter((p) => p.section !== "managed")
    .filter((p) => !homeFilter.trim() || `${p.ref ?? ""} ${p.name} ${p.address ?? ""} ${p.owner ?? ""}`.toLowerCase().includes(homeFilter.trim().toLowerCase()))
    .sort((a, b) => Number(d.property_ids.includes(b.id)) - Number(d.property_ids.includes(a.id)) || a.name.localeCompare(b.name));

  async function save() {
    if (!d) return;
    if (!d.name.trim()) return setMsg("Add the company's name.");
    const members = [];
    for (const m of d.members) {
      if (!m.name.trim() && !m.share.trim()) continue;
      if (!m.name.trim()) return setMsg("Every shareholder needs a name.");
      const share = num(m.share);
      if (share == null || share < 0 || share > 100) return setMsg(`Enter ${m.name}'s share as a percentage, for example 50.`);
      members.push({ name: m.name.trim(), user_id: m.user_id ? Number(m.user_id) : null, share, role: m.role.trim() || null, invested: num(m.invested) });
    }
    const sum = members.reduce((a, m) => a + m.share, 0);
    if (sum > 100.01) return setMsg(`The shares add up to ${pct(Math.round(sum * 100) / 100)}. They can't be more than 100%.`);
    const body = {
      name: d.name.trim(), kind: d.kind, company_number: d.company_number.trim() || null, incorporated_on: d.incorporated_on || null,
      registered_address: d.registered_address.trim() || null, notes: d.notes.trim() || null, members, property_ids: d.property_ids,
    };
    setBusy(true);
    setMsg(null);
    try {
      if (company) await api("PUT", `/api/companies/${company.id}`, body);
      else await api("POST", "/api/companies", body);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    try {
      await api("DELETE", `/api/companies/${company!.id}`);
      onClose(true);
    } catch (err) {
      setMsg((err as Error).message);
    }
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(false); }}>
        <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
          <DialogHeader><DialogTitle>{company ? `Edit ${company.name}` : "Add a company or JV"}</DialogTitle></DialogHeader>

          <div className="grid gap-5">
            <fieldset className="grid gap-3 sm:grid-cols-2">
              <legend className="section-label mb-2">The company</legend>
              <div className="sm:col-span-2">
                <Label className="mb-1 block" htmlFor="co-name">Name</Label>
                <Input id="co-name" value={d.name} placeholder="e.g. Sphere Homes 1 Ltd" autoComplete="off" onChange={(e) => set("name", e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="co-kind">Type</Label>
                <select id="co-kind" className={selectCls} value={d.kind} onChange={(e) => set("kind", e.target.value as Kind)}>
                  {(Object.keys(KIND_LABEL) as Kind[]).map((k) => <option key={k} value={k}>{KIND_LABEL[k]}</option>)}
                </select>
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="co-number">Company number</Label>
                <Input id="co-number" value={d.company_number} placeholder="From Companies House" autoComplete="off" onChange={(e) => set("company_number", e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="co-date">Set up on</Label>
                <Input id="co-date" type="date" value={d.incorporated_on} onChange={(e) => set("incorporated_on", e.target.value)} />
              </div>
              <div>
                <Label className="mb-1 block" htmlFor="co-address">Registered address</Label>
                <Input id="co-address" value={d.registered_address} autoComplete="off" onChange={(e) => set("registered_address", e.target.value)} />
              </div>
            </fieldset>

            <fieldset className="grid gap-3">
              <legend className="section-label mb-2">Shareholders</legend>
              {d.members.map((m, i) => (
                <div key={i} className="grid gap-2 rounded-xl border border-border p-3 sm:grid-cols-[1fr_7rem_auto]">
                  <div>
                    <Label className="mb-1 block" htmlFor={`co-m-${i}`}>Name</Label>
                    <Input
                      id={`co-m-${i}`}
                      list="co-people"
                      value={m.name}
                      autoComplete="off"
                      onChange={(e) => {
                        const match = people.find((p) => p.name.toLowerCase() === e.target.value.trim().toLowerCase());
                        setMember(i, { name: e.target.value, user_id: match ? String(match.id) : "" });
                      }}
                    />
                  </div>
                  <div>
                    <Label className="mb-1 block" htmlFor={`co-s-${i}`}>Share %</Label>
                    <Input id={`co-s-${i}`} inputMode="decimal" value={m.share} placeholder="e.g. 50" onChange={(e) => setMember(i, { share: e.target.value })} />
                  </div>
                  <div className="flex items-end">
                    <Button variant="ghost" size="sm" aria-label={`Remove ${m.name || "this shareholder"}`} onClick={() => set("members", d.members.filter((_, j) => j !== i))}><Trash2 /></Button>
                  </div>
                  <div>
                    <Label className="mb-1 block" htmlFor={`co-r-${i}`}>Role</Label>
                    <select id={`co-r-${i}`} className={selectCls} value={m.role} onChange={(e) => setMember(i, { role: e.target.value })}>
                      <option value="">Not set</option>
                      {ROLES.map((r) => <option key={r} value={r}>{r}</option>)}
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <Label className="mb-1 block" htmlFor={`co-i-${i}`}>Money put in (£, optional)</Label>
                    <Input id={`co-i-${i}`} inputMode="decimal" value={m.invested} onChange={(e) => setMember(i, { invested: e.target.value })} />
                  </div>
                  {m.user_id && <p className="text-xs text-muted-foreground sm:col-span-3">Linked to {people.find((p) => String(p.id) === m.user_id)?.name}'s app login, so they see this as their share.</p>}
                </div>
              ))}
              <datalist id="co-people">{people.map((p) => <option key={p.id} value={p.name} />)}</datalist>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="secondary" size="sm" onClick={() => set("members", [...d.members, { name: "", user_id: "", share: "", role: "Shareholder", invested: "" }])}><Plus /> Add shareholder</Button>
                <span className={cn("text-sm", Math.abs(total - 100) < 0.01 ? "text-success" : total > 100 ? "text-destructive" : "text-muted-foreground")}>
                  Total {pct(Math.round(total * 100) / 100)}{Math.abs(total - 100) < 0.01 ? " ✓" : total > 100 ? ": more than 100%" : ` · ${pct(Math.round((100 - total) * 100) / 100)} left`}
                </span>
              </div>
            </fieldset>

            <fieldset className="grid gap-2">
              <legend className="section-label mb-2">Homes this company owns ({d.property_ids.length})</legend>
              <Input value={homeFilter} placeholder="Search homes…" onChange={(e) => setHomeFilter(e.target.value)} aria-label="Search homes" />
              <ul className="max-h-64 space-y-0.5 overflow-y-auto rounded-xl border border-border p-1">
                {homes.map((p) => {
                  const on = d.property_ids.includes(p.id);
                  const elsewhere = otherOwner.get(p.id);
                  return (
                    <li key={p.id}>
                      <label className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm hover:bg-accent">
                        <input
                          type="checkbox"
                          className="size-4"
                          checked={on}
                          onChange={(e) => set("property_ids", e.target.checked ? [...d.property_ids, p.id] : d.property_ids.filter((x) => x !== p.id))}
                        />
                        <span className="min-w-0 flex-1 truncate">{p.ref ? <span className="text-muted-foreground">{p.ref} · </span> : null}{p.name}</span>
                        {elsewhere && !on && <span className="text-xs text-muted-foreground">in {elsewhere}</span>}
                        {!elsewhere && p.owner && <span className="hidden truncate text-xs text-muted-foreground sm:inline">{p.owner}</span>}
                      </label>
                    </li>
                  );
                })}
                {homes.length === 0 && <li className="px-2 py-3 text-sm text-muted-foreground">No homes match.</li>}
              </ul>
              <p className="text-xs text-muted-foreground">A home can belong to one company. Ticking one that's in another company moves it here. If the company only owns part of a home, set the ownership share on the home itself.</p>
            </fieldset>

            <div>
              <Label className="mb-1 block" htmlFor="co-notes">Notes</Label>
              <Textarea id="co-notes" rows={3} value={d.notes} placeholder="e.g. JV terms, profit split, exit plan" onChange={(e) => set("notes", e.target.value)} />
            </div>

            {msg && <p className="rounded-md bg-destructive-tint px-3 py-2 text-sm text-destructive" role="alert">{msg}</p>}
          </div>

          <DialogFooter className="mt-2">
            {company && <Button variant="destructive" className="sm:mr-auto" onClick={() => setConfirmDelete(true)}>Delete</Button>}
            <Button variant="ghost" onClick={() => onClose(false)}>Cancel</Button>
            <Button onClick={save} disabled={busy}>{busy ? "Saving…" : company ? "Save" : "Add company"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      {company && (
        <ConfirmDelete
          open={confirmDelete}
          onOpenChange={setConfirmDelete}
          title={`Delete ${company.name}?`}
          description="This removes the company, its shareholders and its links to homes. The homes themselves stay. This can't be undone."
          onConfirm={remove}
        />
      )}
    </>
  );
}

function Stat({ icon, label, value, sub }: { icon: React.ReactNode; label: string; value: string; sub: string }) {
  return (
    <Card className="flex flex-col items-start gap-1 p-5">
      <span className="flex w-full items-center gap-2 text-sm text-muted-foreground">
        <span className="inline-flex size-7 items-center justify-center rounded-full bg-brand-tint text-brand-text" aria-hidden>{icon}</span>
        {label}
      </span>
      <span className="display data mt-2 text-[2rem] font-medium leading-none">{value}</span>
      <span className="mt-1 min-h-4 text-xs text-muted-foreground">{sub}</span>
    </Card>
  );
}
