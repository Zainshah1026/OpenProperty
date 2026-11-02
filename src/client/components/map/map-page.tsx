import { useEffect, useMemo, useRef, useState } from "react";
import { useApp } from "@/context";
import { cn, formatMoney } from "@/lib/utils";
import type { Property } from "@/types";
import { Card } from "@/components/ui/card";
import { PageShell } from "@/components/page-shell";

/*
 * Every home on one map, coloured by the list it sits in.
 *
 * Postcodes are turned into positions with postcodes.io (free, no key, UK
 * only) and remembered in this browser, so the lookup only happens once per
 * postcode. Leaflet is loaded from a CDN the first time the page opens, which
 * keeps it out of the main bundle.
 */

type Section = Property["section"];
type Point = { lat: number; lng: number };

const SECTION_STYLE: Record<Section, { label: string; color: string }> = {
  owned: { label: "Owned", color: "#0b7cc2" },
  managed: { label: "Rent to rent", color: "#e08a1e" },
  freehold: { label: "Freehold", color: "#2f9e5b" },
};

const LEAFLET_VERSION = "1.9.4";
const CACHE_KEY = "map:postcodes:v1";
const POSTCODE_RE = /\b([A-Z]{1,2}\d[A-Z\d]?)\s*(\d[A-Z]{2})\b/i;

/** The postcode from the postcode field, or failing that, from the address. */
function postcodeOf(p: Property): string | null {
  const m = (p.zip || "").match(POSTCODE_RE) || (p.address || "").match(POSTCODE_RE);
  return m ? `${m[1]} ${m[2]}`.toUpperCase() : null;
}

function readCache(): Record<string, Point | null> {
  try {
    return JSON.parse(localStorage.getItem(CACHE_KEY) || "{}");
  } catch {
    return {};
  }
}
function writeCache(c: Record<string, Point | null>) {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(c));
  } catch {
    /* storage full or blocked: the map still works, it just looks up again */
  }
}

/** Looks up any postcodes not already known, 100 at a time. */
async function locate(postcodes: string[]): Promise<Record<string, Point | null>> {
  const cache = readCache();
  const missing = [...new Set(postcodes)].filter((pc) => !(pc in cache));
  for (let i = 0; i < missing.length; i += 100) {
    const batch = missing.slice(i, i + 100);
    const r = await fetch("https://api.postcodes.io/postcodes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ postcodes: batch }),
    });
    if (!r.ok) throw new Error("Couldn't look up postcodes right now.");
    const data = (await r.json()) as { result: { query: string; result: { latitude: number; longitude: number } | null }[] };
    for (const row of data.result) {
      cache[row.query.toUpperCase()] = row.result ? { lat: row.result.latitude, lng: row.result.longitude } : null;
    }
  }
  writeCache(cache);
  return cache;
}

type Leaflet = any; // eslint-disable-line @typescript-eslint/no-explicit-any
let leafletPromise: Promise<Leaflet> | null = null;
function loadLeaflet(): Promise<Leaflet> {
  const w = window as unknown as { L?: Leaflet };
  if (w.L) return Promise.resolve(w.L);
  if (leafletPromise) return leafletPromise;
  leafletPromise = new Promise((resolve, reject) => {
    const css = document.createElement("link");
    css.rel = "stylesheet";
    css.href = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.css`;
    document.head.appendChild(css);
    const s = document.createElement("script");
    s.src = `https://unpkg.com/leaflet@${LEAFLET_VERSION}/dist/leaflet.js`;
    s.onload = () => resolve(w.L);
    s.onerror = () => {
      leafletPromise = null;
      reject(new Error("Couldn't load the map."));
    };
    document.head.appendChild(s);
  });
  return leafletPromise;
}

const esc = (s: unknown) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);

