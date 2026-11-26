import { useEffect, useMemo, useState } from "react";
import { Download, Printer, Send, SlidersHorizontal } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { CERTIFICATES, certNeeded, certState, complianceState, dealLabel } from "@/lib/portfolio";
import { Button } from "@/components/ui/button";
import type { Property } from "@/types";
import { buildPortfolioPdf, type ReportColumn, type ReportInput } from "./portfolio-pdf";

/**
 * A portfolio overview to send to someone: branded, always up to date, and
 * downloadable or shareable as a real PDF. Tenant names and arrears are never
 * on it; everything else is a choice, remembered for next time.
 */
const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const district = (zip: string | null) => (zip ? zip.trim().toUpperCase().split(/\s+/)[0] : "");
const area = (p: Property) => [p.city, district(p.zip)].filter(Boolean).join(" ") || "—";
const statusOf = (p: Property) => (p.occupancy === "vacant" ? "Empty" : p.occupancy === "part_occupied" ? "Part let" : "Let");
const TYPE_LABEL: Record<string, string> = {
  flat: "Flat", maisonette: "Maisonette", terraced: "Terraced", semi_detached: "Semi-detached", detached: "Detached",
  bungalow: "Bungalow", commercial: "Commercial", other: "Other",
};
const typeOf = (p: Property) => (p.hmo ? "HMO" : TYPE_LABEL[String(p.type ?? "")] ?? String(p.type ?? "").replace(/_/g, " "));
const kindOf = (p: Property) => (p.section === "managed" ? "Rent to rent (managed)" : p.section === "freehold" ? "Freehold" : "Owned");
const share = (p: Property) => (p.ownership_share && p.ownership_share > 0 ? p.ownership_share / 100 : 1);
const CERT_WORD = { ok: "In date", due_soon: "Due soon", expired: "Expired", missing: "Missing" } as const;
const COMPANY_KIND: Record<string, string> = { ltd: "Limited company", jv: "Joint venture", llp: "LLP", partnership: "Partnership", personal: "Owned personally", other: "Company" };

interface Company { id: number; name: string; kind: string; members: { name: string; share: number }[]; properties: { id: number }[] }

const DEFAULTS = {
  homes: { owned: true, managed: true, freehold: true },
  company: "all",
  figures: { occupancy: true, certs: true, rent: true, profit: false, value: false, equity: false, debt: false, yield: false },
  sections: { holding: true, areas: true, companies: false, shareholders: false, list: true },
  columns: { ref: false, address: false, type: true, beds: true, heldAs: true, status: true, rent: true, value: false, company: false, certs: false, epc: false },
  preparedFor: "",
  note: "",
  contact: "info@spm.co.uk",
};
type Opts = typeof DEFAULTS;
const STORE = "portfolio-report-options";

function loadOpts(): Opts {
  try {
    const saved = JSON.parse(localStorage.getItem(STORE) ?? "null");
    if (!saved) return DEFAULTS;
    return {
      ...DEFAULTS, ...saved,
      homes: { ...DEFAULTS.homes, ...saved.homes },
      figures: { ...DEFAULTS.figures, ...saved.figures },
      sections: { ...DEFAULTS.sections, ...saved.sections },
      columns: { ...DEFAULTS.columns, ...saved.columns },
    };
  } catch {
    return DEFAULTS;
  }
}

const LABELS = {
  homes: { owned: "Homes we own", managed: "Homes we rent & let", freehold: "Freehold buildings" },
  figures: { occupancy: "% let", certs: "Certificates in date", rent: "Rent", profit: "Profit", value: "Value", equity: "Equity", debt: "Mortgages & LTV", yield: "Rental yield" },
  sections: { holding: "How we hold them", areas: "Where they are", companies: "Companies & JVs", shareholders: "Shareholders' %", list: "List of homes" },
  columns: { ref: "Ref", address: "Full address", type: "Type", beds: "Beds", heldAs: "Held as", status: "Status", rent: "Rent", value: "Value", company: "Company", certs: "Certificates", epc: "EPC rating" },
} as const;

