import { useEffect, useState } from "react";
import {
  Banknote, Briefcase, Building2, CircleDollarSign, ClipboardCheck, ClipboardList, FileSignature, FileText, Home, Inbox, Landmark,
  LayoutDashboard, LogOut, Menu, PanelLeftClose, PanelLeftOpen, Search, Settings, Users, Wrench, X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

export const NAV_GROUPS: { label?: string; items: NavItem[] }[] = [
  {
    items: [
      { id: "dashboard", label: "Dashboard", href: "/dashboard", icon: LayoutDashboard },
      { id: "properties", label: "Our properties", href: "/properties?section=owned", icon: Building2 },
      { id: "managed", label: "Rent to rent", href: "/properties?section=managed", icon: Home },
      { id: "freehold", label: "Freehold", href: "/properties?section=freehold", icon: Landmark },
      { id: "mortgages", label: "Mortgages", href: "/mortgages", icon: Banknote },
      { id: "tenants", label: "Tenants", href: "/tenants", icon: Users },
    ],
  },
  {
    label: "Day to day",
    items: [
      { id: "inbox", label: "Inbox", href: "/inbox", icon: Inbox },
      { id: "maintenance", label: "Maintenance", href: "/maintenance", icon: Wrench },
      { id: "compliance", label: "Compliance", href: "/compliance", icon: ClipboardCheck },
      { id: "letters", label: "Letters & contracts", href: "/letters", icon: FileSignature },
      { id: "invoices", label: "Invoices", href: "/invoices", icon: FileText },
    ],
  },
  { label: "Sales", items: [{ id: "sales", label: "Sales leads", href: "/sales", icon: Briefcase }] },
  {
    label: "More",
    items: [
      { id: "leases", label: "Leases", href: "/leases", icon: ClipboardList },
      { id: "rent", label: "Rent ledger", href: "/rent", icon: CircleDollarSign },
      { id: "settings", label: "Settings", href: "/settings", icon: Settings },
    ],
  },
];

const KEY = "nav-collapsed";
const readCollapsed = () => {
  try { return localStorage.getItem(KEY) === "1"; } catch { return false; }
};

/**
 * The app's menu. On a computer it's a navy column on the left that folds
 * down to icons and back; on a phone it hides behind a menu button in a top
 * bar and slides in over the page.
 */
export function Sidebar({ active, userName, onNavigate, onSearch }: { active: string; userName?: string | null; onNavigate: (href: string) => void; onSearch?: () => void }) {
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    try { localStorage.setItem(KEY, collapsed ? "1" : "0"); } catch { /* private mode */ }
  }, [collapsed]);

  useEffect(() => {
    if (!mobileOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setMobileOpen(false); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mobileOpen]);

  const go = (href: string) => {
    setMobileOpen(false);
    onNavigate(href);
  };

  // On a phone the drawer is always full width with labels.
  const narrow = collapsed && !mobileOpen;

  return (
    <>
      {/* Phone top bar */}
      <div className="flex h-14 shrink-0 items-center gap-3 bg-sidebar px-3 text-white md:hidden">
        <button
          type="button"
          onClick={() => setMobileOpen(true)}
          aria-label="Open menu"
          aria-expanded={mobileOpen}
          className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10"
        >
          <Menu className="size-5" />
        </button>
        <button type="button" onClick={() => go("/dashboard")} className="flex items-center gap-2">
          <img src="/brand/favicon.svg" alt="" className="size-7 rounded-md" />
          <span className="display text-lg font-medium">Chisti &amp; Co.</span>
        </button>
        {onSearch && (
          <button type="button" onClick={onSearch} aria-label="Search" className="ml-auto inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10">
            <Search className="size-5" />
          </button>
        )}
      </div>

      {/* Phone backdrop */}
      <div
        className={cn("fixed inset-0 z-40 bg-black/50 transition-opacity duration-200 md:hidden", mobileOpen ? "opacity-100" : "pointer-events-none opacity-0")}
        onClick={() => setMobileOpen(false)}
        aria-hidden
      />

      <aside
        className={cn(
          "z-50 flex h-full shrink-0 flex-col bg-sidebar text-sidebar-foreground",
          // phone: an off-canvas drawer
          "fixed inset-y-0 left-0 w-[280px] max-w-[85vw] transition-transform duration-200 ease-out md:static md:translate-x-0 md:transition-[width]",
          mobileOpen ? "translate-x-0" : "-translate-x-full",
          // computer: full or folded to icons
          collapsed ? "md:w-[76px]" : "md:w-[260px]",
        )}
        aria-label="Main menu"
      >
        <div className={cn("flex h-16 shrink-0 items-center gap-2 border-b border-sidebar-border", narrow ? "justify-center px-2" : "px-4")}>
          {!narrow && (
            <button type="button" onClick={() => go("/dashboard")} className="flex min-w-0 flex-1 items-center gap-2.5 text-left text-white">
              <img src="/brand/favicon.svg" alt="" className="size-7 shrink-0 rounded-md ring-1 ring-white/15" />
              <span className="display truncate text-[1.1875rem] font-medium">Chisti &amp; Co.</span>
            </button>
          )}
          {/* Fold / unfold on a computer; close on a phone. */}
          <button
            type="button"
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            className="hidden size-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-white/10 hover:text-white md:inline-flex"
          >
            {collapsed ? <PanelLeftOpen className="size-[18px]" /> : <PanelLeftClose className="size-[18px]" />}
          </button>
          <button
            type="button"
            onClick={() => setMobileOpen(false)}
            aria-label="Close menu"
            className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg text-sidebar-foreground/70 hover:bg-white/10 hover:text-white md:hidden"
          >
            <X className="size-5" />
          </button>
        </div>

        {onSearch && (
          <div className={cn("shrink-0 px-3 pt-3", narrow && "px-2")}>
            <button
              type="button"
              onClick={() => { setMobileOpen(false); onSearch(); }}
              title={narrow ? "Search (Ctrl+K)" : undefined}
              className={cn(
                "flex h-10 w-full items-center gap-3 rounded-lg bg-white/[0.06] text-sm text-sidebar-foreground/70 ring-1 ring-white/10 transition hover:bg-white/10 hover:text-white",
                narrow ? "justify-center" : "px-3",
              )}
            >
              <Search className="size-[18px] shrink-0 opacity-80" />
              {!narrow && (
                <>
                  <span className="flex-1 text-left">Search…</span>
                  <kbd className="rounded bg-white/10 px-1.5 py-0.5 font-sans text-[11px] text-sidebar-foreground/60">{/Mac|iPhone|iPad/.test(navigator.platform) ? "⌘K" : "Ctrl K"}</kbd>
                </>
              )}
            </button>
          </div>
        )}

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className={cn(gi > 0 && "mt-5")}>
              {g.label && (narrow
                ? <div className="mx-auto mb-2 h-px w-6 bg-white/10" aria-hidden />
                : <p className="mb-1.5 px-3 text-xs font-medium text-sidebar-foreground/45">{g.label}</p>)}
              <ul className="space-y-0.5">
                {g.items.map((item) => {
                  const on = item.id === active;
                  const Icon = item.icon;
                  return (
                    <li key={item.id}>
                      <a
                        href={item.href}
                        onClick={(e) => { e.preventDefault(); go(item.href); }}
                        aria-current={on ? "page" : undefined}
                        title={narrow ? item.label : undefined}
                        className={cn(
                          "flex h-10 items-center gap-3 rounded-lg text-[0.9375rem] font-medium transition-colors duration-150",
                          narrow ? "justify-center px-0" : "px-3",
                          on ? "bg-white/10 text-white shadow-[inset_2px_0_0_#4aa8e6]" : "text-sidebar-foreground/80 hover:bg-white/5 hover:text-white",
                        )}
                      >
                        <Icon className={cn("size-[18px] shrink-0", on ? "text-[#7cc3f0]" : "opacity-80")} />
                        {!narrow && <span className="truncate">{item.label}</span>}
                      </a>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </nav>

        <div className={cn("shrink-0 border-t border-sidebar-border p-3", narrow && "px-2")}>
          <a
            href="/logout"
            title={narrow ? "Sign out" : undefined}
            className={cn("flex h-10 items-center gap-3 rounded-lg text-sm text-sidebar-foreground/75 hover:bg-white/5 hover:text-white", narrow ? "justify-center" : "px-3")}
          >
            <LogOut className="size-[18px] shrink-0 opacity-80" />
            {!narrow && <span className="truncate">Sign out{userName ? ` (${userName})` : ""}</span>}
          </a>
        </div>
      </aside>
    </>
  );
}
