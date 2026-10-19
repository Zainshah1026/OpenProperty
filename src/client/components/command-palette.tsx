import { useEffect, useMemo, useRef, useState } from "react";
import { Building2, CornerDownLeft, FilePlus2, Search, User, Wrench } from "lucide-react";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { tenantDisplayName } from "@/lib/portfolio";
import type { Tenant } from "@/types";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { NAV_GROUPS } from "./sidebar";

interface Hit {
  key: string;
  label: string;
  sub?: string;
  icon: React.ComponentType<{ className?: string }>;
  to: string;
  group: string;
}

/** ⌘K / Ctrl+K: jump to any property, tenant or page by typing. */
export function CommandPalette({ open, onOpenChange, navigate }: { open: boolean; onOpenChange: (o: boolean) => void; navigate: (to: string) => void }) {
  const app = useApp();
  const [q, setQ] = useState("");
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [sel, setSel] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setSel(0);
    app.listTenants().then(setTenants).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const hits = useMemo<Hit[]>(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const match = (...xs: (string | number | null | undefined)[]) => {
      const hay = xs.filter((x) => x !== null && x !== undefined).join(" ").toLowerCase();
      return words.every((w) => hay.includes(w));
    };
    const actions: Hit[] = [
      { key: "a-letter", label: "New letter or contract", sub: "Arrears, eviction, tenancy and company let templates", icon: FilePlus2, to: "/letters", group: "Actions" },
      { key: "a-repair", label: "Log a repair", sub: "Maintenance", icon: Wrench, to: "/maintenance", group: "Actions" },
    ].filter((a) => !words.length || match(a.label, a.sub));
    const pages: Hit[] = NAV_GROUPS.flatMap((g) => g.items)
      .filter((i) => !words.length || match(i.label))
      .map((i) => ({ key: `p-${i.id}`, label: i.label, icon: i.icon, to: i.href, group: "Pages" }));
    if (!words.length) return [...actions, ...pages];
    const props: Hit[] = app.properties
      .filter((p) => match(p.ref, p.name, p.address, p.zip, p.city, p.owner, p.tenant_label, p.tenant_name))
      .slice(0, 8)
      .map((p) => ({
        key: `h-${p.id}`,
        label: `${p.ref ? `${p.ref} · ` : ""}${p.name}`,
        sub: [p.zip, p.owner, p.tenant_name || p.tenant_label].filter(Boolean).join(" · "),
        icon: Building2,
        to: `/properties/${p.id}`,
        group: "Properties",
      }));
    const people: Hit[] = tenants
      .filter((t) => match(t.first_name, t.last_name, t.company_name, t.email, t.phone, t.linked_homes))
      .slice(0, 6)
      .map((t) => ({ key: `t-${t.id}`, label: tenantDisplayName(t), sub: t.linked_homes || t.email || undefined, icon: User, to: `/tenants/${t.id}`, group: "Tenants" }));
    return [...props, ...people, ...pages, ...actions];
  }, [q, app.properties, tenants]);

  useEffect(() => setSel(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    onOpenChange(false);
    navigate(h.to);
  };

  let lastGroup = "";
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl gap-0 overflow-hidden p-0">
        <DialogTitle className="sr-only">Search</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4">
          <Search className="size-4 text-muted-foreground" />
          <input
            autoFocus
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(hits.length - 1, s + 1)); }
              else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
              else if (e.key === "Enter") { e.preventDefault(); go(hits[sel]); }
            }}
            placeholder="Search properties, tenants, postcodes, pages…"
            className="h-14 flex-1 bg-transparent text-base outline-none placeholder:text-faint"
          />
        </div>
        <div ref={listRef} className="max-h-[60vh] overflow-y-auto p-2">
          {hits.length === 0 && <p className="px-3 py-8 text-center text-sm text-muted-foreground">Nothing matches "{q}".</p>}
          {hits.map((h, i) => {
            const head = h.group !== lastGroup ? (lastGroup = h.group) : null;
            const Icon = h.icon;
            return (
              <div key={h.key}>
                {head && <p className="px-3 pb-1 pt-3 text-xs font-medium text-muted-foreground">{head}</p>}
                <button
                  type="button"
                  data-i={i}
                  onMouseEnter={() => setSel(i)}
                  onClick={() => go(h)}
                  className={cn("flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left", i === sel ? "bg-muted" : "")}
                >
                  <Icon className="size-4 shrink-0 text-muted-foreground" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-medium">{h.label}</span>
                    {h.sub && <span className="block truncate text-xs text-muted-foreground">{h.sub}</span>}
                  </span>
                  {i === sel && <CornerDownLeft className="size-3.5 text-faint" />}
                </button>
              </div>
            );
          })}
        </div>
        <div className="flex gap-4 border-t px-4 py-2 text-[11px] text-muted-foreground">
          <span>↑↓ to move</span><span>Enter to open</span><span>Esc to close</span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
