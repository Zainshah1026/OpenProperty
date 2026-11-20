import { useEffect, useState } from "react";
import { Mic } from "lucide-react";
import { api } from "@/api";
import { openJarvis } from "@/components/sidebar";
import type { PortfolioSummary } from "@/types";

interface HomeCounts {
  rent_today: { count: number; total: number };
  out_today: { count: number; total: number };
  approvals: number;
  repairs_open: number;
  repairs_urgent: number;
  leads_new: number;
}

const pounds = (n: number) => `£${Math.round(n).toLocaleString("en-GB")}`;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

interface Door { key: string; tone: string; color: string; count: string; name: string; say: string; to: string }

/**
 * The home screen: Jarvis on top, then one painted front door for each thing
 * that might need you today. Tap a door to go straight there.
 */
export function FrontDoors({ summary, navigate }: { summary: PortfolioSummary; navigate: (to: string) => void }) {
  const [h, setH] = useState<HomeCounts | null>(null);
  useEffect(() => {
    api<HomeCounts>("GET", "/api/home").then(setH).catch(() => setH(null));
  }, []);

  const certs = summary.compliance.expired + summary.compliance.due_soon;
  const doors: Door[] = [
    {
      key: "rent", tone: "green", color: "var(--door-green)", to: "/rent",
      count: h ? String(h.rent_today.count) : "…",
      name: "Rent due today",
      say: !h ? "Checking…" : h.rent_today.count ? `${pounds(h.rent_today.total)} should arrive` : "Nothing due in today",
    },
    {
      key: "owed", tone: "red", color: summary.arrears_count ? "var(--door-red)" : "var(--door-green)", to: "/rent",
      count: String(summary.arrears_count),
      name: "Behind on rent",
      say: summary.arrears_count ? `${pounds(summary.arrears_total)} owed altogether` : "Everyone is up to date",
    },
    {
      key: "ok", tone: "yellow", color: "var(--door-yellow)", to: "/approvals",
      count: h ? String(h.approvals) : "…",
      name: "Needs my OK",
      say: !h ? "Checking…" : h.approvals ? `Jarvis is waiting for a yes` : "Nothing waiting for you",
    },
    {
      key: "repairs", tone: "teal", color: "var(--door-teal)", to: "/maintenance",
      count: h ? String(h.repairs_open) : "…",
      name: plural(h?.repairs_open ?? 0, "Repair to do", "Repairs to do"),
      say: !h ? "Checking…" : h.repairs_urgent ? `${h.repairs_urgent} ${plural(h.repairs_urgent, "is", "are")} urgent` : h.repairs_open ? "None urgent" : "Nothing broken",
    },
    {
      key: "certs", tone: "plum", color: certs ? "var(--door-plum)" : "var(--door-green)", to: "/compliance",
      count: String(certs),
      name: plural(certs, "Certificate to renew", "Certificates to renew"),
      say: summary.compliance.expired ? `${summary.compliance.expired} already expired` : certs ? "Due in the next 2 months" : "All in date",
    },
    {
      key: "leads", tone: "blue", color: "var(--door-blue)", to: "/lettings-leads",
      count: h ? String(h.leads_new) : "…",
      name: plural(h?.leads_new ?? 0, "New lead", "New leads"),
      say: !h ? "Checking…" : h.leads_new ? "Waiting for a first call" : "No one new right now",
    },
  ];

  return (
    <section aria-label="Today" className="space-y-5">
      <button
        type="button"
        onClick={openJarvis}
        className="flex w-full items-center gap-4 rounded-[1.75rem] bg-[var(--door-ink)] p-3 pr-5 text-left text-white shadow-[0_14px_30px_-18px_rgba(26,29,58,0.8)] transition hover:brightness-110 active:translate-y-px"
      >
        <span className="inline-flex size-14 shrink-0 items-center justify-center rounded-full bg-[var(--door-yellow)] text-[var(--door-ink)]">
          <Mic className="size-7" />
        </span>
        <span className="min-w-0">
          <span className="display block text-xl">What do you need?</span>
          <span className="block text-sm text-white/70">Tap and ask Jarvis. Try "who's behind on rent?"</span>
        </span>
      </button>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
        {doors.map((d) => (
          <button
            key={d.key}
            type="button"
            className="door"
            data-tone={d.color.includes("yellow") ? "yellow" : undefined}
            style={{ ["--door" as string]: d.color }}
            onClick={() => navigate(d.to)}
          >
            <span className="door-count">{d.count}</span>
            <span className="door-name">{d.name}</span>
            <span className="door-say">{d.say}</span>
          </button>
        ))}
      </div>
    </section>
  );
}
