import { useEffect, useState } from "react";
import { Mail, Sparkles } from "lucide-react";
import { api } from "@/api";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Email {
  mailbox: string;
  uid: number;
  sent_at: string | null;
  from_name: string | null;
  from_address: string | null;
  subject: string | null;
  category: string;
  summary: string | null;
}

const CAT: Record<string, { label: string; color: string }> = {
  repair: { label: "Repair", color: "var(--door-teal)" },
  rent: { label: "Rent", color: "var(--door-green)" },
  tenant: { label: "Tenant", color: "var(--door-blue)" },
  certificate: { label: "Certificate", color: "var(--door-plum)" },
  council: { label: "Council", color: "#f59f0b" },
  mortgage: { label: "Mortgage", color: "var(--door-green)" },
  lead: { label: "Lead", color: "var(--door-blue)" },
  contractor: { label: "Contractor", color: "var(--door-teal)" },
  other: { label: "Other", color: "#8a90b8" },
  junk: { label: "Junk", color: "#8a90b8" },
};

/** Every email Jarvis has filed against this home; tap one to read it in the inbox. */
export function PropertyEmails({ propertyId, navigate }: { propertyId: number; navigate: (to: string) => void }) {
  const [emails, setEmails] = useState<Email[] | null>(null);
  const [filter, setFilter] = useState<string>("all");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    api<{ emails: Email[] }>("GET", `/api/emails?property_id=${propertyId}`).then((r) => setEmails(r.emails)).catch(() => setEmails([]));
  }, [propertyId]);

  async function fileRecent() {
    try {
      const r = await api<{ started: boolean; note?: string }>("POST", "/api/emails/file-recent", { per_mailbox: 60 });
      setNote(r.started ? "Jarvis is reading your recent emails. It takes a few minutes; you'll get a notification when it's done." : r.note ?? "Already running.");
    } catch (err) {
      setNote((err as Error).message);
    }
  }

  const cats = [...new Set((emails ?? []).map((e) => e.category))];
  const shown = (emails ?? []).filter((e) => filter === "all" || e.category === filter);

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[1.0625rem] font-semibold leading-tight">Emails about this home</h2>
        <Button size="sm" variant="outline" onClick={fileRecent}><Sparkles className="size-4" /> File my recent emails</Button>
      </div>
      {note && <p className="text-sm font-medium text-primary">{note}</p>}
      {cats.length > 1 && (
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {["all", ...cats].map((c) => (
            <button key={c} type="button" onClick={() => setFilter(c)} className={cn("h-8 shrink-0 rounded-full px-3 text-sm font-semibold", filter === c ? "bg-foreground text-background" : "bg-card text-muted-foreground shadow-card")}>
              {c === "all" ? "All" : CAT[c]?.label ?? c}
            </button>
          ))}
        </div>
      )}
      {emails && !shown.length && (
        <div className="rounded-2xl bg-card p-8 text-center text-sm text-muted-foreground shadow-card">
          No emails filed here yet. New emails are filed automatically as they arrive; tap <b>File my recent emails</b> to sort older ones.
        </div>
      )}
      <ul className="space-y-2">
        {shown.map((e) => {
          const c = CAT[e.category] ?? CAT.other;
          return (
            <li key={`${e.mailbox}:${e.uid}`}>
              <button
                type="button"
                onClick={() => navigate(`/inbox?mailbox=${encodeURIComponent(e.mailbox)}&uid=${e.uid}`)}
                className="flex w-full items-start gap-3 rounded-2xl bg-card p-3 text-left shadow-card hover:bg-muted/50"
              >
                <span className="mt-0.5 inline-flex size-9 shrink-0 items-center justify-center rounded-xl text-white" style={{ background: c.color }}><Mail className="size-4" /></span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">{e.summary || e.subject || "(no subject)"}</span>
                  <span className="block truncate text-[0.8125rem] text-muted-foreground">
                    {e.from_name || e.from_address} · {e.sent_at ? new Date(e.sent_at).toLocaleDateString("en-GB", { day: "numeric", month: "short" }) : ""} · to {e.mailbox}
                  </span>
                </span>
                <span className="shrink-0 rounded-full px-2 py-0.5 text-xs font-semibold text-white" style={{ background: c.color }}>{c.label}</span>
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