export function PortfolioReport() {
  const { properties } = useApp();
  const [opts, setOpts] = useState<Opts>(loadOpts);
  const [companies, setCompanies] = useState<Company[]>([]);
  const [showOptions, setShowOptions] = useState(true);
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    try { localStorage.setItem(STORE, JSON.stringify(opts)); } catch { /* storage unavailable */ }
  }, [opts]);
  useEffect(() => {
    api<{ companies: Company[] }>("GET", "/api/companies").then((r) => setCompanies(r.companies)).catch(() => setCompanies([]));
  }, []);

  const flip = <G extends "homes" | "figures" | "sections" | "columns">(group: G, key: keyof Opts[G]) =>
    setOpts((o) => ({ ...o, [group]: { ...o[group], [key]: !o[group][key] } }));

  const companyOf = useMemo(() => {
    const m = new Map<number, Company>();
    for (const c of companies) for (const p of c.properties) m.set(p.id, c);
    return m;
  }, [companies]);
  const chosen = companies.find((c) => String(c.id) === opts.company) ?? null;

  const homes = useMemo(
    () =>
      [...properties]
        .filter((p) => opts.homes[p.section ?? "owned"] !== false)
        .filter((p) => !chosen || companyOf.get(p.id)?.id === chosen.id)
        .sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true })),
    [properties, opts.homes, chosen, companyOf],
  );

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fileName = `Sphere-${chosen ? chosen.name.replace(/[^A-Za-z0-9]+/g, "-") : "portfolio"}-${new Date().toISOString().slice(0, 10)}.pdf`;

  // Everything the report shows, worked out once and used by both the preview and the PDF.
  const report: ReportInput = useMemo(() => {
    const letting = homes.filter((p) => p.deal_type !== "ground_rent");
    const occupied = letting.filter((p) => p.occupancy !== "vacant").length;
    const rent = homes.reduce((a, p) => a + (p.rent_in || 0), 0);
    const costs = homes.reduce((a, p) => a + (p.rent_out || 0) + (p.other_costs || 0), 0);
    const valued = homes.filter((p) => p.market_value);
    const value = valued.reduce((a, p) => a + (p.market_value ?? 0) * share(p), 0);
    const debt = valued.reduce((a, p) => a + (p.mortgage_balance ?? 0) * share(p), 0);
    const allDebt = homes.reduce((a, p) => a + (p.mortgage_balance ?? 0) * share(p), 0);
    const yieldHomes = valued.filter((p) => p.rent_in > 0 && p.section !== "managed");
    const yieldValue = yieldHomes.reduce((a, p) => a + (p.market_value ?? 0) * share(p), 0);
    const yieldRent = yieldHomes.reduce((a, p) => a + p.rent_in * share(p), 0);
    const beds = homes.reduce((a, p) => a + (p.room_count || p.bedrooms || 0), 0);
    let certsNeeded = 0, certsOk = 0;
    for (const p of homes) for (const c of CERTIFICATES) {
      if (!certNeeded(p, c.key)) continue;
      certsNeeded++;
      if (["ok", "due_soon"].includes(certState(p[c.key]))) certsOk++;
    }
    const f = opts.figures;
    const stats = [
      { big: String(homes.length), label: homes.length === 1 ? "home" : "homes", color: "#c8226f" },
      { big: String(beds), label: "bedrooms / rooms", color: "#7a4de8" },
      ...(f.occupancy ? [{ big: `${letting.length ? Math.round((occupied / letting.length) * 100) : 0}%`, label: "let right now", color: "#12a06a" }] : []),
      ...(f.certs ? [{ big: `${certsNeeded ? Math.round((certsOk / certsNeeded) * 100) : 0}%`, label: "safety certificates in date", color: "#0f9fb0" }] : []),
      ...(f.rent ? [{ big: pounds(rent), label: "rent a month", color: "#12a06a" }, { big: pounds(rent * 12), label: "rent a year", color: "#12a06a" }] : []),
      ...(f.profit ? [{ big: pounds(rent - costs), label: "profit a month", color: "#c8226f" }] : []),
      ...(f.value && value > 0 ? [{ big: pounds(value), label: "property value (our share)", color: "#7a4de8" }] : []),
      ...(f.equity && value > 0 ? [{ big: pounds(value - debt), label: "equity (value less mortgages)", color: "#7a4de8" }] : []),
      ...(f.debt ? [{ big: pounds(allDebt), label: "mortgages outstanding", color: "#5e5960" }, ...(value > 0 ? [{ big: `${Math.round((debt / value) * 100)}%`, label: "loan to value", color: "#5e5960" }] : [])] : []),
      ...(f.yield && yieldValue > 0 ? [{ big: `${((yieldRent * 12 * 100) / yieldValue).toFixed(1)}%`, label: "gross rental yield", color: "#12a06a" }] : []),
    ];

    const byKindMap = new Map<string, { n: number; rent: number }>();
    for (const p of homes) {
      const k = kindOf(p);
      const v = byKindMap.get(k) ?? { n: 0, rent: 0 };
      byKindMap.set(k, { n: v.n + 1, rent: v.rent + (p.rent_in || 0) });
    }
    const byArea = new Map<string, number>();
    for (const p of homes) { const a = district(p.zip) || "Other"; byArea.set(a, (byArea.get(a) ?? 0) + 1); }
    const hmos = homes.filter((p) => p.hmo).length;

    const inReport = new Set(homes.map((p) => p.id));
    const companyCards = companies
      .filter((c) => (chosen ? c.id === chosen.id : c.properties.some((p) => inReport.has(p.id))))
      .map((c) => {
        const own = homes.filter((p) => companyOf.get(p.id)?.id === c.id);
        const cRent = own.reduce((a, p) => a + (p.rent_in || 0) * share(p), 0);
        const cVal = own.reduce((a, p) => a + (p.market_value ?? 0) * share(p), 0);
        const cDebt = own.filter((p) => p.market_value).reduce((a, p) => a + (p.mortgage_balance ?? 0) * share(p), 0);
        const lines = [`${own.length} home${own.length === 1 ? "" : "s"}`];
        if (f.rent && cRent) lines.push(`${pounds(cRent)} rent a month`);
        if (f.value && cVal) lines.push(`${pounds(cVal)} value`);
        if (f.equity && cVal) lines.push(`${pounds(cVal - cDebt)} equity`);
        return {
          name: c.name,
          kind: COMPANY_KIND[c.kind] ?? c.kind,
          lines,
          shareholders: opts.sections.shareholders && c.members.length ? c.members.map((m) => `${m.name} ${m.share}%`).join(" · ") : null,
        };
      });

    const c = opts.columns;
    const cols: { on: boolean; col: ReportColumn; val: (p: Property) => string }[] = [
      { on: c.ref, col: { label: "Ref", weight: 0.06 }, val: (p) => p.ref ?? "—" },
      { on: true, col: { label: c.address ? "Address" : "Area", weight: c.address ? 0.3 : 0.16 }, val: (p) => (c.address ? [p.address || p.name, p.zip].filter(Boolean).join(", ") : area(p)) },
      { on: c.type, col: { label: "Type", weight: 0.13 }, val: typeOf },
      { on: c.beds, col: { label: "Beds", weight: 0.06 }, val: (p) => String(p.room_count || p.bedrooms || "—") },
      { on: c.heldAs, col: { label: "Held as", weight: 0.13 }, val: (p) => (p.section === "managed" ? "Managed" : dealLabel(p.deal_type)) },
      { on: c.company, col: { label: "Company", weight: 0.16 }, val: (p) => companyOf.get(p.id)?.name ?? "—" },
      { on: c.status, col: { label: "Status", weight: 0.09 }, val: statusOf },
      { on: c.certs, col: { label: "Certificates", weight: 0.11 }, val: (p) => CERT_WORD[complianceState(p)] },
      { on: c.epc, col: { label: "EPC", weight: 0.06 }, val: (p) => p.epc_rating ?? "—" },
      { on: c.value, col: { label: "Value", weight: 0.12, align: "right" }, val: (p) => (p.market_value ? pounds(p.market_value * share(p)) : "—") },
      { on: c.rent, col: { label: "Rent / month", weight: 0.12, align: "right", bold: true }, val: (p) => (p.rent_in ? pounds(p.rent_in) : "—") },
    ];
    const used = cols.filter((x) => x.on);

    return {
      today,
      subtitle: chosen ? `${chosen.name} · portfolio overview` : "Property portfolio overview",
      preparedFor: opts.preparedFor.trim(),
      note: opts.note,
      contact: opts.contact,
      stats,
      byKind: opts.sections.holding
        ? [...byKindMap.entries()].sort((a, b) => b[1].n - a[1].n).map(([k, v]) => ({ label: k, n: v.n, detail: f.rent ? `${pounds(v.rent)} a month` : "" }))
        : null,
      totalHomes: homes.length,
      hmoNote: opts.sections.holding && hmos > 0 ? `Including ${hmos} HMO${hmos === 1 ? "" : "s"} (houses in multiple occupation).` : null,
      areas: opts.sections.areas ? [...byArea.entries()].sort((a, b) => b[1] - a[1]).map(([a, n]) => ({ area: a, n })) : null,
      companies: opts.sections.companies && companyCards.length ? companyCards : null,
      table: opts.sections.list
        ? { title: `The homes (${homes.length})`, columns: used.map((x) => x.col), rows: homes.map((p) => used.map((x) => x.val(p))), warnWords: ["Empty", "Expired", "Missing"] }
        : null,
    };
  }, [homes, opts, companies, companyOf, chosen, today]);

  function makePdf(): File {
    return new File([buildPortfolioPdf(report)], fileName, { type: "application/pdf" });
  }

  function download() {
    const file = makePdf();
    const url = URL.createObjectURL(file);
    const a = document.createElement("a");
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
    setNote(`Downloaded ${fileName}.`);
  }

  // On a phone: the share sheet with the PDF attached (WhatsApp, Mail, Messages…).
  const canSendFile = typeof navigator !== "undefined" && "canShare" in navigator;
  async function send() {
    setSending(true);
    setNote(null);
    try {
      const file = makePdf();
      if (navigator.canShare?.({ files: [file] })) {
        await navigator.share({ files: [file], title: "Sphere Property Management portfolio", text: "Our property portfolio overview." });
      } else {
        download();
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") setNote("Couldn't open sharing here, so use Download PDF instead.");
    } finally {
      setSending(false);
    }
  }

  const chip = (on: boolean, label: string, onClick: () => void, key: string) => (
    <button
      key={key}
      type="button"
      onClick={onClick}
      aria-pressed={on}
      className={cn("h-9 rounded-full px-3.5 text-sm font-semibold", on ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-card")}
    >
      {on ? "✓ " : ""}{label}
    </button>
  );
  const group = <G extends "homes" | "figures" | "sections" | "columns">(g: G, title: string) => (
    <div className="flex flex-col gap-2">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</p>
      <div className="flex flex-wrap gap-2">
        {(Object.keys(LABELS[g]) as (keyof Opts[G] & keyof (typeof LABELS)[G])[])
          .filter((k) => !(g === "sections" && k === "shareholders" && !opts.sections.companies))
          .map((k) => chip(!!opts[g][k], String(LABELS[g][k]), () => flip(g, k), `${g}-${String(k)}`))}
      </div>
    </div>
  );
  const field = "h-9 w-full rounded-lg border border-input bg-card px-2.5 text-sm";

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Controls: never printed */}
      <div className="no-print border-b bg-background px-4 py-3 md:px-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          <h1 className="display mr-auto text-xl">Share my portfolio</h1>
          <Button variant="ghost" onClick={() => setShowOptions((v) => !v)} aria-expanded={showOptions}><SlidersHorizontal className="size-4" /> {showOptions ? "Hide options" : "Options"}</Button>
          <Button variant="ghost" onClick={() => window.print()} aria-label="Print"><Printer className="size-4" /></Button>
          <Button variant="secondary" onClick={download}><Download className="size-4" /> Download PDF</Button>
          {canSendFile && <Button onClick={send} disabled={sending}><Send className="size-4" /> {sending ? "Opening…" : "Send PDF"}</Button>}
        </div>

        {showOptions && (
          <div className="mx-auto mt-4 grid max-w-4xl gap-4">
            <div className="flex flex-col gap-2">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Which homes</p>
              <div className="flex flex-wrap items-center gap-2">
                {(Object.keys(LABELS.homes) as (keyof Opts["homes"])[]).map((k) => chip(opts.homes[k], LABELS.homes[k], () => flip("homes", k), `homes-${k}`))}
                {companies.length > 0 && (
                  <select aria-label="Company" className="h-9 rounded-full border border-input bg-card px-3 text-sm font-semibold" value={opts.company} onChange={(e) => setOpts((o) => ({ ...o, company: e.target.value }))}>
                    <option value="all">All companies</option>
                    {companies.map((c) => <option key={c.id} value={String(c.id)}>Only {c.name}</option>)}
                  </select>
                )}
              </div>
            </div>
            {group("figures", "Headline figures")}
            {group("sections", "Sections")}
            {opts.sections.list && group("columns", "Columns in the list of homes")}
            <div className="grid gap-3 sm:grid-cols-2">
              <label className="flex flex-col gap-1 text-sm font-medium">
                Prepared for <span className="text-xs font-normal text-muted-foreground">e.g. a lender, broker or JV partner (optional)</span>
                <input className={field} value={opts.preparedFor} onChange={(e) => setOpts((o) => ({ ...o, preparedFor: e.target.value }))} placeholder="e.g. Barclays Bank" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium">
                Contact details on the PDF <span className="text-xs font-normal text-muted-foreground">Shown at the bottom of every page</span>
                <input className={field} value={opts.contact} onChange={(e) => setOpts((o) => ({ ...o, contact: e.target.value }))} placeholder="e.g. info@spm.co.uk · 020 …" />
              </label>
              <label className="flex flex-col gap-1 text-sm font-medium sm:col-span-2">
                A note at the top (optional)
                <textarea className="min-h-20 w-full rounded-lg border border-input bg-card px-2.5 py-2 text-sm" value={opts.note} onChange={(e) => setOpts((o) => ({ ...o, note: e.target.value }))} placeholder="e.g. As discussed, here is our current portfolio for the refinance of East 7 Ltd." />
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
              <span>Tenant names and arrears are never included. Your choices are remembered for next time.</span>
              <button type="button" className="font-semibold underline" onClick={() => setOpts(DEFAULTS)}>Reset to default</button>
            </div>
          </div>
        )}
        {note && <p className="mx-auto mt-2 max-w-4xl text-sm font-semibold">{note}</p>}
      </div>

      <Preview r={report} />
    </div>
  );
}

