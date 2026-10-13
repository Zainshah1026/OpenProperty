import { useEffect, useState } from "react";
import { RefreshCw, Sheet } from "lucide-react";
import { api } from "@/api";
import { useApp } from "@/context";
import { cn } from "@/lib/utils";

interface SyncStatus {
  enabled: boolean;
  running: boolean;
  last_success: string | null;
  error: string | null;
}

function ago(iso: string | null): string {
  if (!iso) return "not yet";
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  return `${hrs} hr${hrs === 1 ? "" : "s"} ago`;
}

/**
 * Shown when the portfolio comes from the Google Sheet: says when it last
 * synced, offers "Sync now", and reminds people to edit the sheet rather
 * than the app (sheet values overwrite app edits at the next sync).
 */
export function SyncBanner({ onSynced }: { onSynced?: () => void }) {
  const { refreshLookups } = useApp();
  const [s, setS] = useState<SyncStatus | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api<SyncStatus>("GET", "/api/sync").then(setS).catch(() => setS(null));
  }, []);

  if (!s?.enabled) return null;

  async function syncNow() {
    setBusy(true);
    try {
      const next = await api<SyncStatus>("POST", "/api/sync");
      setS(next);
      await refreshLookups();
      onSynced?.();
    } catch (err) {
      setS((prev) => (prev ? { ...prev, error: (err as Error).message } : prev));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 rounded-md px-3 py-2 text-xs",
        s.error ? "bg-destructive-tint text-destructive" : "bg-muted text-muted-foreground",
      )}
    >
      <Sheet className="size-3.5 shrink-0" aria-hidden />
      <span>
        {s.error
          ? `Couldn't read the Google Sheet: ${s.error}`
          : `From Nabeel's Google Sheet · updated ${ago(s.last_success)}. Make changes in the sheet — they appear here within 5 minutes.`}
      </span>
      <button
        type="button"
        onClick={syncNow}
        disabled={busy}
        className="ml-auto inline-flex items-center gap-1 font-medium text-primary hover:underline disabled:opacity-50"
      >
        <RefreshCw className={cn("size-3", busy && "animate-spin")} aria-hidden />
        {busy ? "Syncing…" : "Sync now"}
      </button>
    </div>
  );
}
