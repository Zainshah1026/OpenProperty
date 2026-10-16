import { useEffect, useState } from "react";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import { tenantDisplayName } from "@/lib/portfolio";
import type { Tenant } from "@/types";
import { TenantDialog } from "./tenant-dialog";

const NEW = "__new__";

/**
 * Choose a tenant from the Tenants list (or add one on the spot). Used for a
 * whole home on its property page and for each room in a shared house.
 */
export function TenantPicker({
  value, onChange, className, placeholder = "Choose tenant…",
}: {
  value: number | null | undefined;
  onChange: (id: number | null) => Promise<void> | void;
  className?: string;
  placeholder?: string;
}) {
  const app = useApp();
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = () => app.listTenants().then(setTenants).catch(() => {});
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { load(); }, []);

  async function pick(v: string) {
    if (v === NEW) return setAdding(true);
    setBusy(true);
    try {
      await onChange(v ? Number(v) : null);
    } catch (err) {
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const sorted = [...tenants].sort((a, b) => tenantDisplayName(a).localeCompare(tenantDisplayName(b)));

  return (
    <>
      <select
        aria-label="Tenant"
        value={value ? String(value) : ""}
        disabled={busy}
        onChange={(e) => pick(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        className={cn("h-9 max-w-full rounded-lg border border-input bg-card px-2.5 text-sm text-foreground", className)}
      >
        <option value="">{placeholder}</option>
        {sorted.map((t) => (
          <option key={t.id} value={t.id}>
            {tenantDisplayName(t)}{t.tenant_type === "company" ? " (company)" : ""}
          </option>
        ))}
        <option value={NEW}>+ Add a new tenant…</option>
      </select>
      <TenantDialog
        open={adding}
        onOpenChange={setAdding}
        onSaved={async (t) => {
          await load();
          await pick(String(t.id));
        }}
      />
    </>
  );
}
