import { useCallback, useEffect, useState } from "react";
import { api } from "@/api";
import { DEFAULT_LETTERHEAD, LETTERHEAD_KEYS, type Letterhead } from "./templates";

/** Company name, address and signatory printed on letters (kept in Settings). */
export function useLetterhead() {
  const [lh, setLh] = useState<Letterhead>(DEFAULT_LETTERHEAD);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    api<{ settings: Record<string, string> }>("GET", "/api/settings")
      .then(({ settings }) => {
        const next = { ...DEFAULT_LETTERHEAD };
        for (const [k, key] of Object.entries(LETTERHEAD_KEYS) as [keyof Letterhead, string][]) {
          if (settings[key] !== undefined && settings[key] !== "") next[k] = settings[key];
        }
        setLh(next);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const save = useCallback(async (next: Letterhead) => {
    const body: Record<string, string> = {};
    for (const [k, key] of Object.entries(LETTERHEAD_KEYS) as [keyof Letterhead, string][]) body[key] = next[k] ?? "";
    await api("PUT", "/api/settings", body);
    setLh(next);
  }, []);

  return { letterhead: lh, loaded, save };
}
