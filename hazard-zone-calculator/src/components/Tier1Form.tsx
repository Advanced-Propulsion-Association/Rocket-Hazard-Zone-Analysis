import { useState } from 'react';
import { computeTier1HazardZone } from '../simulation/trajectory';
import type { HazardZoneResult } from '../types';

interface Props {
  onComputing: () => void;
  onResult: (r: HazardZoneResult) => void;
  onError: (msg: string) => void;
}


const M_TO_FT = 3.28084;

async function lookupElevation(lat: number, lon: number): Promise<number | null> {
  try {
    // USGS National Map Elevation Point Query Service (CORS-enabled, free)
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&includeDate=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const elev_m = data?.value;
    if (elev_m == null || elev_m === -1000000) return null;
    return elev_m * M_TO_FT; // convert m → ft
  } catch {
    return null;
  }
}

export function Tier1Form({ onComputing, onResult, onError }: Props) {
  const [apogee, setApogee] = useState('');
  const [siteElev, setSiteElev] = useState('0');
  const [showAssumptions, setShowAssumptions] = useState(false);

  // GPS state
  const [lat, setLat] = useState('');
  const [lon, setLon] = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [lookingUp, setLookingUp] = useState(false);

  const handleGpsLookup = async () => {
    const latN = parseFloat(lat);
    const lonN = parseFloat(lon);
    if (isNaN(latN) || isNaN(lonN) || latN < -90 || latN > 90 || lonN < -180 || lonN > 180) {
      setGpsStatus('Enter valid lat/lon (e.g. 38.5 / -117.3)');
      return;
    }
    setLookingUp(true);
    setGpsStatus('Looking up elevation...');
    const elev_ft = await lookupElevation(latN, lonN);
    setLookingUp(false);
    if (elev_ft == null) {
      setGpsStatus('Elevation lookup failed. Enter elevation manually.');
    } else {
      setSiteElev(elev_ft.toFixed(0));
      setGpsStatus(`Elevation set to ${elev_ft.toFixed(0)} ft MSL`);
    }
  };

  const handleGeolocate = () => {
    if (!navigator.geolocation) { setGpsStatus('Geolocation not available in this browser.'); return; }
    setGpsStatus('Getting location...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude.toFixed(5));
        setLon(longitude.toFixed(5));
        setGpsStatus(`Location: ${latitude.toFixed(4)}\u00b0, ${longitude.toFixed(4)}\u00b0 — click Lookup Elevation`);
      },
      () => setGpsStatus('Location permission denied.'),
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const apogee_ft = parseFloat(apogee);
    const elev_ft   = parseFloat(siteElev) || 0;

    if (!apogee_ft || apogee_ft <= 0) {
      onError('Enter a valid maximum apogee in feet.');
      return;
    }

    const TIER1_MAX_FT = 50000;
    if (apogee_ft > TIER1_MAX_FT) {
      onError(
        `Operator Mode (Tier 1) is limited to ${TIER1_MAX_FT.toLocaleString()} ft. ` +
        `Above this altitude the simplified model cannot reliably predict the hazard zone — ` +
        `switch to Basic Mode (Tier 2) or Full Mode (Tier 3) and enter rocket specs for an accurate result.`
      );
      return;
    }

    onComputing();
    setTimeout(() => {
      try {
        const result = computeTier1HazardZone(apogee_ft, elev_ft);
        onResult(result);
      } catch (err) {
        onError('Simulation error: ' + String(err));
      }
    }, 10);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-5">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">Operator Mode</h2>
        <p className="text-sm text-slate-400">
          For launch site operators who only know the maximum expected altitude.
          Uses conservative defaults: CD = 0.6, 20 MPH wind, worst-case launch angle.
        </p>
      </div>

      {/* Main inputs */}
      <div className="grid grid-cols-2 gap-4">
        <label className="block">
          <span className="text-sm text-slate-300 font-medium">Max expected apogee (ft AGL)</span>
          <input
            type="number"
            min="100"
            max="50000"
            step="1"
            value={apogee}
            onChange={e => setApogee(e.target.value)}
            placeholder="e.g. 5000"
            className="mt-1 w-full input-field"
            required
          />
        </label>

        <label className="block">
          <span className="text-sm text-slate-300 font-medium">Launch site elevation (ft MSL)</span>
          <input
            type="number"
            min="0"
            max="15000"
            step="1"
            value={siteElev}
            onChange={e => setSiteElev(e.target.value)}
            placeholder="0"
            className="mt-1 w-full input-field"
          />
        </label>
      </div>

      {/* Conservative assumptions disclosure */}
      <div className="rounded-lg bg-slate-700/40 border border-slate-600 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowAssumptions(v => !v)}
          className="w-full flex items-center justify-between px-4 py-2.5 text-xs text-slate-400 hover:text-slate-200 hover:bg-slate-700/60 transition-colors"
        >
          <span className="font-medium uppercase tracking-widest">Conservative assumptions used in this calculation</span>
          <span>{showAssumptions ? '▲' : '▼'}</span>
        </button>
        {showAssumptions && (
          <div className="px-4 pb-4 pt-1 space-y-1.5 text-xs text-slate-400 border-t border-slate-600">
            <p className="text-slate-300 mb-2">
              Tier 1 simulates ballistic descent from your stated apogee using conservative defaults,
              then adds a geometric ascent offset for worst-case lateral tilt.
            </p>
            <div className="grid grid-cols-2 gap-x-6 gap-y-1">
              <span className="text-slate-400">Rocket mass</span>
              <span className="text-slate-200">1.5 kg (3.3 lb)</span>
              <span className="text-slate-400">Body diameter</span>
              <span className="text-slate-200">65 mm (2.56 in)</span>
              <span className="text-slate-400">Body length</span>
              <span className="text-slate-200">50 in (1,270 mm)</span>
              <span className="text-slate-400">Descent drag coefficient (CD)</span>
              <span className="text-slate-200">0.60 (high drag → slow fall → more wind drift)</span>
              <span className="text-slate-400">Max launch tilt</span>
              <span className="text-slate-200">20° from vertical (NAR/Tripoli limit)</span>
              <span className="text-slate-400">Surface wind</span>
              <span className="text-slate-200">20 MPH headwind (NAR/Tripoli limit)</span>
              <span className="text-slate-400">Atmosphere</span>
              <span className="text-slate-200">1976 US Standard (59°F standard day)</span>
              <span className="text-slate-400">Floor</span>
              <span className="text-slate-200">max(physics, NAR/Tripoli ¼-altitude rule)</span>
            </div>
            <p className="text-slate-500 pt-1">
              Use Tier 2 (Basic Mode) to model your actual rocket geometry and motor for a more precise estimate.
            </p>
          </div>
        )}
      </div>

      {/* GPS elevation lookup */}
      <div className="rounded-lg bg-slate-700/40 border border-slate-600 p-4 space-y-3">
        <div className="flex items-center justify-between">
          <p className="text-xs font-medium text-slate-300 uppercase tracking-widest">
            GPS Elevation Lookup
          </p>
          <button
            type="button"
            onClick={handleGeolocate}
            className="text-xs px-3 py-1 rounded bg-slate-600 hover:bg-slate-500 text-slate-200 transition-colors"
          >
            Use My Location
          </button>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <label className="block">
            <span className="text-xs text-slate-400">Latitude (&deg;N)</span>
            <input
              type="number"
              min="-90" max="90" step="0.00001"
              value={lat} onChange={e => setLat(e.target.value)}
              placeholder="e.g. 38.5000"
              className="mt-1 w-full input-field text-sm"
            />
          </label>
          <label className="block">
            <span className="text-xs text-slate-400">Longitude (&deg;E, negative = W)</span>
            <input
              type="number"
              min="-180" max="180" step="0.00001"
              value={lon} onChange={e => setLon(e.target.value)}
              placeholder="e.g. -117.300"
              className="mt-1 w-full input-field text-sm"
            />
          </label>
        </div>
        <button
          type="button"
          onClick={handleGpsLookup}
          disabled={lookingUp}
          className="text-xs px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white transition-colors"
        >
          {lookingUp ? 'Looking up...' : 'Lookup Elevation'}
        </button>
        {gpsStatus && (
          <p className={`text-xs ${gpsStatus.includes('set to') ? 'text-green-400' : 'text-slate-400'}`}>
            {gpsStatus}
          </p>
        )}
      </div>

      <button
        type="submit"
        className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium py-2.5 px-4 text-sm transition-colors"
      >
        Calculate Hazard Zone
      </button>
    </form>
  );
}
