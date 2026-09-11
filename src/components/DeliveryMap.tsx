import { useEffect, useRef, useState } from "react";
import "leaflet/dist/leaflet.css";

type ZoneMarker = { area_id: string; name_ar: string; lat: number; lng: number };

type Props = {
  center: [number, number];
  pin: [number, number] | null;
  zones: ZoneMarker[];
  onPick: (lat: number, lng: number) => void;
};

/** Leaflet + OpenStreetMap tiles - free, no API key. Loaded client-only since
 * leaflet touches `window` at import time and this app is server-rendered. */
export function DeliveryMap({ center, pin, zones, onPick }: Props) {
  const [ready, setReady] = useState(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const modRef = useRef<any>(null);

  useEffect(() => {
    let cancelled = false;
    Promise.all([import("leaflet"), import("react-leaflet")]).then(([leafletMod, rl]) => {
      if (cancelled) return;
      modRef.current = { L: leafletMod.default ?? leafletMod, RL: rl };
      setReady(true);
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!ready || !modRef.current) {
    return <div className="h-64 w-full animate-pulse rounded-card bg-secondary" />;
  }

  const { L, RL } = modRef.current;
  const { MapContainer, TileLayer, Marker, useMapEvents } = RL;

  const pinIcon = L.divIcon({
    className: "",
    html: '<div style="width:26px;height:26px;border-radius:9999px;background:#e11d48;border:3px solid white;box-shadow:0 1px 4px rgba(0,0,0,.4)"></div>',
    iconSize: [26, 26],
    iconAnchor: [13, 13],
  });
  const zoneIcon = L.divIcon({
    className: "",
    html: '<div style="width:10px;height:10px;border-radius:9999px;background:#99999977;border:2px solid #999"></div>',
    iconSize: [10, 10],
    iconAnchor: [5, 5],
  });

  function ClickHandler() {
    useMapEvents({
      click(e: { latlng: { lat: number; lng: number } }) {
        onPick(e.latlng.lat, e.latlng.lng);
      },
    });
    return null;
  }

  return (
    <div className="h-64 w-full overflow-hidden rounded-card border border-border">
      <MapContainer
        center={center}
        zoom={12}
        style={{ height: "100%", width: "100%" }}
        scrollWheelZoom={false}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        <ClickHandler />
        {zones.map((z) => (
          <Marker key={z.area_id} position={[z.lat, z.lng]} icon={zoneIcon} />
        ))}
        {pin ? <Marker position={pin} icon={pinIcon} /> : null}
      </MapContainer>
    </div>
  );
}
