import { useState } from "react";
import { Flame, Zap } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";
import type { Property } from "@/types";

/**
 * All electric / Gas & electric, set right here in the app (not in the
 * sheet). All-electric homes need no gas safety certificate.
 */
export function EnergyPicker({ property, className }: { property: Property; className?: string }) {
  const app = useApp();
  const [value, setValue] = useState(property.energy ?? "");
  const [busy, setBusy] = useState(false);

  async function change(v: string) {
    const prev = value;
    setValue(v);
    setBusy(true);
    try {
      await api("PUT", `/api/properties/${property.id}`, { energy: v || null });
      await app.refreshLookups();
    } catch (err) {
      setValue(prev);
      app.setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tone = value === "all_electric" ? "bg-info-tint text-info" : value === "gas_electric" ? "bg-warning-tint text-warning" : "text-muted-foreground";
  return (
    <span className={cn("inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-xs font-medium", tone, className)} onClick={(e) => e.stopPropagation()}>
      {value === "all_electric" ? <Zap className="size-3.5 shrink-0" /> : value === "gas_electric" ? <Flame className="size-3.5 shrink-0" /> : null}
      <select
        aria-label="Energy"
        value={value}
        disabled={busy}
        onChange={(e) => change(e.target.value)}
        className="cursor-pointer bg-transparent text-xs font-medium outline-none"
      >
        <option value="">Not set</option>
        <option value="all_electric">All electric</option>
        <option value="gas_electric">Gas &amp; electric</option>
      </select>
    </span>
  );
}
