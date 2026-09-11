import { useEffect, useRef, useState } from "react";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type LeafletNamespace = any;

declare global {
  interface Window {
    L?: LeafletNamespace;
  }
}

const LEAFLET_JS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.js";
const LEAFLET_CSS = "https://unpkg.com/leaflet@1.9.4/dist/leaflet.css";

let loadPromise: Promise<void> | null = null;

/** Loads Leaflet via a plain <script>/<link> tag at runtime - never an ES import.
 * This app is server-rendered and deployed to Cloudflare Workers; an npm import of
 * leaflet (even a dynamic one gated to useEffect) still ends up bundled into the
 * worker script and gets evaluated at cold start, which crashed the whole site since
 * Leaflet touches browser globals at module-evaluation time that Workers doesn't
 * have. A runtime script tag is invisible to the bundler, so this can't happen. */
function loadLeaflet(): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.L) return Promise.resolve();
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    if (!document.querySelector(`link[href="${LEAFLET_CSS}"]`)) {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = LEAFLET_CSS;
      document.head.appendChild(link);
    }
    const script = document.createElement("script");
    script.src = LEAFLET_JS;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error("failed to load leaflet"));
    document.head.appendChild(script);
  });
  return loadPromise;
}

type ZoneMarker = { area_id: string; name_ar: string; lat: number; lng: number };

type Props = {
  center: [number, number];
  pin: [number, number] | null;
  zones: ZoneMarker[];
  onPick: (lat: number, lng: number) => void;
};

export function DeliveryMap({ center, pin, zones, onPick }: Props) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const mapRef = useRef<any>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const pinMarkerRef = useRef<any>(null);
  const onPickRef = useRef(onPick);
  onPickRef.current = onPick;
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadLeaflet().then(() => {
      if (cancelled || !containerRef.current || mapRef.current) return;
      const L = window.L as LeafletNamespace;
      const map = L.map(containerRef.current, { scrollWheelZoom: false }).setView(center, 12);
      L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      }).addTo(map);
      const zoneIcon = L.divIcon({
        className: "",
        html: '<div style="width:10px;height:10px;border-radius:9999px;background:#99999977;border:2px solid #999"></div>',
        iconSize: [10, 10],
        iconAnchor: [5, 5],
      });
      for (const z of zones) {
        L.marker([z.lat, z.lng], { icon: zoneIcon }).addTo(map);
      }
      map.on("click", (e: { latlng: { lat: number; lng: number } }) => {
        onPickRef.current(e.latlng.lat, e.latlng.lng);
      });
      mapRef.current = map;
      setReady(true);
    });
    return () => {
      cancelled = true;
      if (mapRef.current) {
        mapRef.current.remove();
        mapRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready || !mapRef.current || !window.L) return;
    const L = window.L as LeafletNamespace;
    if (pinMarkerRef.current) {
      pinMarkerRef.current.remove();
      pinMarkerRef.current = null;
    }
    if (pin) {
      const pinIcon = L.divIcon({
        className: "",
        html: '<div style="width:26px;height:26px;border-radius:9999px;background:#e11d48;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
        iconSize: [26, 26],
        iconAnchor: [13, 13],
      });
      pinMarkerRef.current = L.marker(pin, { icon: pinIcon }).addTo(mapRef.current);
    }
  }, [pin, ready]);

  return (
    <div className="relative h-64 w-full overflow-hidden rounded-card border border-border">
      <div ref={containerRef} className="size-full" />
      {!ready ? <div className="absolute inset-0 animate-pulse bg-secondary" /> : null}
    </div>
  );
}
