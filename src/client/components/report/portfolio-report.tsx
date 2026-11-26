import { useMemo, useState } from "react";
import { Download, Printer, Send } from "lucide-react";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { CERTIFICATES, certNeeded, certState, dealLabel } from "@/lib/portfolio";
import { Button } from "@/components/ui/button";
import type { Property } from "@/types";
import { buildPortfolioPdf } from "./portfolio-pdf";

/**
 * A portfolio overview to send to someone: branded, always up to date, and
 * printable or saveable as a PDF. Tenant names, arrears and anything private
 * are never on it; money, values and full addresses are optional.
 */
const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const district = (zip: string | null) => (zip ? zip.trim().toUpperCase().split(/\s+/)[0] : "");
const area = (p: Property) => [p.city, district(p.zip)].filter(Boolean).join(" ") || "—";
const statusOf = (p: Property) =>
  p.occupancy === "vacant" ? "Empty" : p.occupancy === "part_occupied" ? "Part let" : p.occupancy === "eviction" ? "Let" : "Let";
const TYPE_LABEL: Record<string, string> = {
  flat: "Flat", maisonette: "Maisonette", terraced: "Terraced", semi_detached: "Semi-detached", detached: "Detached",
  bungalow: "Bungalow", commercial: "Commercial", other: "Other",
};
const typeOf = (p: Property) => (p.hmo ? "HMO" : TYPE_LABEL[String(p.type ?? "")] ?? String(p.type ?? "").replace(/_/g, " "));
const kindOf = (p: Property) => (p.section === "managed" ? "Managed (rent to rent)" : p.section === "freehold" ? "Freehold" : "Owned");

