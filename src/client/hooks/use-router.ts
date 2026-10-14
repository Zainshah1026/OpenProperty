import { useState, useEffect, useCallback } from "react";

export type Route =
  | { name: "dashboard" }
  | { name: "properties" }
  | { name: "property"; id: number }
  | { name: "tenants" }
  | { name: "tenant"; id: number }
  | { name: "leases" }
  | { name: "rent" }
  | { name: "maintenance" }
  | { name: "compliance" }
  | { name: "sales" }
  | { name: "invoices" }
  | { name: "inbox" }
  | { name: "settings" }
  | { name: "not-found" };

function parse(full: string): Route {
  const path = full.split("?")[0];
  if (path === "/" || path === "/dashboard") return { name: "dashboard" };
  if (path === "/properties") return { name: "properties" };
  let m = path.match(/^\/properties\/(\d+)$/);
  if (m) return { name: "property", id: parseInt(m[1], 10) };
  if (path === "/tenants") return { name: "tenants" };
  m = path.match(/^\/tenants\/(\d+)$/);
  if (m) return { name: "tenant", id: parseInt(m[1], 10) };
  if (path === "/leases") return { name: "leases" };
  if (path === "/rent") return { name: "rent" };
  if (path === "/maintenance") return { name: "maintenance" };
  if (path === "/compliance") return { name: "compliance" };
  if (path === "/sales") return { name: "sales" };
  if (path === "/invoices") return { name: "invoices" };
  if (path === "/inbox") return { name: "inbox" };
  if (path === "/settings") return { name: "settings" };
  return { name: "not-found" };
}

export function useRouter() {
  const [path, setPath] = useState<string>(() => window.location.pathname + window.location.search);

  const navigate = useCallback((to: string) => {
    if (to === window.location.pathname + window.location.search) return;
    window.history.pushState(null, "", to);
    setPath(to);
  }, []);

  useEffect(() => {
    const handler = () => setPath(window.location.pathname + window.location.search);
    window.addEventListener("popstate", handler);
    return () => window.removeEventListener("popstate", handler);
  }, []);

  return { path, route: parse(path), navigate };
}