/** What the PDF will contain, drawn as a page. */
function Preview({ r }: { r: ReportInput }) {
  const max = r.byKind ? Math.max(1, r.totalHomes) : 1;
  return (
    <article className="report mx-auto my-6 max-w-4xl overflow-hidden rounded-xl bg-white text-[#1a1a1a] shadow-card print:my-0 print:max-w-none print:rounded-none print:shadow-none">
      <header className="flex items-center gap-4 bg-[#1a1a1a] px-8 py-6 text-white">
        <img src="/brand/apple-touch-icon.png" alt="" className="size-14 rounded-xl" />
        <div className="min-w-0 flex-1">
          <p className="text-2xl font-bold leading-tight">Sphere Property Management</p>
          <p className="text-[#ffb3a1]">{r.subtitle}</p>
          {r.preparedFor && <p className="mt-1 text-sm font-semibold">Prepared for {r.preparedFor}</p>}
        </div>
        <p className="text-right text-sm text-[#cfc6cb]">As at<br /><b className="text-white">{r.today}</b></p>
      </header>
      <div className="h-1 bg-gradient-to-r from-[#ff7a59] to-[#e6378f]" />

      <div className="space-y-8 p-8">
        {r.note.trim() && <p className="whitespace-pre-line rounded-xl border-l-4 border-[#c8226f] bg-[#fff4ef] px-4 py-3 text-sm">{r.note}</p>}

        {r.stats.length > 0 && (
          <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {r.stats.map((s) => (
              <div key={s.label} className="break-inside-avoid rounded-xl border-l-4 bg-[#fff4ef] p-3" style={{ borderColor: s.color }}>
                <p className="text-2xl font-bold leading-none" style={{ color: s.color }}>{s.big}</p>
                <p className="mt-1 text-xs text-[#5e5960]">{s.label}</p>
              </div>
            ))}
          </section>
        )}

        {(r.byKind || r.areas) && (
          <section className={cn("grid gap-8", r.byKind && r.areas && "sm:grid-cols-2")}>
            {r.byKind && (
              <div>
                <h2 className="border-l-4 border-[#c8226f] pl-2 text-lg font-bold">How we hold them</h2>
                <ul className="mt-3 space-y-2">
                  {r.byKind.map((k) => (
                    <li key={k.label} className="flex items-center gap-3">
                      <span className="h-2.5 w-28 shrink-0 overflow-hidden rounded-full bg-[#f6e6e1]"><span className="block h-full rounded-full bg-[#c8226f]" style={{ width: `${Math.max(8, (k.n / max) * 100)}%` }} /></span>
                      <span className="text-sm"><b>{k.n} {k.label}</b>{k.detail ? <span className="text-[#5e5960]"> · {k.detail}</span> : null}</span>
                    </li>
                  ))}
                </ul>
                {r.hmoNote && <p className="mt-2 text-xs text-[#5e5960]">{r.hmoNote}</p>}
              </div>
            )}
            {r.areas && (
              <div>
                <h2 className="border-l-4 border-[#c8226f] pl-2 text-lg font-bold">Where they are</h2>
                <ul className="mt-3 flex flex-wrap gap-2">
                  {r.areas.map((a) => <li key={a.area} className="rounded-full border border-[#f3d3c8] bg-[#fff4ef] px-3 py-1 text-sm font-bold text-[#c8226f]">{a.area} <span className="font-normal">×{a.n}</span></li>)}
                </ul>
              </div>
            )}
          </section>
        )}

        {r.companies && (
          <section>
            <h2 className="border-l-4 border-[#c8226f] pl-2 text-lg font-bold">Companies and joint ventures</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {r.companies.map((c) => (
                <div key={c.name} className="break-inside-avoid rounded-xl border border-[#ecdfda] p-4">
                  <p className="font-bold">{c.name}</p>
                  <p className="text-xs text-[#5e5960]">{c.kind}</p>
                  <p className="mt-2 text-sm">{c.lines.join(" · ")}</p>
                  {c.shareholders && <p className="mt-1 text-xs font-bold text-[#c8226f]">{c.shareholders}</p>}
                </div>
              ))}
            </div>
          </section>
        )}

        {r.table && r.table.rows.length > 0 && (
          <section>
            <h2 className="border-l-4 border-[#c8226f] pl-2 text-lg font-bold">{r.table.title}</h2>
            <div className="mt-3 overflow-x-auto">
              <table className="w-full min-w-[560px] text-left text-sm">
                <thead className="bg-[#1a1a1a] text-white">
                  <tr>{r.table.columns.map((c) => <th key={c.label} className={cn("px-2 py-2 font-semibold", c.align === "right" && "text-right")}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {r.table.rows.map((row, i) => (
                    <tr key={i} className="break-inside-avoid border-b border-[#ecdfda] even:bg-[#faf7f5]">
                      {row.map((v, j) => (
                        <td key={j} className={cn("px-2 py-1.5", r.table!.columns[j].align === "right" && "text-right tabular-nums", r.table!.columns[j].bold && "font-bold", r.table!.warnWords?.includes(v) && "text-[#a4462f]")}>{v}</td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        )}

        <footer className="border-t border-[#ecdfda] pt-3 text-xs text-[#5e5960]">
          Prepared by Sphere Property Management on {r.today}{r.contact.trim() ? ` · ${r.contact.trim()}` : ""} · Monthly figures unless stated. Tenant details are not included.
        </footer>
      </div>
    </article>
  );
}