export function PortfolioReport() {
  const { properties } = useApp();
  const [opts, setOpts] = useState({ rent: true, profit: false, values: false, addresses: false, list: true });
  const toggle = (k: keyof typeof opts) => setOpts((o) => ({ ...o, [k]: !o[k] }));

  const homes = useMemo(() => [...properties].sort((a, b) => (a.ref ?? "").localeCompare(b.ref ?? "", undefined, { numeric: true })), [properties]);
  const stats = useMemo(() => {
    const letting = homes.filter((p) => p.deal_type !== "ground_rent");
    const occupied = letting.filter((p) => p.occupancy !== "vacant").length;
    const rent = homes.reduce((a, p) => a + (p.rent_in || 0), 0);
    const costs = homes.reduce((a, p) => a + (p.rent_out || 0) + (p.other_costs || 0), 0);
    const value = homes.reduce((a, p) => a + (p.market_value ? p.market_value * ((p.ownership_share ?? 100) / 100) : 0), 0);
    const beds = homes.reduce((a, p) => a + (p.room_count || p.bedrooms || 0), 0);
    let certsNeeded = 0, certsOk = 0;
    for (const p of homes) for (const c of CERTIFICATES) {
      if (!certNeeded(p, c.key)) continue;
      certsNeeded++;
      if (["ok", "due_soon"].includes(certState(p[c.key]))) certsOk++;
    }
    const byKind = new Map<string, { n: number; rent: number }>();
    for (const p of homes) {
      const k = kindOf(p);
      const v = byKind.get(k) ?? { n: 0, rent: 0 };
      byKind.set(k, { n: v.n + 1, rent: v.rent + (p.rent_in || 0) });
    }
    const byArea = new Map<string, number>();
    for (const p of homes) { const a = district(p.zip) || "Other"; byArea.set(a, (byArea.get(a) ?? 0) + 1); }
    return {
      homes: homes.length, beds, occupancy: letting.length ? Math.round((occupied / letting.length) * 100) : 0,
      rent, profit: rent - costs, value, certs: certsNeeded ? Math.round((certsOk / certsNeeded) * 100) : 0,
      hmos: homes.filter((p) => p.hmo).length,
      byKind: [...byKind.entries()].sort((a, b) => b[1].n - a[1].n),
      byArea: [...byArea.entries()].sort((a, b) => b[1] - a[1]),
    };
  }, [homes]);

  const today = new Date().toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
  const fileName = `Sphere-portfolio-${new Date().toISOString().slice(0, 10)}.pdf`;
  const [sending, setSending] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  function makePdf(): File {
    const bytes = buildPortfolioPdf({
      today,
      stats: [
        { big: String(stats.homes), label: stats.homes === 1 ? "home" : "homes", color: "#c8226f" },
        { big: String(stats.beds), label: "bedrooms / rooms", color: "#7a4de8" },
        { big: `${stats.occupancy}%`, label: "let right now", color: "#12a06a" },
        { big: `${stats.certs}%`, label: "safety certificates in date", color: "#0f9fb0" },
        ...(opts.rent ? [{ big: pounds(stats.rent), label: "rent a month", color: "#12a06a" }, { big: pounds(stats.rent * 12), label: "rent a year", color: "#12a06a" }] : []),
        ...(opts.profit ? [{ big: pounds(stats.profit), label: "profit a month", color: "#c8226f" }] : []),
        ...(opts.values && stats.value > 0 ? [{ big: pounds(stats.value), label: "value (our share)", color: "#7a4de8" }] : []),
      ],
      byKind: stats.byKind.map(([k, v]) => ({ label: k, n: v.n, detail: opts.rent ? `${pounds(v.rent)} a month` : "" })),
      totalHomes: stats.homes,
      hmoNote: stats.hmos > 0 ? `Including ${stats.hmos} HMO${stats.hmos === 1 ? "" : "s"} (houses in multiple occupation).` : null,
      areas: stats.byArea.map(([area, n]) => ({ area, n })),
      rows: opts.list
        ? homes.map((p) => ({
            where: opts.addresses ? [p.address || p.name, p.zip].filter(Boolean).join(", ") : area(p),
            type: typeOf(p),
            beds: String(p.room_count || p.bedrooms || "—"),
            heldAs: p.section === "managed" ? "Managed" : dealLabel(p.deal_type),
            status: statusOf(p),
            rent: p.rent_in ? pounds(p.rent_in) : "—",
          }))
        : null,
      showRent: opts.rent,
      addresses: opts.addresses,
    });
    return new File([bytes], fileName, { type: "application/pdf" });
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

  return (
    <div className="min-h-0 flex-1 overflow-auto">
      {/* Controls: never printed */}
      <div className="no-print sticky top-0 z-10 border-b bg-background/95 px-4 py-3 backdrop-blur md:px-8">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-2">
          <h1 className="display mr-auto text-xl">Share my portfolio</h1>
          {(["rent", "profit", "values", "addresses", "list"] as const).map((k) => (
            <button
              key={k}
              type="button"
              onClick={() => toggle(k)}
              aria-pressed={opts[k]}
              className={cn("h-9 rounded-full px-3.5 text-sm font-semibold", opts[k] ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-card")}
            >
              {opts[k] ? "✓ " : ""}{{ rent: "Rent figures", profit: "Profit", values: "Property values", addresses: "Full addresses", list: "List of homes" }[k]}
            </button>
          ))}
          <Button variant="ghost" onClick={() => window.print()} aria-label="Print"><Printer className="size-4" /></Button>
          <Button variant="secondary" onClick={download}><Download className="size-4" /> Download PDF</Button>
          {canSendFile && (
            <Button onClick={send} disabled={sending}><Send className="size-4" /> {sending ? "Opening…" : "Send PDF"}</Button>
          )}
        </div>
        <p className="mx-auto mt-1 max-w-4xl text-xs text-muted-foreground">
          Choose what to include, then <b>Download PDF</b> or <b>Send PDF</b> (on a phone it opens WhatsApp, Mail and the rest with the PDF attached). Tenant names and arrears are never included.
          {note ? <span className="ml-1 font-semibold text-foreground">{note}</span> : null}
        </p>
      </div>

      {/* The report */}
      <article className="report mx-auto my-6 max-w-4xl bg-white p-8 text-[#1a1a1a] shadow-card md:p-12 print:my-0 print:max-w-none print:p-0 print:shadow-none">
        <header className="flex items-center gap-4 border-b-4 border-[#e6378f] pb-5">
          <img src="/brand/apple-touch-icon.png" alt="" className="size-16 rounded-xl object-cover" />
          <div className="min-w-0 flex-1">
            <p className="display text-3xl leading-tight">Sphere Property Management</p>
            <p className="text-base text-[#5e5960]">Property portfolio overview</p>
          </div>
          <p className="text-right text-sm text-[#5e5960]">As at<br /><b className="text-[#1a1a1a]">{today}</b></p>
        </header>

        <section className="mt-8 grid grid-cols-2 gap-4 sm:grid-cols-4">
          <Stat big={String(stats.homes)} label={stats.homes === 1 ? "home" : "homes"} color="#c8226f" />
          <Stat big={String(stats.beds)} label="bedrooms / rooms" color="#7a4de8" />
          <Stat big={`${stats.occupancy}%`} label="let right now" color="#12a06a" />
          <Stat big={`${stats.certs}%`} label="safety certificates in date" color="#0f9fb0" />
          {opts.rent && <Stat big={pounds(stats.rent)} label="rent a month" color="#12a06a" />}
          {opts.rent && <Stat big={pounds(stats.rent * 12)} label="rent a year" color="#12a06a" />}
          {opts.profit && <Stat big={pounds(stats.profit)} label="profit a month" color="#c8226f" />}
          {opts.values && stats.value > 0 && <Stat big={pounds(stats.value)} label="value (our share)" color="#7a4de8" />}
        </section>

        <section className="mt-10 grid gap-8 sm:grid-cols-2">
          <div>
            <h2 className="display text-xl">How we hold them</h2>
            <ul className="mt-3 space-y-2">
              {stats.byKind.map(([k, v]) => (
                <li key={k} className="flex items-center gap-3">
                  <span className="h-3 rounded-full bg-[#c8226f]" style={{ width: `${Math.max(8, (v.n / stats.homes) * 100)}%`, maxWidth: "50%" }} />
                  <span className="text-sm"><b>{v.n}</b> {k}{opts.rent ? ` · ${pounds(v.rent)} a month` : ""}</span>
                </li>
              ))}
            </ul>
            {stats.hmos > 0 && <p className="mt-3 text-sm text-[#5e5960]">Including {stats.hmos} HMO{stats.hmos === 1 ? "" : "s"} (houses in multiple occupation).</p>}
          </div>
          <div>
            <h2 className="display text-xl">Where they are</h2>
            <ul className="mt-3 flex flex-wrap gap-2">
              {stats.byArea.map(([a, n]) => (
                <li key={a} className="rounded-full bg-[#fff4ef] px-3 py-1 text-sm font-semibold text-[#c8226f]">{a} <span className="font-normal">× {n}</span></li>
              ))}
            </ul>
          </div>
        </section>

        {opts.list && (
          <section className="mt-10">
            <h2 className="display text-xl">The homes</h2>
            <table className="mt-3 w-full text-left text-sm">
              <thead className="border-b-2 border-[#1a1a1a] text-[#5e5960]">
                <tr>
                  <th className="py-2 pr-2 font-semibold">{opts.addresses ? "Address" : "Area"}</th>
                  <th className="py-2 pr-2 font-semibold">Type</th>
                  <th className="py-2 pr-2 font-semibold">Beds</th>
                  <th className="py-2 pr-2 font-semibold">Held as</th>
                  <th className="py-2 pr-2 font-semibold">Status</th>
                  {opts.rent && <th className="py-2 text-right font-semibold">Rent / month</th>}
                </tr>
              </thead>
              <tbody>
                {homes.map((p) => (
                  <tr key={p.id} className="break-inside-avoid border-b border-[#ecdfda]">
                    <td className="py-2 pr-2">{opts.addresses ? [p.address || p.name, p.zip].filter(Boolean).join(", ") : area(p)}</td>
                    <td className="py-2 pr-2">{typeOf(p)}</td>
                    <td className="py-2 pr-2">{p.room_count || p.bedrooms || "—"}</td>
                    <td className="py-2 pr-2">{p.section === "managed" ? "Managed" : dealLabel(p.deal_type)}</td>
                    <td className="py-2 pr-2">{statusOf(p)}</td>
                    {opts.rent && <td className="py-2 text-right tabular-nums">{p.rent_in ? pounds(p.rent_in) : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <footer className="mt-10 border-t border-[#ecdfda] pt-4 text-xs text-[#5e5960]">
          Prepared by Sphere Property Management on {today}. Figures are monthly unless stated and come from our own records. Tenant details are not included.
        </footer>
      </article>
    </div>
  );
}

function Stat({ big, label, color }: { big: string; label: string; color: string }) {
  return (
    <div className="break-inside-avoid rounded-2xl border-2 p-4" style={{ borderColor: color }}>
      <p className="display text-3xl leading-none" style={{ color }}>{big}</p>
      <p className="mt-1 text-sm text-[#5e5960]">{label}</p>
    </div>
  );
}
