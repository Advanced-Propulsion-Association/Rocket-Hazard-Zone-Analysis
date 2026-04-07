/**
 * SiteConditions — launch site elevation, temperature, and wind inputs.
 *
 * Elevation can be typed manually or fetched from the browser's Geolocation API
 * (the Open-Elevation service is used to convert lat/lng → elevation AGL).
 * Wind defaults to a typical 20 mph (8.94 m/s) headwind.
 */
import { useState, useCallback } from 'react';

export interface SiteConditionsValue {
  launchAltitude_m: number;   // elevation ASL (m)
  siteTemp_K: number;         // surface air temperature (K)
  windSpeed_ms: number;       // wind speed (m/s)
  windDirection_deg: number;  // wind FROM direction (0 = N, 90 = E, …)
}

interface Props {
  value: SiteConditionsValue;
  onChange: (v: SiteConditionsValue) => void;
}

const DEFAULT: SiteConditionsValue = {
  launchAltitude_m: 0,
  siteTemp_K: 288.15,   // 15 °C / 59 °F (ISA sea level)
  windSpeed_ms: 8.94,   // 20 mph
  windDirection_deg: 0,
};

export { DEFAULT as DEFAULT_SITE_CONDITIONS };

function degC(K: number) { return (K - 273.15).toFixed(1); }
function mphToMs(mph: number) { return mph * 0.44704; }
function msToMph(ms: number) { return ms / 0.44704; }
function mToFt(m: number) { return m * 3.28084; }
function ftToM(ft: number) { return ft / 3.28084; }

export function SiteConditions({ value, onChange }: Props) {
  const [locStatus, setLocStatus] = useState<'idle' | 'locating' | 'fetching' | 'done' | 'error'>('idle');
  const [locMsg, setLocMsg] = useState('');
  const [elevFt, setElevFt] = useState<string>(Math.round(mToFt(value.launchAltitude_m)).toString());
  const [tempF, setTempF] = useState<string>(((value.siteTemp_K - 273.15) * 9 / 5 + 32).toFixed(0));
  const [windMph, setWindMph] = useState<string>(msToMph(value.windSpeed_ms).toFixed(0));

  const set = useCallback((patch: Partial<SiteConditionsValue>) => {
    onChange({ ...value, ...patch });
  }, [value, onChange]);

  // Elevation from GPS + Open-Elevation API
  const handleGeolocate = useCallback(() => {
    if (!navigator.geolocation) { setLocMsg('Geolocation not available in this browser.'); setLocStatus('error'); return; }
    setLocStatus('locating');
    setLocMsg('Getting your location…');
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const { latitude, longitude } = pos.coords;
        setLocStatus('fetching');
        setLocMsg(`Location: ${latitude.toFixed(4)}°N, ${longitude.toFixed(4)}°W — fetching elevation…`);
        try {
          const res = await fetch(
            `https://api.open-elevation.com/api/v1/lookup?locations=${latitude},${longitude}`,
          );
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          const data = await res.json();
          const elev_m: number = data.results?.[0]?.elevation ?? 0;
          const elev_ft = Math.round(mToFt(elev_m));
          setElevFt(elev_ft.toString());
          set({ launchAltitude_m: elev_m });
          setLocStatus('done');
          setLocMsg(`Elevation set to ${elev_ft} ft (${elev_m.toFixed(0)} m) from GPS.`);
        } catch {
          // Open-Elevation may be unavailable — fall back to browser's own altitude if present
          const elev_m = pos.coords.altitude ?? 0;
          const elev_ft = Math.round(mToFt(elev_m));
          setElevFt(elev_ft.toString());
          set({ launchAltitude_m: elev_m });
          setLocStatus('done');
          setLocMsg(`Used GPS altitude: ${elev_ft} ft (accuracy varies).`);
        }
      },
      (err) => {
        setLocStatus('error');
        setLocMsg(`Location error: ${err.message}`);
      },
      { timeout: 10000, enableHighAccuracy: false },
    );
  }, [set]);

  return (
    <details className="mt-3" open>
      <summary className="text-xs text-gray-400 uppercase tracking-wider cursor-pointer select-none hover:text-gray-300">
        Site Conditions
      </summary>
      <div className="mt-2 space-y-2">

        {/* Elevation */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Launch Elevation (ft MSL)</label>
          <div className="flex gap-2">
            <input
              type="number"
              className="flex-1 bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-400"
              value={elevFt}
              onChange={e => {
                setElevFt(e.target.value);
                const ft = parseFloat(e.target.value);
                if (isFinite(ft)) set({ launchAltitude_m: ftToM(ft) });
              }}
            />
            <button
              onClick={handleGeolocate}
              disabled={locStatus === 'locating' || locStatus === 'fetching'}
              className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-gray-700 disabled:text-gray-500 rounded text-white transition-colors"
              title="Use GPS to detect elevation"
            >
              {locStatus === 'locating' || locStatus === 'fetching' ? '…' : 'GPS'}
            </button>
          </div>
          {locMsg && (
            <p className={`text-xs mt-1 ${locStatus === 'error' ? 'text-red-400' : 'text-gray-400'}`}>
              {locMsg}
            </p>
          )}
        </div>

        {/* Temperature */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Surface Temperature (°F)</label>
          <input
            type="number"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-400"
            value={tempF}
            onChange={e => {
              setTempF(e.target.value);
              const f = parseFloat(e.target.value);
              if (isFinite(f)) set({ siteTemp_K: (f - 32) * 5 / 9 + 273.15 });
            }}
          />
          <p className="text-xs text-gray-500 mt-0.5">
            {degC(value.siteTemp_K)} °C — affects air density and speed of sound
          </p>
        </div>

        {/* Wind speed */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">Wind Speed (mph)</label>
          <input
            type="number"
            min="0"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-400"
            value={windMph}
            onChange={e => {
              setWindMph(e.target.value);
              const mph = parseFloat(e.target.value);
              if (isFinite(mph) && mph >= 0) set({ windSpeed_ms: mphToMs(mph) });
            }}
          />
          <p className="text-xs text-gray-500 mt-0.5">
            {value.windSpeed_ms.toFixed(1)} m/s — power-law profile applied to altitude
          </p>
        </div>

        {/* Wind direction */}
        <div>
          <label className="block text-xs text-gray-400 mb-1">
            Wind Direction — FROM (°, 0 = N, 90 = E)
          </label>
          <input
            type="number"
            min="0"
            max="359"
            className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-400"
            value={value.windDirection_deg}
            onChange={e => {
              const deg = parseFloat(e.target.value);
              if (isFinite(deg)) set({ windDirection_deg: ((deg % 360) + 360) % 360 });
            }}
          />
          <p className="text-xs text-gray-500 mt-0.5">
            Monte Carlo randomises direction ±360° uniformly to cover all headings.
          </p>
        </div>

      </div>
    </details>
  );
}
