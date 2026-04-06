import { useState, useRef } from 'react';
import { computeHazardZone } from '../simulation/trajectory';
import { parseRaspEng, makeBoxcarMotor } from '../simulation/motor';
import { lookupMotor } from '../motors/thrustcurve';
import { parseOrkFile } from '../simulation/orkParser';
import type { HazardZoneResult, InputTier, Motor, OpenRocketData } from '../types';

interface Props {
  tier: InputTier;
  onComputing: () => void;
  onResult: (r: HazardZoneResult) => void;
  onError: (msg: string) => void;
}

type MotorInputMode = 'lookup' | 'rasp' | 'boxcar';

const M_TO_FT = 3.28084;

async function lookupElevation(lat: number, lon: number): Promise<number | null> {
  try {
    const url = `https://epqs.nationalmap.gov/v1/json?x=${lon}&y=${lat}&wkid=4326&includeDate=false`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    const elev_m = data?.value;
    if (elev_m == null || elev_m === -1000000) return null;
    return elev_m * M_TO_FT;
  } catch {
    return null;
  }
}

export function Tier2Form({ tier, onComputing, onResult, onError }: Props) {
  const isTier3 = tier === 'tier3';

  // Core geometry (Tier 2+)
  const [diameter, setDiameter] = useState('');   // inches
  const [length, setLength]     = useState('');   // inches
  const [mass, setMass]         = useState('');   // lbs

  // Tier 3 geometry
  const [noseType, setNoseType]   = useState<'ogive' | 'conical' | 'parabolic' | 'haack'>('ogive');
  const [noseLength, setNoseLength] = useState('');  // inches
  const [finRoot, setFinRoot]     = useState('');    // inches
  const [finTip, setFinTip]       = useState('');    // inches
  const [finSpan, setFinSpan]     = useState('');    // inches
  const [nozzleDia, setNozzleDia] = useState('');    // inches
  const [numStages, setNumStages] = useState('1');

  // Stability (CG/CP)
  const [cgIn, setCgIn] = useState('');
  const [cpIn, setCpIn] = useState('');

  // Launch conditions
  const [siteElev, setSiteElev] = useState('0');
  const [siteTemp, setSiteTemp] = useState('59');
  const [wind, setWind]         = useState('20');

  // GPS state
  const [lat, setLat]       = useState('');
  const [lon, setLon]       = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [showGps, setShowGps]   = useState(false);

  // Motor
  const [motorMode, setMotorMode]   = useState<MotorInputMode>('lookup');
  const [motorDesig, setMotorDesig] = useState('');
  const [motorStatus, setMotorStatus] = useState('');
  const [resolvedMotor, setResolvedMotor] = useState<Motor | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [raspName, setRaspName] = useState('');

  // Boxcar
  const [avgThrust, setAvgThrust] = useState('');  // N
  const [burnTimeS, setBurnTimeS] = useState('');  // s
  const [propMass, setPropMass]   = useState('');  // lbs
  const [motorMass, setMotorMass] = useState('');  // lbs

  // OpenRocket .ork import
  const [orkData, setOrkData]       = useState<OpenRocketData | null>(null);
  const [orkStatus, setOrkStatus]   = useState('');
  const [orkParsing, setOrkParsing] = useState(false);
  const orkFileRef = useRef<HTMLInputElement>(null);

  // ── GPS helpers ────────────────────────────────────────────────────────────

  const handleGeolocate = () => {
    if (!navigator.geolocation) { setGpsStatus('Geolocation not available.'); return; }
    setGpsStatus('Getting location...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        setLat(pos.coords.latitude.toFixed(5));
        setLon(pos.coords.longitude.toFixed(5));
        setGpsStatus(`Location acquired — click Lookup Elevation`);
      },
      () => setGpsStatus('Location permission denied.'),
    );
  };

  const handleGpsLookup = async () => {
    const latN = parseFloat(lat), lonN = parseFloat(lon);
    if (isNaN(latN) || isNaN(lonN)) { setGpsStatus('Enter valid lat/lon first.'); return; }
    setLookingUp(true);
    setGpsStatus('Looking up elevation...');
    const elev = await lookupElevation(latN, lonN);
    setLookingUp(false);
    if (elev == null) {
      setGpsStatus('Lookup failed — enter elevation manually.');
    } else {
      setSiteElev(elev.toFixed(0));
      setGpsStatus(`Set to ${elev.toFixed(0)} ft MSL`);
    }
  };

  // ── Motor helpers ──────────────────────────────────────────────────────────

  const handleMotorLookup = async () => {
    if (!motorDesig.trim()) return;
    setMotorStatus('Searching ThrustCurve.org...');
    setResolvedMotor(null);
    try {
      const motor = await lookupMotor(motorDesig.trim());
      if (!motor) { setMotorStatus('Not found. Check designation or try another input method.'); return; }
      setResolvedMotor(motor);
      const I = motor.thrustCurve.reduce((s, _p, i, a) =>
        i === 0 ? 0 : s + 0.5 * (a[i].thrust + a[i-1].thrust) * (a[i].time - a[i-1].time), 0);
      setMotorStatus(`Found: ${motor.name} (${motor.manufacturer}) — ${I.toFixed(0)} N\u00b7s, ${motor.thrustCurve.length} data points`);
    } catch {
      setMotorStatus('Lookup failed. Check internet connection.');
    }
  };

  const handleRaspUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const motor = parseRaspEng(text);
      setResolvedMotor(motor);
      setRaspName(`${motor.name} (${motor.manufacturer}) — ${motor.thrustCurve.length} pts`);
    } catch (err) {
      onError('Failed to parse .eng file: ' + String(err));
    }
  };

  // ── OpenRocket .ork upload ─────────────────────────────────────────────────

  const handleOrkUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOrkParsing(true);
    setOrkStatus('Parsing .ork file...');
    try {
      const buffer = await file.arrayBuffer();
      const data = await parseOrkFile(buffer);
      setOrkData(data);

      // Pre-fill geometry fields
      if (data.bodyDiameter_in > 0) setDiameter(data.bodyDiameter_in.toFixed(3));
      if (data.bodyLength_in > 0)   setLength(data.bodyLength_in.toFixed(2));
      if (isTier3) {
        setNoseType(data.noseConeType);
        if (data.noseLength_in > 0)   setNoseLength(data.noseLength_in.toFixed(2));
        if (data.finRootChord_in > 0) setFinRoot(data.finRootChord_in.toFixed(2));
        if (data.finTipChord_in > 0)  setFinTip(data.finTipChord_in.toFixed(2));
        if (data.finSpan_in > 0)      setFinSpan(data.finSpan_in.toFixed(2));
        if (data.finSweep_in != null && data.finSweep_in > 0) {
          // sweep not a direct input field but stored in orkData for reference
        }
      }

      // Auto-lookup motor if designation is available
      if (data.motorDesignation) {
        const desig = data.motorDesignation.trim();
        setMotorMode('lookup');
        setMotorDesig(desig);
        setMotorStatus('Searching ThrustCurve.org for motor from .ork...');
        setResolvedMotor(null);
        try {
          const motor = await lookupMotor(desig);
          if (motor) {
            setResolvedMotor(motor);
            const I = motor.thrustCurve.reduce((s, _p, i, a) =>
              i === 0 ? 0 : s + 0.5 * (a[i].thrust + a[i-1].thrust) * (a[i].time - a[i-1].time), 0);
            setMotorStatus(`Found: ${motor.name} (${motor.manufacturer}) — ${I.toFixed(0)} N\u00b7s`);
          } else {
            setMotorStatus(`Motor "${desig}" not found on ThrustCurve.org — look up manually.`);
          }
        } catch {
          setMotorStatus('Motor lookup failed. Check internet connection.');
        }
      }

      const apogeeNote = data.maxApogee_m != null
        ? ` · OR apogee: ${(data.maxApogee_m * M_TO_FT).toFixed(0)} ft stored for comparison`
        : '';
      setOrkStatus(
        `Loaded${data.rocketName ? ` "${data.rocketName}"` : ''}: ` +
        `${data.bodyDiameter_in.toFixed(2)}" dia × ${data.bodyLength_in.toFixed(1)}" long${apogeeNote}`
      );
    } catch (err) {
      setOrkStatus('Failed to parse .ork file: ' + String(err));
      setOrkData(null);
    } finally {
      setOrkParsing(false);
      e.target.value = '';
    }
  };

  // ── Save / Load config ─────────────────────────────────────────────────────

  const handleSaveConfig = () => {
    const config = {
      tier,
      diameter, length, mass,
      noseType, noseLength, finRoot, finTip, finSpan, nozzleDia, numStages,
      cgIn, cpIn,
      siteElev, siteTemp, wind,
      motorMode,
      motorDesig: motorMode === 'lookup' ? motorDesig : undefined,
      avgThrust: motorMode === 'boxcar' ? avgThrust : undefined,
      burnTimeS: motorMode === 'boxcar' ? burnTimeS : undefined,
      propMass: motorMode === 'boxcar' ? propMass : undefined,
      motorMass: motorMode === 'boxcar' ? motorMass : undefined,
      resolvedMotor: (motorMode === 'lookup' || motorMode === 'rasp') ? resolvedMotor : undefined,
    };
    const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `hazard-config-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const configFileRef = useRef<HTMLInputElement>(null);

  const handleLoadConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      try {
        const cfg = JSON.parse(ev.target?.result as string);
        if (cfg.diameter) setDiameter(cfg.diameter);
        if (cfg.length)   setLength(cfg.length);
        if (cfg.mass)     setMass(cfg.mass);
        if (cfg.noseType)   setNoseType(cfg.noseType);
        if (cfg.noseLength) setNoseLength(cfg.noseLength);
        if (cfg.finRoot)    setFinRoot(cfg.finRoot);
        if (cfg.finTip)     setFinTip(cfg.finTip);
        if (cfg.finSpan)    setFinSpan(cfg.finSpan);
        if (cfg.nozzleDia)  setNozzleDia(cfg.nozzleDia);
        if (cfg.numStages)  setNumStages(cfg.numStages);
        if (cfg.cgIn != null) setCgIn(cfg.cgIn);
        if (cfg.cpIn != null) setCpIn(cfg.cpIn);
        if (cfg.siteElev) setSiteElev(cfg.siteElev);
        if (cfg.siteTemp) setSiteTemp(cfg.siteTemp);
        if (cfg.wind)     setWind(cfg.wind);
        if (cfg.motorMode) setMotorMode(cfg.motorMode);
        if (cfg.motorDesig) setMotorDesig(cfg.motorDesig);
        if (cfg.avgThrust) setAvgThrust(cfg.avgThrust);
        if (cfg.burnTimeS) setBurnTimeS(cfg.burnTimeS);
        if (cfg.propMass)  setPropMass(cfg.propMass);
        if (cfg.motorMass) setMotorMass(cfg.motorMass);
        if (cfg.resolvedMotor) {
          setResolvedMotor(cfg.resolvedMotor);
          setMotorStatus(`Loaded: ${cfg.resolvedMotor.name}`);
        }
      } catch {
        onError('Failed to load config: invalid JSON format.');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  };

  // ── Submit ─────────────────────────────────────────────────────────────────

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();

    const d_in  = parseFloat(diameter);
    const l_in  = parseFloat(length);
    const m_lb  = parseFloat(mass);
    const elev  = parseFloat(siteElev) || 0;
    const temp  = parseFloat(siteTemp) || 59;
    const w_mph = Math.min(parseFloat(wind) || 20, 20);

    if (!d_in || d_in <= 0) { onError('Enter a valid body diameter.'); return; }
    if (!l_in || l_in <= 0) { onError('Enter a valid body length.'); return; }
    if (!m_lb || m_lb <= 0) { onError('Enter a valid loaded weight.'); return; }
    if (m_lb * 0.453592 < (resolvedMotor?.totalMassKg ?? 0)) {
      onError('Total rocket weight must be at least as heavy as the motor.');
      return;
    }

    let motor: Motor | null = null;
    if (motorMode === 'lookup' || motorMode === 'rasp') {
      motor = resolvedMotor;
      if (!motor) {
        onError(motorMode === 'lookup'
          ? 'Look up a motor first (enter designation and click Search).'
          : 'Upload a .eng file first.');
        return;
      }
      if (motor.thrustCurve.length === 0) {
        onError(`Motor "${motor.name}" has no thrust data. Try a different motor or use Manual entry.`);
        return;
      }
    } else {
      const avg = parseFloat(avgThrust);
      const bt  = parseFloat(burnTimeS);
      const pm  = parseFloat(propMass) * 0.453592;
      const mm  = parseFloat(motorMass) * 0.453592;
      if (!avg || !bt || !pm || !mm) { onError('Fill in all four manual motor fields.'); return; }
      motor = makeBoxcarMotor(avg, bt, pm, mm, 'Manual');
    }

    // Tier 3: nozzle exit area for altitude thrust correction
    if (isTier3 && nozzleDia) {
      const nozzleR_m = parseFloat(nozzleDia) * 0.0254 / 2;
      const nozzleArea = Math.PI * nozzleR_m * nozzleR_m;
      motor = { ...motor, nozzleExitAreaM2: nozzleArea };
    }

    const stages = parseInt(numStages) || 1;
    if (stages > 1) {
      onError('Multi-stage support coming in V2. For now, simulate each stage separately and use the largest hazard zone radius.');
      return;
    }

    const cg = cgIn ? parseFloat(cgIn) : undefined;
    const cp = cpIn ? parseFloat(cpIn) : undefined;

    onComputing();
    setTimeout(() => {
      try {
        const result = computeHazardZone({
          bodyDiameter_in:   d_in,
          bodyLength_in:     l_in,
          totalMass_lb:      m_lb,
          motor:             motor!,
          cg_in:             cg,
          cp_in:             cp,
          siteElevation_ft:  elev,
          siteTemp_F:        temp,
          surfaceWind_mph:   w_mph,
          storeTrajectories: true,
        });
        // Attach OpenRocket comparison data if available
        onResult({
          ...result,
          orkApogee_m:          orkData?.maxApogee_m,
          orkMotorDesignation:  orkData?.motorDesignation,
        });
      } catch (err) {
        onError('Simulation error: ' + String(err));
      }
    }, 10);
  };

  return (
    <form onSubmit={handleSubmit} className="space-y-6">
      <div>
        <h2 className="text-base font-semibold text-white mb-1">
          {isTier3 ? 'Full Mode — Tier 3' : 'Basic Mode — Tier 2'}
        </h2>
        <p className="text-sm text-slate-400">
          {isTier3
            ? 'Complete geometry for accurate CD calculation. Required for Mach > 0.8 or > 18,000 ft MSL.'
            : 'Kit specs + motor. CD estimated from body fineness ratio (L/D).'}
        </p>
      </div>

      {/* ── OpenRocket Import ──────────────────────────────────────────────── */}
      <Section title="Import from OpenRocket (Optional)">
        <p className="text-xs text-slate-400 mb-3">
          Upload a <code className="text-slate-300">.ork</code> file to auto-fill geometry fields and compare simulated apogee against OpenRocket&apos;s stored result.
        </p>
        <div className="flex items-center gap-3 flex-wrap">
          <button type="button" onClick={() => orkFileRef.current?.click()} disabled={orkParsing}
            className="text-xs px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white transition-colors">
            {orkParsing ? 'Parsing...' : 'Choose .ork File'}
          </button>
          <input ref={orkFileRef} type="file" accept=".ork" className="hidden" onChange={handleOrkUpload} />
          {orkData && (
            <button type="button" onClick={() => { setOrkData(null); setOrkStatus(''); }}
              className="text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white transition-colors">
              Clear
            </button>
          )}
        </div>
        {orkStatus && (
          <p className={`mt-2 text-xs ${orkStatus.startsWith('Failed') ? 'text-red-400' : 'text-green-400'}`}>
            {orkStatus}
          </p>
        )}
      </Section>

      {/* ── Rocket Geometry ─────────────────────────────────────────────────── */}
      <Section title="Rocket Geometry">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Body diameter (in)">
            <input type="number" min="0.1" max="24" step="0.01"
              value={diameter} onChange={e => setDiameter(e.target.value)}
              placeholder="e.g. 2.56" required className="input-field" />
            <Help>Outer tube diameter. Sets the reference drag area and stability caliber denominator.</Help>
          </Field>
          <Field label="Total length (in)">
            <input type="number" min="1" max="600" step="0.5"
              value={length} onChange={e => setLength(e.target.value)}
              placeholder="e.g. 48" required className="input-field" />
            <Help>Nose tip to nozzle exit. Used with diameter to compute fineness ratio (L/D) for drag estimate.</Help>
          </Field>
          <Field label="Loaded weight (lbs)">
            <input type="number" min="0.01" max="500" step="0.01"
              value={mass} onChange={e => setMass(e.target.value)}
              placeholder="e.g. 4.5" required className="input-field" />
            <Help>Full ready-to-fly mass including motor, propellant, and recovery hardware. Heavier rocket = slower = shorter range.</Help>
          </Field>
        </div>

        {/* Tier 3 extra geometry */}
        {isTier3 && (
          <>
            <div className="grid grid-cols-2 gap-4 mt-4">
              <Field label="Nose cone type">
                <select value={noseType}
                  onChange={e => setNoseType(e.target.value as typeof noseType)}
                  className="input-field">
                  <option value="ogive">Tangent Ogive (most common)</option>
                  <option value="conical">Conical</option>
                  <option value="parabolic">Parabolic</option>
                  <option value="haack">Von Karman / Haack</option>
                </select>
                <Help>Affects wave drag at transonic speeds. Tangent ogive is most common and has low drag.</Help>
              </Field>
              <Field label="Nose cone length (in)">
                <input type="number" min="0.5" max="60" step="0.1"
                  value={noseLength} onChange={e => setNoseLength(e.target.value)}
                  placeholder="e.g. 12" className="input-field" />
                <Help>Longer nose reduces wave drag at high speed. Also used in Barrowman CP estimation.</Help>
              </Field>
            </div>
            <div className="grid grid-cols-3 gap-4 mt-4">
              <Field label="Fin root chord (in)">
                <input type="number" min="0.1" max="36" step="0.1"
                  value={finRoot} onChange={e => setFinRoot(e.target.value)}
                  placeholder="e.g. 6" className="input-field" />
                <Help>Length of the fin edge attached to the body tube. Larger fins push the center of pressure (CP) aft.</Help>
              </Field>
              <Field label="Fin tip chord (in)">
                <input type="number" min="0" max="24" step="0.1"
                  value={finTip} onChange={e => setFinTip(e.target.value)}
                  placeholder="e.g. 3" className="input-field" />
                <Help>Length of the fin&apos;s free outer edge. Enter 0 for triangular fins. Affects CP location and fin drag.</Help>
              </Field>
              <Field label="Fin span (in)">
                <input type="number" min="0.1" max="36" step="0.1"
                  value={finSpan} onChange={e => setFinSpan(e.target.value)}
                  placeholder="e.g. 5" className="input-field" />
                <Help>Distance from the body tube to the fin tip. Larger span moves CP further aft for better stability.</Help>
              </Field>
              <Field label="Nozzle exit diameter (in)">
                <input type="number" min="0.1" max="12" step="0.01"
                  value={nozzleDia} onChange={e => setNozzleDia(e.target.value)}
                  placeholder="e.g. 1.5" className="input-field" />
                <Help>Enables altitude-corrected thrust. At high altitude, lower ambient pressure increases effective thrust.</Help>
              </Field>
              <Field label="Number of stages">
                <input type="number" min="1" max="4" step="1"
                  value={numStages} onChange={e => setNumStages(e.target.value)}
                  placeholder="1" className="input-field" />
                <Help>Single-stage only supported. For multi-stage, simulate each stage separately and use the largest hazard zone.</Help>
              </Field>
            </div>
          </>
        )}

        {/* Stability (CG/CP) — optional for both Tier 2 and Tier 3 */}
        <div className="mt-4 pt-4 border-t border-slate-700/60">
          <p className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
            Stability — Optional
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="CG from nose tip (in)">
              <input type="number" min="0" max="600" step="0.1"
                value={cgIn} onChange={e => setCgIn(e.target.value)}
                placeholder="e.g. 18.0" className="input-field" />
              <Help>Center of gravity measured from the nose tip. Found via swing test or simulation (e.g. OpenRocket).</Help>
            </Field>
            <Field label="CP from nose tip (in)">
              <input type="number" min="0" max="600" step="0.1"
                value={cpIn} onChange={e => setCpIn(e.target.value)}
                placeholder="e.g. 22.5" className="input-field" />
              <Help>Center of pressure from nose tip (Barrowman method). CP must be aft of CG for stable flight. If CP &lt; CG (unstable), a higher drag coefficient is applied to model tumbling descent.</Help>
            </Field>
          </div>
        </div>
      </Section>

      {/* ── Launch Conditions ───────────────────────────────────────────────── */}
      <Section title="Launch Conditions">
        <div className="grid grid-cols-3 gap-4">
          <Field label="Site elevation (ft MSL)">
            <input type="number" min="0" max="15000" step="1"
              value={siteElev} onChange={e => setSiteElev(e.target.value)}
              placeholder="0" className="input-field" />
            <Help>Higher elevation = thinner air = less drag = higher speed and longer range. Enter 0 for sea level.</Help>
          </Field>
          <Field label="Surface temp (\u00b0F)">
            <input type="number" min="-60" max="130" step="1"
              value={siteTemp} onChange={e => setSiteTemp(e.target.value)}
              placeholder="59" className="input-field" />
            <Help>Affects air density. Hotter air is less dense, slightly reducing drag. Default 59°F = ISA standard day.</Help>
          </Field>
          <Field label="Surface wind (MPH, max 20)">
            <input type="number" min="0" max="20" step="1"
              value={wind} onChange={e => setWind(e.target.value)}
              placeholder="20" className="input-field" />
            <Help>NAR/Tripoli maximum is 20 MPH. Wind pushes the rocket downrange during descent, increasing hazard radius.</Help>
          </Field>
        </div>

        {/* GPS elevation lookup (collapsible) */}
        <div className="mt-3">
          <button type="button"
            onClick={() => setShowGps(v => !v)}
            className="text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1 transition-colors">
            <span>{showGps ? '\u25bc' : '\u25b6'}</span>
            <span>Look up site elevation from GPS coordinates (USGS)</span>
          </button>

          {showGps && (
            <div className="mt-3 rounded-lg bg-slate-700/40 border border-slate-600 p-4 space-y-3">
              <div className="flex justify-end">
                <button type="button" onClick={handleGeolocate}
                  className="text-xs px-3 py-1 rounded bg-slate-600 hover:bg-slate-500 text-slate-200 transition-colors">
                  Use My Location
                </button>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <Field label="Latitude (\u00b0N)">
                  <input type="number" min="-90" max="90" step="0.00001"
                    value={lat} onChange={e => setLat(e.target.value)}
                    placeholder="e.g. 38.5000" className="input-field text-sm" />
                </Field>
                <Field label="Longitude (\u00b0E, negative = W)">
                  <input type="number" min="-180" max="180" step="0.00001"
                    value={lon} onChange={e => setLon(e.target.value)}
                    placeholder="e.g. -117.300" className="input-field text-sm" />
                </Field>
              </div>
              <button type="button" onClick={handleGpsLookup} disabled={lookingUp}
                className="text-xs px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white transition-colors">
                {lookingUp ? 'Looking up...' : 'Lookup Elevation'}
              </button>
              {gpsStatus && (
                <p className={`text-xs ${gpsStatus.startsWith('Set') ? 'text-green-400' : 'text-slate-400'}`}>
                  {gpsStatus}
                </p>
              )}
            </div>
          )}
        </div>
      </Section>

      {/* ── Motor ───────────────────────────────────────────────────────────── */}
      <Section title="Motor">
        <div className="flex gap-2 mb-4 flex-wrap">
          {(['lookup', 'rasp', 'boxcar'] as MotorInputMode[]).map(m => (
            <button key={m} type="button"
              onClick={() => { setMotorMode(m); setResolvedMotor(null); setMotorStatus(''); setRaspName(''); }}
              className={`text-xs px-3 py-1.5 rounded font-medium transition-colors ${
                motorMode === m ? 'bg-blue-600 text-white' : 'bg-slate-700 text-slate-300 hover:bg-slate-600'
              }`}>
              {m === 'lookup' ? 'ThrustCurve.org Lookup' : m === 'rasp' ? 'Upload .eng File' : 'Manual / Average Thrust'}
            </button>
          ))}
        </div>

        {motorMode === 'lookup' && (
          <>
            <div className="flex gap-3 items-end">
              <Field label="Motor designation (e.g. K1000T, J520ST, H180W)" className="flex-1">
                <input type="text" value={motorDesig}
                  onChange={e => setMotorDesig(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleMotorLookup())}
                  placeholder="e.g. K1000T" className="input-field" />
                <Help>ThrustCurve.org code for your motor. Retrieves the exact thrust curve, total impulse, and burn time.</Help>
              </Field>
              <button type="button" onClick={handleMotorLookup}
                className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-sm text-white transition-colors self-end">
                Search
              </button>
            </div>
            {motorStatus && (
              <p className={`mt-2 text-xs ${resolvedMotor ? 'text-green-400' : 'text-slate-400'}`}>
                {motorStatus}
              </p>
            )}
          </>
        )}

        {motorMode === 'rasp' && (
          <>
            <p className="text-xs text-slate-400 mb-2">
              Standard RASP .eng format — used by OpenRocket, RASAero II, and RocketPy.
            </p>
            <button type="button" onClick={() => fileRef.current?.click()}
              className="px-4 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-sm text-white transition-colors">
              Choose .eng File
            </button>
            <input ref={fileRef} type="file" accept=".eng,.txt" className="hidden"
              onChange={handleRaspUpload} />
            {raspName && <p className="mt-2 text-xs text-green-400">{raspName}</p>}
          </>
        )}

        {motorMode === 'boxcar' && (
          <>
            <p className="text-xs text-slate-400 mb-3">
              Constant-thrust approximation. Use when you only have the motor spec sheet.
            </p>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Average thrust (N)">
                <input type="number" min="0.1" step="0.1"
                  value={avgThrust} onChange={e => setAvgThrust(e.target.value)}
                  placeholder="e.g. 500" className="input-field" />
                <Help>Average thrust over the burn. With burn time, determines total impulse and motor class.</Help>
              </Field>
              <Field label="Burn time (sec)">
                <input type="number" min="0.01" step="0.01"
                  value={burnTimeS} onChange={e => setBurnTimeS(e.target.value)}
                  placeholder="e.g. 2.5" className="input-field" />
                <Help>Motor burn duration in seconds. Longer burn = more total impulse = higher and faster flight.</Help>
              </Field>
              <Field label="Propellant mass (lbs)">
                <input type="number" min="0.001" step="0.001"
                  value={propMass} onChange={e => setPropMass(e.target.value)}
                  placeholder="e.g. 0.50" className="input-field" />
                <Help>Propellant mass only (not the motor casing). Rocket gets lighter as it burns, increasing acceleration.</Help>
              </Field>
              <Field label="Total motor mass (lbs)">
                <input type="number" min="0.001" step="0.001"
                  value={motorMass} onChange={e => setMotorMass(e.target.value)}
                  placeholder="e.g. 1.20" className="input-field" />
                <Help>Full motor weight including casing, propellant, and nozzle. Subtracted to get dry mass at burnout.</Help>
              </Field>
            </div>
          </>
        )}
      </Section>

      {/* Save / Load config */}
      <div className="flex gap-3 items-center flex-wrap">
        <button type="button" onClick={handleSaveConfig}
          className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-colors">
          Save Config
        </button>
        <button type="button" onClick={() => configFileRef.current?.click()}
          className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-colors">
          Load Config
        </button>
        <input ref={configFileRef} type="file" accept=".json" className="hidden" onChange={handleLoadConfig} />
      </div>

      <button type="submit"
        className="w-full rounded-lg bg-blue-600 hover:bg-blue-500 active:bg-blue-700 text-white font-medium py-2.5 px-4 text-sm transition-colors">
        Calculate Hazard Zone
      </button>
    </form>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">{title}</h3>
      {children}
    </section>
  );
}

function Field({ label, children, className = '' }: { label: string; children: React.ReactNode; className?: string }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-sm text-slate-300">{label}</span>
      <div className="mt-1">{children}</div>
    </label>
  );
}

function Help({ children }: { children: React.ReactNode }) {
  return (
    <p className="text-xs text-slate-500 mt-1 leading-snug">{children}</p>
  );
}
