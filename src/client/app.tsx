import { useEffect, useState } from "react";
import { reportLocation } from "@clawnify/app/client";
import { Sidebar } from "./components/sidebar";
import { useAppState } from "./hooks/use-app-state";
import { useRouter, type Route } from "./hooks/use-router";
import { AppContext } from "./context";
import { ErrorBanner } from "./components/error-banner";
import { DashboardPage } from "./components/dashboard/dashboard-page";
import { PropertiesList } from "./components/properties/properties-list";
import { PropertyPage } from "./components/properties/property-page";
import { TenantsList } from "./components/tenants/tenants-list";
import { TenantPage } from "./components/tenants/tenant-page";
import { LeasesPage } from "./components/leases/leases-page";
import { RentPage } from "./components/rent/rent-page";
import { MaintenancePage } from "./components/maintenance/maintenance-page";
import { SettingsPage } from "./components/settings/settings-page";
import { CompliancePage } from "./components/compliance/compliance-page";
import { SalesPage } from "./components/sales/sales-page";
import { InvoicesPage } from "./components/invoices/invoices-page";
import { InboxPage } from "./components/inbox/inbox-page";
import { AssistantPanel } from "./components/assistant-panel";
import { LettersPage } from "./components/letters/letters-page";
import { CommandPalette } from "./components/command-palette";
import { LetterPage } from "./components/letters/letter-page";
import { MortgagesPage } from "./components/mortgages/mortgages-page";
import { LettingsLeadsPage } from "./components/sales/lettings-leads-page";

/** A record page keeps its collection's row lit. */
function activeFor(route: Route, path: string): string {
  if (route.name === "properties" && path.includes("section=managed")) return "managed";
  if (route.name === "properties" && path.includes("section=freehold")) return "freehold";
  if (route.name === "property") return "properties";
  if (route.name === "tenant") return "tenants";
  if (route.name === "letter") return "letters";
  if (route.name === "properties") return "properties";
  return route.name;
}

export function App() {
  const state = useAppState();
  const [searching, setSearching] = useState(false);
  // Ctrl+K / ⌘K opens search from anywhere.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setSearching((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
  const { path, route, navigate } = useRouter();

  // Lets the dashboard restore this exact screen on reload.
  useEffect(() => {
    reportLocation(path);
  }, [path]);

  return (
    <AppContext.Provider value={state}>
      <div className="flex h-screen min-h-0 flex-col overflow-hidden bg-background text-foreground md:flex-row">
        <Sidebar active={activeFor(route, path)} userName={state.me?.name} onNavigate={(href) => navigate(href)} onSearch={() => setSearching(true)} />
        <main className="flex min-w-0 flex-1 flex-col overflow-hidden">
          {state.loading ? (
            <div className="flex flex-1 items-center justify-center text-muted-foreground">
              Loading…
            </div>
          ) : (
            <>
              {route.name === "dashboard" && <DashboardPage navigate={navigate} />}
              {route.name === "properties" && (
                <PropertiesList
                  key={path}
                  navigate={navigate}
                  section={
                    path.includes("section=managed") ? "managed"
                      : path.includes("section=owned") ? "owned"
                      : path.includes("section=freehold") ? "freehold"
                      : "all"
                  }
                />
              )}
              {route.name === "property" && <PropertyPage id={route.id} navigate={navigate} />}
              {route.name === "tenants" && <TenantsList navigate={navigate} />}
              {route.name === "tenant" && <TenantPage id={route.id} navigate={navigate} />}
              {route.name === "leases" && <LeasesPage navigate={navigate} />}
              {route.name === "rent" && <RentPage />}
              {route.name === "maintenance" && <MaintenancePage />}
              {route.name === "compliance" && <CompliancePage navigate={navigate} />}
              {route.name === "sales" && <SalesPage />}
              {route.name === "invoices" && <InvoicesPage />}
              {route.name === "inbox" && <InboxPage />}
              {route.name === "settings" && <SettingsPage />}
              {route.name === "letters" && <LettersPage navigate={navigate} />}
              {route.name === "letter" && <LetterPage key={route.id} id={route.id} navigate={navigate} />}
              {route.name === "mortgages" && <MortgagesPage navigate={navigate} />}
              {route.name === "lettings-leads" && <LettingsLeadsPage />}
              {route.name === "not-found" && (
                <Placeholder title="Not found" message="That page doesn't exist." />
              )}
            </>
          )}
        </main>
        <ErrorBanner />
        <CommandPalette open={searching} onOpenChange={setSearching} navigate={navigate} />
        <AssistantPanel navigate={navigate} />
      </div>
    </AppContext.Provider>
  );
}

function Placeholder({ title, message }: { title: string; message: string }) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-2 p-12 text-center">
      <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
      <p className="text-sm text-muted-foreground">{message}</p>
    </div>
  );
}
