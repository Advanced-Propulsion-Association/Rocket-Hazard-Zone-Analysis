import { useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Circle, Popup, Polyline, Tooltip } from 'react-leaflet';
import L from 'leaflet';

// Fix Leaflet's broken default icon paths under Vite
delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png',
  iconUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png',
  shadowUrl: 'https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png',
});

interface MapPanelProps {
  lat: number;
  lon: number;
  hazardRadius_m: number;
  windBearing?: number | null;
}

/** Convert compass bearing (0=N, 90=E) + distance to a lat/lon offset */
function bearingToLatLon(
  lat: number, lon: number,
  bearing_deg: number, distance_m: number,
): [number, number] {
  const R = 6371000; // Earth radius metres
  const δ = distance_m / R;
  const θ = (bearing_deg * Math.PI) / 180;
  const φ1 = (lat * Math.PI) / 180;
  const λ1 = (lon * Math.PI) / 180;
  const φ2 = Math.asin(Math.sin(φ1) * Math.cos(δ) + Math.cos(φ1) * Math.sin(δ) * Math.cos(θ));
  const λ2 = λ1 + Math.atan2(Math.sin(θ) * Math.sin(δ) * Math.cos(φ1), Math.cos(δ) - Math.sin(φ1) * Math.sin(φ2));
  return [(φ2 * 180) / Math.PI, (λ2 * 180) / Math.PI];
}

/** Build arrowhead polyline points at the tip of the wind line */
function arrowHead(
  lat: number, lon: number,
  bearing_deg: number, arrowLen_m: number,
): Array<[number, number]> {
  const tip = bearingToLatLon(lat, lon, bearing_deg, arrowLen_m * 1.2);
  const left  = bearingToLatLon(tip[0], tip[1], (bearing_deg + 150) % 360, arrowLen_m * 0.18);
  const right = bearingToLatLon(tip[0], tip[1], (bearing_deg - 150 + 360) % 360, arrowLen_m * 0.18);
  return [left, tip, right];
}

export function MapPanel({ lat, lon, hazardRadius_m, windBearing }: MapPanelProps) {
  // Suppress Leaflet's "ResizeObserver loop" console warning (cosmetic in React StrictMode)
  useEffect(() => {
    const handler = (e: ErrorEvent) => {
      if (e.message?.includes('ResizeObserver')) e.stopImmediatePropagation();
    };
    window.addEventListener('error', handler);
    return () => window.removeEventListener('error', handler);
  }, []);

  const windTip = windBearing != null
    ? bearingToLatLon(lat, lon, windBearing, hazardRadius_m * 1.2)
    : null;
  const windArrow = windBearing != null
    ? arrowHead(lat, lon, windBearing, hazardRadius_m)
    : null;

  const bearingLabel = windBearing != null ? (() => {
    const dirs = ['N','NE','E','SE','S','SW','W','NW','N'];
    return dirs[Math.round(windBearing / 45)] + ` (${windBearing}°)`;
  })() : '';

  return (
    <div className="rounded-lg overflow-hidden border border-slate-600" style={{ height: 400 }}>
      <MapContainer
        center={[lat, lon]}
        zoom={13}
        style={{ height: '100%', width: '100%' }}
        scrollWheelZoom={true}
      >
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />

        {/* Hazard zone circle */}
        <Circle
          center={[lat, lon]}
          radius={hazardRadius_m}
          pathOptions={{ color: '#ef4444', fillColor: '#ef4444', fillOpacity: 0.12, weight: 2 }}
        />

        {/* Launch site marker */}
        <Marker position={[lat, lon]}>
          <Popup>
            <strong>Launch Site</strong><br />
            {lat.toFixed(5)}°, {lon.toFixed(5)}°<br />
            Hazard radius: {(hazardRadius_m * 3.28084).toFixed(0)} ft ({hazardRadius_m.toFixed(0)} m)
          </Popup>
        </Marker>

        {/* Wind direction arrow */}
        {windTip && windArrow && (
          <>
            <Polyline
              positions={[[lat, lon], windTip]}
              pathOptions={{ color: '#60a5fa', weight: 2.5, dashArray: '6 4' }}
            >
              <Tooltip permanent direction="right" offset={[8, 0]} className="text-xs">
                Wind {bearingLabel}
              </Tooltip>
            </Polyline>
            <Polyline
              positions={windArrow}
              pathOptions={{ color: '#60a5fa', weight: 2.5 }}
            />
          </>
        )}
      </MapContainer>
    </div>
  );
}
