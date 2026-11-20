import { useEffect, useState } from "react";
import {
  Banknote, Briefcase, Building2, CircleDollarSign, ClipboardList, FileSignature, FileText, Home, House, Inbox, KeyRound, Landmark,
  FolderOpen, ListChecks, LogOut, Share2, Map as MapIcon, Menu, Mic, Moon, Sun, SunMoon, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, Users, Wrench, X, Flame,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { getTheme, nextTheme, setTheme, themeLabel, type Theme } from "@/lib/theme";

export interface NavItem {
  id: string;
  label: string;
  href: string;
  icon: LucideIcon;
}

/** Each group keeps one door colour, so you learn where things are by colour as much as by name. */
export const NAV_GROUPS: { label?: string; color: string; items: NavItem[] }[] = [
  {
    color: "var(--door-yellow)",
    items: [
      { id: "dashboard", label: "Home", href: "/dashboard", icon: House },
      { id: "todo", label: "To-do", href: "/todo", icon: ListChecks },
    ],
  },
  {
    label: "Things to do",
    color: "var(--door-red)",
    items: [
      { id: "approvals", label: "Needs my OK", href: "/approvals", icon: ShieldCheck },
      { id: "maintenance", label: "Repairs", href: "/maintenance", icon: Wrench },
      { id: "compliance", label: "Safety certificates", href: "/compliance", icon: Flame },
      { id: "inbox", label: "Emails", href: "/inbox", icon: Inbox },
      { id: "letters", label: "Letters & contracts", href: "/letters", icon: FileSignature },
    ],
  },
  {
    label: "Our homes",
    color: "var(--door-blue)",
    items: [
      { id: "properties", label: "Homes we own", href: "/properties?section=owned", icon: Building2 },
      { id: "managed", label: "Homes we rent & let", href: "/properties?section=managed", icon: Home },
      { id: "freehold", label: "Freehold buildings", href: "/properties?section=freehold", icon: Landmark },
      { id: "tenants", label: "Tenants", href: "/tenants", icon: Users },
      { id: "leases", label: "Tenancies", href: "/leases", icon: ClipboardList },
      { id: "documents", label: "Documents", href: "/documents", icon: FolderOpen },
      { id: "report", label: "Share my portfolio", href: "/portfolio-report", icon: Share2 },
      { id: "map", label: "Map", href: "/map", icon: MapIcon },
    ],
  },
  {
    label: "Money",
    color: "var(--door-green)",
    items: [
      { id: "rent", label: "Rent & payments", href: "/rent", icon: CircleDollarSign },
      { id: "bank", label: "Bank", href: "/bank", icon: Landmark },
      { id: "mortgages", label: "Mortgages", href: "/mortgages", icon: Banknote },
      { id: "invoices", label: "Invoices", href: "/invoices", icon: FileText },
    ],
  },
  {
    label: "New business",
    color: "var(--door-plum)",
    items: [
      { id: "sales", label: "Houses for sale", href: "/sales", icon: Briefcase },
      { id: "lettings-leads", label: "Landlords to sign up", href: "/lettings-leads", icon: KeyRound },
    ],
  },
  {
    color: "#8a90b8",
    items: [{ id: "settings", label: "Settings", href: "/settings", icon: Settings }],
  },
];

/** Opens the Jarvis chat from anywhere (the panel listens for this). */
export const openJarvis = () => window.dispatchEvent(new Event("open-jarvis"));

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
  const [theme, setThemeState] = useState<Theme>(getTheme);
  const cycleTheme = () => { const t = nextTheme(theme); setTheme(t); setThemeState(t); };
  const ThemeIcon = theme === "dark" ? Moon : theme === "light" ? Sun : SunMoon;

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
          <span className="display text-lg">Chisti &amp; Co.</span>
        </button>
        <button type="button" onClick={cycleTheme} aria-label={`Colours: ${themeLabel(theme)}. Tap to change`} className="ml-auto inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10">
          <ThemeIcon className="size-5" />
        </button>
        {onSearch && (
          <button type="button" onClick={onSearch} aria-label="Search" className="inline-flex size-10 items-center justify-center rounded-lg hover:bg-white/10">
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
              <span className="display truncate text-[1.25rem]">Chisti &amp; Co.</span>
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

        <div className={cn("shrink-0 px-3 pt-3", narrow && "px-2")}>
          <button
            type="button"
            onClick={() => { setMobileOpen(false); openJarvis(); }}
            title={narrow ? "Talk to Jarvis" : undefined}
            className={cn(
              "flex h-12 w-full items-center gap-3 rounded-2xl bg-[var(--door-yellow)] font-semibold text-[var(--door-ink)] shadow-[inset_0_-3px_0_rgba(0,0,0,0.12)] transition hover:brightness-105 active:translate-y-px",
              narrow ? "justify-center" : "px-4",
            )}
          >
            <Mic className="size-5 shrink-0" />
            {!narrow && <span>Talk to Jarvis</span>}
          </button>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 py-4">
          {NAV_GROUPS.map((g, gi) => (
            <div key={gi} className={cn(gi > 0 && "mt-4")}>
              {g.label && (narrow
                ? <div className="mx-auto mb-2 h-1 w-6 rounded-full" style={{ background: g.color }} aria-hidden />
                : <p className="mb-1 flex items-center gap-2 px-3 text-[0.8125rem] font-semibold text-sidebar-foreground/60">
                    <span className="size-2 rounded-full" style={{ background: g.color }} aria-hidden />
                    {g.label}
                  </p>)}
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
                          "flex h-11 items-center gap-3 rounded-xl text-[0.9375rem] font-medium transition-colors duration-150",
                          narrow ? "justify-center px-0" : "px-2",
                          on ? "bg-white/12 text-white" : "text-sidebar-foreground/85 hover:bg-white/6 hover:text-white",
                        )}
                      >
                        <span
                          className={cn("inline-flex size-8 shrink-0 items-center justify-center rounded-lg transition-colors", on ? "text-white" : "text-white/85")}
                          style={{ background: on ? g.color : "rgba(255,255,255,0.07)", color: on && g.color.includes("yellow") ? "var(--door-ink)" : undefined }}
                        >
                          <Icon className="size-[18px]" />
                        </span>
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
          {narrow ? (
            <button type="button" onClick={cycleTheme} title={`Colours: ${themeLabel(theme)}`} className="mb-1 flex h-10 w-full items-center justify-center rounded-lg text-sidebar-foreground/75 hover:bg-white/5 hover:text-white">
              <ThemeIcon className="size-[18px]" />
            </button>
          ) : (
            <div role="radiogroup" aria-label="Colours" className="mb-2 grid grid-cols-3 gap-1 rounded-xl bg-white/[0.06] p-1">
              {([["light", Sun, "Light"], ["dark", Moon, "Dark"], ["auto", SunMoon, "Auto"]] as const).map(([t, Icon, label]) => (
                <button
                  key={t}
                  type="button"
                  role="radio"
                  aria-checked={theme === t}
                  onClick={() => { setTheme(t); setThemeState(t); }}
                  className={cn(
                    "flex h-9 items-center justify-center gap-1.5 rounded-lg text-[0.8125rem] font-semibold transition-colors",
                    theme === t ? "bg-[var(--door-yellow)] text-[var(--door-ink)]" : "text-sidebar-foreground/70 hover:text-white",
                  )}
                >
                  <Icon className="size-4" /> {label}
                </button>
              ))}
            </div>
          )}
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

      {/* Phone: the five things you reach for most, under your thumb. */}
      <nav aria-label="Quick menu" className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden">
        <ul className="grid grid-cols-5">
          {[
            { id: "dashboard", label: "Home", href: "/dashboard", icon: House, color: "var(--door-yellow)" },
            { id: "todo", label: "To-do", href: "/todo", icon: ListChecks, color: "var(--door-blue)" },
            { id: "jarvis", label: "Jarvis", href: "", icon: Mic, color: "var(--door-yellow)" },
            { id: "rent", label: "Money", href: "/rent", icon: CircleDollarSign, color: "var(--door-green)" },
            { id: "maintenance", label: "Repairs", href: "/maintenance", icon: Wrench, color: "var(--door-red)" },
          ].map((t) => {
            const on = t.id === active;
            const Icon = t.icon;
            if (t.id === "jarvis") {
              return (
                <li key={t.id} className="flex justify-center">
                  <button
                    type="button"
                    onClick={openJarvis}
                    aria-label="Talk to Jarvis"
                    className="-mt-5 inline-flex size-16 items-center justify-center rounded-full bg-[var(--door-yellow)] text-[var(--door-ink)] shadow-[0_8px_20px_-8px_rgba(26,29,58,0.6),inset_0_-4px_0_rgba(0,0,0,0.12)] active:translate-y-px"
                  >
                    <Mic className="size-7" />
                  </button>
                </li>
              );
            }
            return (
              <li key={t.id}>
                <a
                  href={t.href}
                  onClick={(e) => { e.preventDefault(); go(t.href); }}
                  aria-current={on ? "page" : undefined}
                  className="flex h-16 flex-col items-center justify-center gap-1 text-[0.75rem] font-semibold"
                >
                  <span
                    className="inline-flex h-8 w-12 items-center justify-center rounded-full transition-colors"
                    style={{ background: on ? t.color : "transparent", color: on ? (t.color.includes("yellow") ? "var(--door-ink)" : "#fff") : "var(--muted-foreground)" }}
                  >
                    <Icon className="size-5" />
                  </span>
                  <span className={on ? "text-foreground" : "text-muted-foreground"}>{t.label}</span>
                </a>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