export function MapPage({ navigate }: { navigate: (to: string) => void }) {
  const { properties, setError } = useApp();
  const [points, setPoints] = useState<Record<string, Point | null> | null>(null);
  const [show, setShow] = useState<Record<Section, boolean>>({ owned: true, managed: true, freehold: true });
  const mapEl = useRef<HTMLDivElement>(null);
  const mapRef = useRef<Leaflet>(null);
  const layerRef = useRef<Leaflet>(null);
  const fitted = useRef(false);

  const withPostcode = useMemo(
    () => properties.map((p) => ({ p, pc: postcodeOf(p) })),
    [properties],
  );
  const postcodeKey = withPostcode.map((x) => x.pc ?? "").join(",");

  useEffect(() => {
    const pcs = withPostcode.map((x) => x.pc).filter((x): x is string => !!x);
    locate(pcs).then(setPoints).catch((e) => {
      setError((e as Error).message);
      setPoints(readCache());
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [postcodeKey]);

  // Set the map up once.
  useEffect(() => {
    let cancelled = false;
    loadLeaflet()
      .then((L) => {
        if (cancelled || !mapEl.current || mapRef.current) return;
        const map = L.map(mapEl.current, { scrollWheelZoom: true }).setView([51.5074, -0.1278], 10);
        L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
          maxZoom: 19,
          attribution: "&copy; OpenStreetMap contributors",
        }).addTo(map);
        mapRef.current = map;
        layerRef.current = L.layerGroup().addTo(map);
        // Opening a home from a popup.
        map.on("popupopen", (e: { popup: { getElement: () => HTMLElement } }) => {
          const btn = e.popup.getElement()?.querySelector<HTMLButtonElement>("[data-open]");
          if (btn) btn.onclick = () => navigate(`/properties/${btn.dataset.open}`);
        });
        setPoints((p) => (p ? { ...p } : p)); // draw pins if postcodes came back first
      })
      .catch((e) => setError((e as Error).message));
    return () => {
      cancelled = true;
      mapRef.current?.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Pins: several homes on one postcode share a pin.
  const placed = useMemo(() => {
    if (!points) return [];
    const groups = new Map<string, { pt: Point; homes: Property[] }>();
    for (const { p, pc } of withPostcode) {
      if (!show[p.section]) continue;
      const pt = pc ? points[pc] : null;
      if (!pt) continue;
      const g = groups.get(pc!) ?? { pt, homes: [] };
      g.homes.push(p);
      groups.set(pc!, g);
    }
    return [...groups.entries()].map(([pc, g]) => ({ pc, ...g }));
  }, [points, withPostcode, show]);

  const unplaced = useMemo(
    () => (points ? withPostcode.filter(({ p, pc }) => show[p.section] && (!pc || !points[pc])).map(({ p }) => p) : []),
    [points, withPostcode, show],
  );

  useEffect(() => {
    const L = (window as unknown as { L?: Leaflet }).L;
    const map = mapRef.current;
    const layer = layerRef.current;
    if (!L || !map || !layer) return;
    layer.clearLayers();
    const bounds: [number, number][] = [];
    for (const g of placed) {
      const color = SECTION_STYLE[g.homes[0].section].color;
      const marker = L.circleMarker([g.pt.lat, g.pt.lng], {
        radius: g.homes.length > 1 ? 10 : 8,
        color: "#ffffff",
        weight: 2,
        fillColor: color,
        fillOpacity: 0.95,
      });
      const html = g.homes
        .map((h) => {
          const arrears = h.rent_status === "missed";
          return `<div style="margin:0 0 8px">
            <div style="font-weight:600">${h.ref ? `${esc(h.ref)} · ` : ""}${esc(h.name)}</div>
            <div style="color:#666;font-size:12px">${esc(SECTION_STYLE[h.section].label)} · ${esc(g.pc)}${h.tenant_label ? ` · ${esc(h.tenant_label)}` : ""}</div>
            <div style="font-size:12px">Rent in ${esc(formatMoney(h.rent_in || 0))}/mo${arrears ? ' · <b style="color:#c0392b">Missed rent</b>' : ""}${h.occupancy === "vacant" ? ' · <b style="color:#c0392b">Vacant</b>' : ""}</div>
            <button type="button" data-open="${h.id}" style="margin-top:4px;color:#0b7cc2;font-size:12px;background:none;border:0;padding:0;cursor:pointer">Open →</button>
          </div>`;
        })
        .join("");
      marker.bindPopup(`<div style="max-height:260px;overflow:auto;min-width:200px">${html}</div>`);
      marker.addTo(layer);
      bounds.push([g.pt.lat, g.pt.lng]);
    }
    if (bounds.length && !fitted.current) {
      map.fitBounds(bounds, { padding: [40, 40], maxZoom: 14 });
      fitted.current = true;
    }
  }, [placed]);

  const counts = useMemo(() => {
    const c: Record<Section, number> = { owned: 0, managed: 0, freehold: 0 };
    for (const p of properties) c[p.section] = (c[p.section] ?? 0) + 1;
    return c;
  }, [properties]);
  const pinned = placed.reduce((n, g) => n + g.homes.length, 0);

  return (
    <PageShell
      title="Portfolio map"
      meta={points ? `${pinned} of ${properties.length} homes on the map` : "Finding homes…"}
    >
      <div className="flex flex-wrap gap-2">
        {(Object.keys(SECTION_STYLE) as Section[]).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setShow((v) => ({ ...v, [s]: !v[s] }))}
            aria-pressed={show[s]}
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm transition-colors",
              show[s] ? "border-border bg-card text-foreground" : "border-transparent text-muted-foreground line-through",
            )}
          >
            <span className="size-2.5 rounded-full" style={{ background: SECTION_STYLE[s].color }} aria-hidden />
            {SECTION_STYLE[s].label}
            <span className="tabular-nums text-muted-foreground">{counts[s]}</span>
          </button>
        ))}
      </div>

      <Card className="overflow-hidden p-0">
        <div ref={mapEl} className="h-[65vh] min-h-[360px] w-full" style={{ zIndex: 0 }} />
      </Card>

      {unplaced.length > 0 && (
        <Card className="p-4">
          <p className="mb-2 text-sm font-medium">Not on the map ({unplaced.length})</p>
          <p className="mb-3 text-xs text-muted-foreground">These need a full UK postcode in the Postcode field or the address.</p>
          <ul className="grid gap-1 text-sm sm:grid-cols-2">
            {unplaced.map((p) => (
              <li key={p.id}>
                <button type="button" className="text-primary hover:underline" onClick={() => navigate(`/properties/${p.id}`)}>
                  {p.ref ? `${p.ref} · ` : ""}{p.name}
                </button>
                <span className="text-muted-foreground"> {p.zip ? `(${p.zip})` : "(no postcode)"}</span>
              </li>
            ))}
          </ul>
        </Card>
      )}
    </PageShell>
  );
}
