import { useState, useRef } from 'react';
import { computeHazardZone, computeMultiStageHazardZone } from '../simulation/trajectory';
import { parseRaspEng, makeBoxcarMotor, totalImpulse } from '../simulation/motor';
import { lookupMotor } from '../motors/thrustcurve';
import { parseOrkFile } from '../simulation/orkParser';
import { barrowmanDragBreakdown } from '../simulation/barrowmanDrag';
import type { BarrowmanDragBreakdown } from '../simulation/barrowmanDrag';
import { parseOrFlightData } from '../simulation/orDataParser';
import type { OrFlightDataResult } from '../simulation/orDataParser';
import type { HazardZoneResult, InputTier, Motor, OpenRocketData, PrintInputSummary, StageConfig } from '../types';

interface Props {
  tier: InputTier;
  onComputing: () => void;
  onResult: (r: HazardZoneResult) => void;
  onError: (msg: string) => void;
  onCoordsChange?: (lat: number, lon: number) => void;
  onWindBearingChange?: (bearing: number | null) => void;
  onInputChange?: (summary: PrintInputSummary) => void;
}

type MotorInputMode = 'lookup' | 'rasp' | 'boxcar';

interface PerStageState {
  mass_lb: string;
  motorDesig: string;
  motorStatus: string;
  resolvedMotor: Motor | null;
  sepDelay_s: string;
  tumble: boolean;
}

const defaultStage = (): PerStageState => ({
  mass_lb: '', motorDesig: '', motorStatus: '', resolvedMotor: null,
  sepDelay_s: '0', tumble: true,
});

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

export function Tier2Form({ tier, onComputing, onResult, onError, onCoordsChange, onWindBearingChange, onInputChange }: Props) {
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
  const [numFins, setNumFins]     = useState('3');

  // Multi-stage per-stage state
  const [stageStates, setStageStates] = useState<PerStageState[]>([defaultStage(), defaultStage()]);
  const updateStage = (idx: number, patch: Partial<PerStageState>) =>
    setStageStates(prev => prev.map((s, i) => i === idx ? { ...s, ...patch } : s));
  const handleNumStagesChange = (val: string) => {
    const n = Math.min(4, Math.max(1, parseInt(val) || 1));
    setNumStages(String(n));
    setStageStates(prev => {
      const next = [...prev];
      while (next.length < n) next.push(defaultStage());
      return next.slice(0, n);
    });
  };
  const handleStageMotorLookup = async (idx: number) => {
    const desig = stageStates[idx].motorDesig.trim();
    if (!desig) return;
    updateStage(idx, { motorStatus: 'Searching ThrustCurve.org...' });
    try {
      const motor = await lookupMotor(desig);
      if (!motor) { updateStage(idx, { motorStatus: 'Not found.' }); return; }
      const I = motor.thrustCurve.reduce((s, _p, i, a) =>
        i === 0 ? 0 : s + 0.5 * (a[i].thrust + a[i-1].thrust) * (a[i].time - a[i-1].time), 0);
      updateStage(idx, { resolvedMotor: motor, motorStatus: `Found: ${motor.name} — ${I.toFixed(0)} N·s` });
    } catch {
      updateStage(idx, { motorStatus: 'Lookup failed. Check internet connection.' });
    }
  };

  // Build quality
  const [buildQuality, setBuildQuality] = useState('1.0');

  // Stability (CG/CP)
  const [cgIn, setCgIn] = useState('');
  const [cpIn, setCpIn] = useState('');

  // Launch conditions
  const [siteElev, setSiteElev] = useState('0');
  const [siteTemp, setSiteTemp] = useState('59');
  const [wind, setWind]         = useState('20');
  const [maxAngle, setMaxAngle] = useState('20');

  // GPS state
  const [lat, setLat]       = useState('');
  const [lon, setLon]       = useState('');
  const [gpsStatus, setGpsStatus] = useState('');
  const [lookingUp, setLookingUp] = useState(false);
  const [showGps, setShowGps]   = useState(false);
  const [windBearing, setWindBearing] = useState('');

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
  const [orkData, setOrkData]         = useState<OpenRocketData | null>(null);
  const [orkStatus, setOrkStatus]     = useState('');
  const [orkParsing, setOrkParsing]   = useState(false);
  const [clipAtApogee, setClipAtApogee] = useState(true);
  const [manualCdOverride, setManualCdOverride] = useState('');
  const [showGeometryDetails, setShowGeometryDetails] = useState(true);
  const orkFileRef = useRef<HTMLInputElement>(null);

  // OpenRocket flight data CSV import (Tier 3 only)
  const [orFlightData, setOrFlightData]   = useState<OrFlightDataResult | null>(null);
  const [orCsvStatus, setOrCsvStatus]     = useState('');
  const [orCsvParsing, setOrCsvParsing]   = useState(false);
  const orCsvRef = useRef<HTMLInputElement>(null);

  // ── GPS helpers ────────────────────────────────────────────────────────────

  const handleGeolocate = () => {
    if (!navigator.geolocation) { setGpsStatus('Geolocation not available.'); return; }
    setGpsStatus('Getting location...');
    navigator.geolocation.getCurrentPosition(
      pos => {
        const { latitude, longitude } = pos.coords;
        setLat(latitude.toFixed(5));
        setLon(longitude.toFixed(5));
        setGpsStatus(`Location acquired — click Lookup Elevation`);
        onCoordsChange?.(latitude, longitude);
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
      onCoordsChange?.(latN, lonN);
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
      const data = await parseOrkFile(buffer, clipAtApogee);
      setOrkData(data);
      setShowGeometryDetails(false); // collapse manual inputs — .ork auto-filled them

      // Pre-fill geometry fields
      if (data.bodyDiameter_in > 0) setDiameter(data.bodyDiameter_in.toFixed(3));
      if (data.bodyLength_in > 0)   setLength(data.bodyLength_in.toFixed(2));
      if (isTier3) {
        setNoseType(data.noseConeType);
        if (data.noseLength_in > 0)   setNoseLength(data.noseLength_in.toFixed(2));
        // Use sustainer fin geometry when per-stage data is available (last stage = sustainer)
        const finSource = (data.stageFinData && data.stageFinData.length > 1)
          ? data.stageFinData[data.stageFinData.length - 1]
          : data;
        if (finSource.finRootChord_in > 0) setFinRoot(finSource.finRootChord_in.toFixed(2));
        if (finSource.finTipChord_in > 0)  setFinTip(finSource.finTipChord_in.toFixed(2));
        if (finSource.finSpan_in > 0)      setFinSpan(finSource.finSpan_in.toFixed(2));
        if (finSource.numFins != null && finSource.numFins > 0) setNumFins(String(finSource.numFins));
      }
      // CG/CP from nose — extracted from OR databranch when available
      if (data.cgFromNose_in != null && data.cgFromNose_in > 0) {
        setCgIn(data.cgFromNose_in.toFixed(2));
      }
      if (data.cpFromNose_in != null && data.cpFromNose_in > 0) {
        setCpIn(data.cpFromNose_in.toFixed(2));
      }

      // Auto-set stage count from .ork
      if (data.numStagesDetected != null && data.numStagesDetected > 1) {
        handleNumStagesChange(String(data.numStagesDetected));
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

  // ── OpenRocket flight data CSV upload (Tier 3) ────────────────────────────

  const handleOrCsvUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setOrCsvParsing(true);
    setOrCsvStatus('Parsing flight data CSV...');
    try {
      const text = await file.text();
      const data = parseOrFlightData(text);
      setOrFlightData(data);
      const parts = [
        `CD_sub = ${data.subsonicBaseCd.toFixed(3)} (subsonic baseline · median ${data.representativeCd.toFixed(3)} · ${data.numPoints} pts)`,
        `max Mach ${data.maxMach.toFixed(3)}`,
        `apogee ${data.maxAltitude_ft.toFixed(0)} ft`,
      ];
      if (data.stabilityMargin_cal != null) {
        parts.push(`stability ${data.stabilityMargin_cal.toFixed(2)} cal`);
      }
      setOrCsvStatus('Loaded: ' + parts.join(' · '));
      // Auto-fill CG/CP if the form fields are empty
      if (data.cgFromNose_in != null && !cgIn) setCgIn(data.cgFromNose_in.toFixed(2));
      if (data.cpFromNose_in != null && !cpIn) setCpIn(data.cpFromNose_in.toFixed(2));
    } catch (err) {
      setOrFlightData(null);
      setOrCsvStatus('Failed: ' + String(err));
    } finally {
      setOrCsvParsing(false);
      e.target.value = '';
    }
  };

  // ── Save / Load config ─────────────────────────────────────────────────────

  const handleSaveConfig = () => {
    const config = {
      tier,
      diameter, length, mass,
      noseType, noseLength, finRoot, finTip, finSpan, nozzleDia, numStages, numFins,
      buildQuality,
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
        if (cfg.nozzleDia)    setNozzleDia(cfg.nozzleDia);
        if (cfg.numStages)    setNumStages(cfg.numStages);
        if (cfg.numFins)      setNumFins(cfg.numFins);
        if (cfg.buildQuality) setBuildQuality(cfg.buildQuality);
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
    const w_mph = Math.min(wind === '' || isNaN(parseFloat(wind)) ? 20 : Math.max(0, parseFloat(wind)), 20);
    const maxAng = Math.min(Math.max(1, maxAngle === '' || isNaN(parseFloat(maxAngle)) ? 20 : parseFloat(maxAngle)), 20);

    if (!d_in || d_in <= 0) { onError('Enter a valid body diameter.'); return; }
    if (!l_in || l_in <= 0) { onError('Enter a valid body length.'); return; }
    const isMultiStage = (parseInt(numStages) || 1) > 1;
    if (!isMultiStage) {
      if (!m_lb || m_lb <= 0) { onError('Enter a valid loaded weight.'); return; }
      if (m_lb * 0.453592 < (resolvedMotor?.totalMassKg ?? 0)) {
        onError('Total rocket weight must be at least as heavy as the motor.');
        return;
      }
    }

    let motor: Motor | null = null;
    if (!isMultiStage) {
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
    }

    const cg = cgIn ? parseFloat(cgIn) : undefined;
    const cp = cpIn ? parseFloat(cpIn) : undefined;

    const bq = parseFloat(buildQuality) || 1.0;
    const nf = parseInt(numFins) || 3;

    // Tier 3: CD from OR flight data CSV if available, otherwise Barrowman buildup
    let cdOverride: number | undefined;
    let barrowmanBreakdown: HazardZoneResult['barrowmanBreakdown'] | undefined;
    if (isTier3) {
      if (orFlightData) {
        // Use OR subsonic baseline CD — min from low-Mach pre-apogee points.
        // cdMachCorrection() will scale this up through the transonic regime.
        // Do NOT use representativeCd (median) here — it already includes
        // transonic effects, causing double Mach correction in the sim.
        cdOverride = orFlightData.subsonicBaseCd;
        // Still populate barrowmanBreakdown for display if components are available
        if (orFlightData.cdFriction != null && orFlightData.cdPressure != null && orFlightData.cdBase != null) {
          barrowmanBreakdown = {
            CD_friction:      orFlightData.cdFriction,
            CD_base:          orFlightData.cdBase,
            CD_fins:          0, // OR doesn't separate fin drag in the export
            CD_nose_pressure: orFlightData.cdPressure,
            CD_parasitic:     0, // not separately reported in OR CSV export
            CD_total:         orFlightData.representativeCd,
          };
        }
      } else {
        // Fallback: Barrowman component drag buildup from geometry
        const nl = parseFloat(noseLength) || 0;
        const fr = parseFloat(finRoot) || 0;
        const ft = parseFloat(finTip) || 0;
        const fs = parseFloat(finSpan) || 0;
        // For multi-stage, sum all stages for mass and impulse inputs to Barrowman.
        // In single-stage mode use the existing mass field and resolved motor.
        let bdTotalMass_kg: number;
        let bdTotalImpulse_Ns: number;
        if (isMultiStage) {
          const activeN = parseInt(numStages) || 1;
          bdTotalMass_kg = stageStates.slice(0, activeN).reduce((sum, s) => {
            return sum + (parseFloat(s.mass_lb) || 0) * 0.453592 + (s.resolvedMotor?.totalMassKg ?? 0);
          }, 0);
          bdTotalImpulse_Ns = stageStates.slice(0, activeN).reduce((sum, s) => {
            return sum + (s.resolvedMotor ? totalImpulse(s.resolvedMotor) : 0);
          }, 0);
        } else {
          bdTotalMass_kg = m_lb * 0.453592;
          bdTotalImpulse_Ns = motor ? totalImpulse(motor) : 0;
        }
        const bd = barrowmanDragBreakdown({
          noseConeType:    noseType,
          noseLength_in:   nl,
          bodyDiameter_in: d_in,
          bodyLength_in:   l_in,
          finRootChord_in: fr,
          finTipChord_in:  ft,
          finSpan_in:      fs,
          numFins:         nf,
          totalImpulse_Ns: bdTotalImpulse_Ns,
          totalMass_kg:    bdTotalMass_kg,
        });
        cdOverride = bd.CD_total;
        barrowmanBreakdown = bd;
      }
    }

    // Manual CD from .ork min CD takes precedence over fineness-ratio estimate
    if (manualCdOverride) {
      const v = parseFloat(manualCdOverride);
      if (isFinite(v) && v > 0) cdOverride = v;
    }

    const stages = parseInt(numStages) || 1;
    if (stages > 1) {
      // Validate per-stage inputs
      for (let i = 0; i < stages; i++) {
        const s = stageStates[i];
        const m = parseFloat(s.mass_lb);
        if (!m || m <= 0) { onError(`Stage ${i + 1}: enter a valid hardware mass.`); return; }
        if (!s.resolvedMotor) { onError(`Stage ${i + 1}: look up a motor first.`); return; }
      }
      const stageConfigs: StageConfig[] = stageStates.slice(0, stages).map((s, i) => ({
        motor: s.resolvedMotor!,
        stageMass_lb: parseFloat(s.mass_lb),
        separationDelay_s: parseFloat(s.sepDelay_s) || 0,
        tumbleOnSeparation: s.tumble,
        cdOverride: orkData?.stageData?.[i]?.cdOverride,
      }));
      onComputing();
      setTimeout(() => {
        try {
          const result = computeMultiStageHazardZone({
            stages: stageConfigs,
            bodyDiameter_in: d_in,
            bodyLength_in: l_in,
            cdOverride,
            buildQuality: (isTier3 && orFlightData) || !!manualCdOverride ? 1.0 : bq,
            cg_in: cg,
            cp_in: cp,
            siteElevation_ft: elev,
            siteTemp_F: temp,
            surfaceWind_mph: w_mph,
            maxLaunchAngle_deg: maxAng,
            storeTrajectories: true,
          });
          onInputChange?.({
            tier, siteElevation_ft: elev, maxWindSpeed_mph: w_mph,
            maxLaunchAngle_deg: maxAng, diameter_in: d_in, length_in: l_in,
            cdSource: isTier3 ? (orFlightData ? 'OR flight CSV (median pre-apogee)' : 'Barrowman component buildup') : (manualCdOverride ? '.ork file (min powered-flight CD)' : 'Fineness ratio estimate'),
            buildQualityMultiplier: bq,
          });
          onResult(result);
        } catch (err) {
          onError('Simulation error: ' + String(err));
        }
      }, 10);
      return;
    }

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
          maxLaunchAngle_deg: maxAng,
          buildQuality:      (isTier3 && orFlightData) || !!manualCdOverride ? 1.0 : bq,
          cdOverride,
          storeTrajectories: true,
        });
        // Determine CD source label for print summary
        const cdSourceLabel = (() => {
          if (orFlightData) return 'OR flight CSV (median pre-apogee)';
          if (manualCdOverride) return '.ork file (min powered-flight CD)';
          if (isTier3 && barrowmanBreakdown) return 'Barrowman component buildup';
          return 'Fineness ratio estimate';
        })();

        onInputChange?.({
          tier,
          siteElevation_ft: elev,
          maxWindSpeed_mph: w_mph,
          maxLaunchAngle_deg: maxAng,
          diameter_in: d_in,
          length_in: l_in,
          totalMass_lb: m_lb,
          motorDesignation: motorDesig || motor?.name,
          cdSource: cdSourceLabel,
          buildQualityMultiplier: bq,
          noseConeType: isTier3 ? noseType : undefined,
          numFins: isTier3 ? parseInt(numFins) || undefined : undefined,
          nozzleExitDiameter_in: isTier3 && nozzleDia ? parseFloat(nozzleDia) || undefined : undefined,
        });

        // Attach OpenRocket comparison data and Barrowman breakdown if available
        onResult({
          ...result,
          orkApogee_m:          orkData?.maxApogee_m,
          orkMotorDesignation:  orkData?.motorDesignation,
          barrowmanBreakdown,
        });
      } catch (err) {
        onError('Simulation error: ' + String(err));
      }
    }, 10);
  };

  // Live Barrowman breakdown for Tier 3 preview panel
  const liveBarrowman: BarrowmanDragBreakdown | null = (() => {
    if (!isTier3) return null;
    const d = parseFloat(diameter);
    const l = parseFloat(length);
    if (!d || !l || d <= 0 || l <= 0) return null;
    const nl = parseFloat(noseLength) || 0;
    const fr = parseFloat(finRoot) || 0;
    const ft = parseFloat(finTip) || 0;
    const fs = parseFloat(finSpan) || 0;
    const nf = parseInt(numFins) || 3;
    return barrowmanDragBreakdown({
      noseConeType:    noseType,
      noseLength_in:   nl,
      bodyDiameter_in: d,
      bodyLength_in:   l,
      finRootChord_in: fr,
      finTipChord_in:  ft,
      finSpan_in:      fs,
      numFins:         nf,
      totalImpulse_Ns: resolvedMotor ? totalImpulse(resolvedMotor) : 0,
      totalMass_kg:    resolvedMotor && mass ? parseFloat(mass) * 0.453592 : 0,
    });
  })();

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
            <button type="button" onClick={() => { setOrkData(null); setOrkStatus(''); setShowGeometryDetails(true); }}
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
        {orkData?.orkMinCd != null && (
          <div className="mt-3 flex items-center gap-3 flex-wrap">
            <span className="text-xs text-slate-300">
              <span className="font-medium text-violet-400">CD from .ork: {orkData.orkMinCd.toFixed(3)}</span>
              <span className="text-slate-500 ml-1">(minimum from powered flight — most conservative)</span>
            </span>
            <button type="button"
              onClick={() => setManualCdOverride(orkData.orkMinCd!.toFixed(3))}
              className="text-xs px-2.5 py-1 rounded bg-violet-700 hover:bg-violet-600 text-white transition-colors">
              Use this CD
            </button>
            {manualCdOverride && (
              <button type="button"
                onClick={() => setManualCdOverride('')}
                className="text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white transition-colors">
                Clear
              </button>
            )}
          </div>
        )}
        <div className="mt-3">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer select-none">
            <input type="checkbox" checked={clipAtApogee} onChange={e => setClipAtApogee(e.target.checked)}
              className="accent-violet-500" />
            Clip flight data at apogee
            <span className="text-slate-500">(removes parachute descent — re-upload to apply)</span>
          </label>
        </div>

        {/* ── Dev debug panel — visible when .ork is loaded ─────────────────── */}
        {orkData && (
          <details className="mt-3">
            <summary className="text-xs text-slate-500 hover:text-slate-300 cursor-pointer select-none transition-colors">
              ▶ Dev: OpenRocket parsed data
            </summary>
            <div className="mt-2 rounded-lg bg-slate-900/60 border border-slate-700 p-3 text-xs font-mono space-y-3">

              {/* Stage count */}
              <div>
                <p className="text-slate-400 font-sans font-medium mb-1">Stage detection</p>
                <p className="text-slate-300">
                  Detected: <span className="text-green-400">{orkData.numStagesDetected ?? 1}</span> stage(s)
                  {orkData.stageNames && (
                    <span className="text-slate-500 ml-2">
                      ({orkData.stageNames.map((n, i) => `[${i}] ${n}`).join(', ')})
                    </span>
                  )}
                </p>
              </div>

              {/* Per-stage data */}
              {orkData.numStagesDetected != null && orkData.numStagesDetected > 1 && (
                <div>
                  <p className="text-slate-400 font-sans font-medium mb-1">Per-stage data (index 0 = booster, fires first)</p>
                  <div className="space-y-2">
                    {Array.from({ length: orkData.numStagesDetected }).map((_, i) => {
                      const isBooster = i === 0;
                      const isSustainer = i === orkData.numStagesDetected! - 1 && i > 0;
                      const label = orkData.stageNames?.[i]
                        ?? (isBooster ? 'Booster' : isSustainer ? 'Sustainer' : `Stage ${i + 1}`);
                      const cd = orkData.stageData?.[i]?.cdOverride;
                      const fins = orkData.stageFinData?.[i];
                      return (
                        <div key={i} className="pl-2 border-l border-slate-700">
                          <p className="text-blue-300">[{i}] {label}</p>
                          <p className="text-slate-400 pl-2">
                            CD override: {cd != null ? <span className="text-yellow-300">{cd.toFixed(3)}</span> : <span className="text-slate-600">none (uses global)</span>}
                          </p>
                          {fins ? (
                            <p className="text-slate-400 pl-2">
                              Fins: {fins.numFins} × root <span className="text-slate-200">{fins.finRootChord_in.toFixed(2)}"</span>
                              {' '}/ tip <span className="text-slate-200">{fins.finTipChord_in.toFixed(2)}"</span>
                              {' '}/ span <span className="text-slate-200">{fins.finSpan_in.toFixed(2)}"</span>
                              {fins.finSweep_in != null && <> / sweep <span className="text-slate-200">{fins.finSweep_in.toFixed(2)}"</span></>}
                            </p>
                          ) : (
                            <p className="text-slate-600 pl-2">Fins: not found in stage element</p>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Global geometry */}
              <div>
                <p className="text-slate-400 font-sans font-medium mb-1">Full-stack geometry</p>
                <p className="text-slate-300">Body: <span className="text-slate-200">{orkData.bodyDiameter_in.toFixed(3)}"</span> dia × <span className="text-slate-200">{orkData.bodyLength_in.toFixed(2)}"</span> long</p>
                <p className="text-slate-300">Nose: <span className="text-slate-200">{orkData.noseConeType}</span> <span className="text-slate-200">{orkData.noseLength_in.toFixed(2)}"</span></p>
                <p className="text-slate-300">
                  Fins (global / auto-fill source): {orkData.numFins} × root <span className="text-slate-200">{orkData.finRootChord_in.toFixed(2)}"</span>
                  {' '}/ tip <span className="text-slate-200">{orkData.finTipChord_in.toFixed(2)}"</span>
                  {' '}/ span <span className="text-slate-200">{orkData.finSpan_in.toFixed(2)}"</span>
                </p>
              </div>

              {/* CG / CP */}
              <div>
                <p className="text-slate-400 font-sans font-medium mb-1">CG / CP (full-stack, t=0 from databranch)</p>
                {orkData.cgFromNose_in != null
                  ? <p className="text-slate-300">CG from nose: <span className="text-slate-200">{orkData.cgFromNose_in.toFixed(2)}"</span></p>
                  : <p className="text-slate-600">CG: not found in simulation data</p>}
                {orkData.cpFromNose_in != null
                  ? <p className="text-slate-300">CP from nose: <span className="text-slate-200">{orkData.cpFromNose_in.toFixed(2)}"</span></p>
                  : <p className="text-slate-600">CP: not found in simulation data</p>}
                {orkData.cgFromNose_in != null && orkData.cpFromNose_in != null && orkData.bodyDiameter_in > 0 && (
                  <p className="text-slate-300">
                    Stability margin:{' '}
                    <span className={(orkData.cpFromNose_in - orkData.cgFromNose_in) / orkData.bodyDiameter_in >= 1.0 ? 'text-green-400' : 'text-yellow-400'}>
                      {((orkData.cpFromNose_in - orkData.cgFromNose_in) / orkData.bodyDiameter_in).toFixed(2)} cal
                    </span>
                    <span className="text-slate-500 ml-1">(full-stack, powered flight)</span>
                  </p>
                )}
                <p className="text-slate-600 text-xs mt-1">Note: per-stage CG/CP not yet extracted — sustainer values require post-separation databranch analysis.</p>
              </div>

              {/* Simulation data */}
              <div>
                <p className="text-slate-400 font-sans font-medium mb-1">Stored simulation data</p>
                {orkData.orkMinCd != null
                  ? <p className="text-slate-300">Min CD (pre-apogee): <span className="text-yellow-300">{orkData.orkMinCd.toFixed(3)}</span></p>
                  : <p className="text-slate-600">Min CD: no simulation data in file</p>}
                {orkData.maxApogee_m != null
                  ? <p className="text-slate-300">Stored apogee: <span className="text-slate-200">{(orkData.maxApogee_m * M_TO_FT).toFixed(0)} ft</span></p>
                  : <p className="text-slate-600">Apogee: no simulation data in file</p>}
                {orkData.motorDesignation && (
                  <p className="text-slate-300">Motor: <span className="text-slate-200">{orkData.motorDesignation}</span>{orkData.motorManufacturer && <span className="text-slate-500"> ({orkData.motorManufacturer})</span>}</p>
                )}
              </div>

            </div>
          </details>
        )}

        {/* OpenRocket flight data CSV — Tier 3 only, placed here so it's near the .ork import */}
        {isTier3 && (
          <div className="mt-4 rounded-lg bg-slate-700/40 border border-slate-600 p-4 space-y-3">
            <div className="flex items-center justify-between flex-wrap gap-2">
              <div>
                <p className="text-xs font-medium text-slate-300 uppercase tracking-widest">
                  OpenRocket Flight Data CSV — Optional
                </p>
                <p className="text-xs text-slate-500 mt-0.5">
                  Import an OR simulation export to use OR&apos;s validated CD instead of Barrowman.
                </p>
              </div>
              <div className="flex gap-2 items-center">
                <button type="button" onClick={() => orCsvRef.current?.click()} disabled={orCsvParsing}
                  className="text-xs px-3 py-1.5 rounded bg-slate-600 hover:bg-slate-500 disabled:opacity-50 text-white transition-colors shrink-0">
                  {orCsvParsing ? 'Parsing...' : 'Choose CSV'}
                </button>
                {orFlightData && (
                  <button type="button" onClick={() => { setOrFlightData(null); setOrCsvStatus(''); }}
                    className="text-xs px-2 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white transition-colors">
                    Clear
                  </button>
                )}
              </div>
              <input ref={orCsvRef} type="file" accept=".csv,.txt" className="hidden" onChange={handleOrCsvUpload} />
            </div>
            {orCsvStatus && (
              <p className={`text-xs ${orCsvStatus.startsWith('Failed') ? 'text-red-400' : orFlightData ? 'text-green-400' : 'text-slate-400'}`}>
                {orCsvStatus}
              </p>
            )}
            {orFlightData && (
              <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs pt-1 border-t border-slate-600/60">
                <span className="text-slate-400">CD source</span>
                <span className="text-blue-300 font-medium">OpenRocket simulation</span>
                <span className="text-slate-400">CD (subsonic baseline)</span>
                <span className="text-slate-200">{orFlightData.subsonicBaseCd.toFixed(3)}</span>
                <span className="text-slate-400">CD (median observed)</span>
                <span className="text-slate-400">{orFlightData.representativeCd.toFixed(3)}</span>
                {orFlightData.cdFriction != null && <>
                  <span className="text-slate-400">  Friction</span>
                  <span className="text-slate-400">{orFlightData.cdFriction.toFixed(3)}</span>
                </>}
                {orFlightData.cdPressure != null && <>
                  <span className="text-slate-400">  Pressure</span>
                  <span className="text-slate-400">{orFlightData.cdPressure.toFixed(3)}</span>
                </>}
                {orFlightData.cdBase != null && <>
                  <span className="text-slate-400">  Base</span>
                  <span className="text-slate-400">{orFlightData.cdBase.toFixed(3)}</span>
                </>}
                <span className="text-slate-400">Max Mach</span>
                <span className="text-slate-200">{orFlightData.maxMach.toFixed(3)}</span>
                <span className="text-slate-400">OR apogee</span>
                <span className="text-slate-200">{orFlightData.maxAltitude_ft.toFixed(0)} ft</span>
                <span className="text-slate-400">Data points used</span>
                <span className="text-slate-200">{orFlightData.numPoints}</span>
                {orFlightData.stabilityMargin_cal != null && <>
                  <span className="text-slate-400">Stability margin</span>
                  <span className="text-slate-200">{orFlightData.stabilityMargin_cal.toFixed(2)} cal</span>
                </>}
              </div>
            )}
            {orFlightData?.warnings.map((w, i) => (
              <p key={i} className="text-xs text-amber-400">[!] {w}</p>
            ))}
            {!orFlightData && (
              <p className="text-xs text-slate-500">
                If not provided, CD is calculated from your geometry using Barrowman component drag buildup.
              </p>
            )}
          </div>
        )}
      </Section>

      {/* ── Rocket Geometry ─────────────────────────────────────────────────── */}
      <Section title="Rocket Geometry">
        {/* Number of stages — available for both Tier 2 and 3 */}
        <div className="mb-4 flex items-center gap-4">
          <Field label="Number of stages">
            <select value={numStages} onChange={e => handleNumStagesChange(e.target.value)}
              className="input-field w-32">
              {[1, 2, 3, 4].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
          </Field>
          {parseInt(numStages) > 1 && (
            <p className="text-xs text-slate-400 mt-5">
              Enter hardware mass (excluding motor) and motor for each stage.
            </p>
          )}
        </div>

        {/* Per-stage panels — shown when numStages > 1 */}
        {parseInt(numStages) > 1 && (
          <div className="space-y-4 mb-4">
            {stageStates.slice(0, parseInt(numStages)).map((s, idx) => {
              const isLast = idx === parseInt(numStages) - 1;
              const label = parseInt(numStages) === 2
                ? (idx === 0 ? 'Stage 1 — Booster' : 'Stage 2 — Sustainer')
                : idx === 0 ? 'Stage 1 — Booster'
                : isLast ? `Stage ${idx + 1} — Sustainer`
                : `Stage ${idx + 1}`;
              return (
                <div key={idx} className="rounded-lg border border-slate-600 bg-slate-700/30 p-4 space-y-3">
                  <p className="text-xs font-semibold text-slate-200 uppercase tracking-widest">{label}</p>
                  <div className="grid grid-cols-2 gap-4">
                    <Field label="Hardware mass (lbs)">
                      <input type="number" min="0.01" step="any"
                        value={s.mass_lb} onChange={e => updateStage(idx, { mass_lb: e.target.value })}
                        placeholder="e.g. 2.5" className="input-field" />
                      <Help>Structural mass of this stage only — exclude motor weight.</Help>
                    </Field>
                    <div>
                      <div className="flex gap-2 items-end">
                        <Field label="Motor designation" className="flex-1">
                          <input type="text" value={s.motorDesig}
                            onChange={e => updateStage(idx, { motorDesig: e.target.value })}
                            onKeyDown={e => e.key === 'Enter' && (e.preventDefault(), handleStageMotorLookup(idx))}
                            placeholder="e.g. H148R" className="input-field" />
                        </Field>
                        <button type="button" onClick={() => handleStageMotorLookup(idx)}
                          className="px-3 py-2 rounded-lg bg-slate-600 hover:bg-slate-500 text-sm text-white transition-colors self-end">
                          Search
                        </button>
                      </div>
                      {s.motorStatus && (
                        <p className={`mt-1 text-xs ${s.resolvedMotor ? 'text-green-400' : 'text-slate-400'}`}>
                          {s.motorStatus}
                        </p>
                      )}
                    </div>
                  </div>
                  {!isLast && (
                    <div className="grid grid-cols-2 gap-4 pt-2 border-t border-slate-600/60">
                      <Field label="Separation delay (s)">
                        <input type="number" min="0" max="10" step="0.1"
                          value={s.sepDelay_s} onChange={e => updateStage(idx, { sepDelay_s: e.target.value })}
                          placeholder="0" className="input-field" />
                        <Help>Coast time after burnout before stage separates.</Help>
                      </Field>
                      <div className="flex items-center gap-2 mt-6">
                        <label className="flex items-center gap-2 text-xs text-slate-300 cursor-pointer select-none">
                          <input type="checkbox" checked={s.tumble}
                            onChange={e => updateStage(idx, { tumble: e.target.checked })}
                            className="accent-blue-500" />
                          Tumble on separation (2× CD)
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {/* ── Geometry collapse/expand when .ork is loaded ───────────────── */}
        {orkData && !showGeometryDetails ? (
          <div className="flex items-center gap-3 mt-1 rounded-lg bg-slate-700/30 border border-slate-600/60 px-4 py-2.5">
            <div className="flex-1 flex flex-wrap gap-x-4 gap-y-0.5 text-xs text-slate-400">
              <span>Dia: <span className="text-slate-200">{diameter}&quot;</span></span>
              <span>Length: <span className="text-slate-200">{length}&quot;</span></span>
              {!(parseInt(numStages) > 1) && mass && (
                <span>Mass: <span className="text-slate-200">{mass} lbs</span></span>
              )}
              {isTier3 && noseLength && (
                <span>Nose: <span className="text-slate-200">{noseType} {noseLength}&quot;</span></span>
              )}
              {isTier3 && finRoot && (
                <span>Fins: <span className="text-slate-200">{numFins} · root {finRoot}&quot; · span {finSpan}&quot;</span></span>
              )}
              <span>Build quality: <span className="text-slate-200">×{buildQuality}</span></span>
            </div>
            <button type="button" onClick={() => setShowGeometryDetails(true)}
              className="text-xs px-2.5 py-1 rounded border border-slate-600 hover:border-slate-400 text-slate-400 hover:text-white transition-colors shrink-0">
              Edit
            </button>
          </div>
        ) : (
          <>
            <div className="grid grid-cols-3 gap-4">
              <Field label="Body diameter (in)">
                <input type="number" min="0.1" max="24" step="any"
                  value={diameter} onChange={e => setDiameter(e.target.value)}
                  placeholder="e.g. 2.56" required className="input-field" />
                <Help>Outer tube diameter. Sets the reference drag area and stability caliber denominator.</Help>
              </Field>
              <Field label="Total length (in)">
                <input type="number" min="1" max="600" step="any"
                  value={length} onChange={e => setLength(e.target.value)}
                  placeholder="e.g. 48" required className="input-field" />
                <Help>Nose tip to nozzle exit. Used with diameter to compute fineness ratio (L/D) for drag estimate.</Help>
              </Field>
              <Field label="Loaded weight (lbs)">
                <input type="number" min="0.01" max="500" step="any"
                  value={mass} onChange={e => setMass(e.target.value)}
                  placeholder="e.g. 4.5" required className="input-field" />
                <Help>Full ready-to-fly mass including motor, propellant, and recovery hardware. Heavier rocket = slower = shorter range.</Help>
              </Field>
            </div>

            {/* Build quality multiplier */}
            <div className="mt-4">
              <Field label="Build quality">
                <select value={buildQuality} onChange={e => setBuildQuality(e.target.value)}
                  className={`input-field ${manualCdOverride ? 'opacity-40' : ''}`}
                  disabled={!!manualCdOverride}>
                  <option value="1.0">Ideal — 1.0× (theoretical minimum drag)</option>
                  <option value="1.15">Competition — 1.15× (very smooth finish, minimal hardware)</option>
                  <option value="1.30">Standard build — 1.30× (typical kit rocket, rail buttons, seams)</option>
                  <option value="1.50">Rough build — 1.50× (significant protuberances, rough finish)</option>
                </select>
              </Field>
              {manualCdOverride ? (
                <div className="mt-2 flex items-center gap-2 rounded bg-violet-900/40 border border-violet-700 px-3 py-2 text-xs">
                  <span className="text-violet-300 font-medium">CD override active: {manualCdOverride}</span>
                  <span className="text-slate-400">(from .ork — build quality multiplier bypassed)</span>
                  <button type="button" onClick={() => setManualCdOverride('')}
                    className="ml-auto text-slate-400 hover:text-white transition-colors">Clear ×</button>
                </div>
              ) : (
                <p className="text-xs text-slate-500 mt-1">
                  {isTier3
                    ? 'Multiplied into the Barrowman base CD after component drag buildup.'
                    : 'Multiplied into the fineness-ratio CD estimate. As-built rockets typically have 15–30% more drag than ideal models.'}
                </p>
              )}
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
                    <input type="number" min="0.5" max="60" step="any"
                      value={noseLength} onChange={e => setNoseLength(e.target.value)}
                      placeholder="e.g. 12" className="input-field" />
                    <Help>Longer nose reduces wave drag at high speed. Also used in Barrowman CP estimation.</Help>
                  </Field>
                </div>
                <div className="grid grid-cols-3 gap-4 mt-4">
                  <Field label="Number of fins">
                    <input type="number" min="1" max="8" step="1"
                      value={numFins} onChange={e => setNumFins(e.target.value)}
                      placeholder="3" className="input-field" />
                    <Help>Number of fins on the rocket. Used in Barrowman drag buildup to compute fin wetted area and interference drag.</Help>
                  </Field>
                  <Field label="Fin root chord (in)">
                    <input type="number" min="0.1" max="36" step="any"
                      value={finRoot} onChange={e => setFinRoot(e.target.value)}
                      placeholder="e.g. 6" className="input-field" />
                    <Help>Length of the fin edge attached to the body tube. Larger fins push the center of pressure (CP) aft.</Help>
                  </Field>
                  <Field label="Fin tip chord (in)">
                    <input type="number" min="0" max="24" step="any"
                      value={finTip} onChange={e => setFinTip(e.target.value)}
                      placeholder="e.g. 3" className="input-field" />
                    <Help>Length of the fin&apos;s free outer edge. Enter 0 for triangular fins. Affects CP location and fin drag.</Help>
                  </Field>
                  <Field label="Fin span (in)">
                    <input type="number" min="0.1" max="36" step="any"
                      value={finSpan} onChange={e => setFinSpan(e.target.value)}
                      placeholder="e.g. 5" className="input-field" />
                    <Help>Distance from the body tube to the fin tip. Larger span moves CP further aft for better stability.</Help>
                  </Field>
                  <Field label="Nozzle exit diameter (in)">
                    <input type="number" min="0.1" max="12" step="any"
                      value={nozzleDia} onChange={e => setNozzleDia(e.target.value)}
                      placeholder="e.g. 1.5" className="input-field" />
                    <Help>Enables altitude-corrected thrust. At high altitude, lower ambient pressure increases effective thrust.</Help>
                  </Field>
                </div>

                {/* Live Barrowman CD breakdown */}
                {liveBarrowman && (
                  <div className={`mt-4 rounded-lg border p-3 transition-opacity ${(orFlightData || !!manualCdOverride) ? 'bg-slate-800/20 border-slate-700/40 opacity-40 pointer-events-none select-none' : 'bg-slate-700/40 border-slate-600'}`}>
                    <p className="text-xs font-medium text-slate-300 uppercase tracking-widest mb-2">
                      Live Barrowman CD Breakdown
                      {orFlightData && <span className="ml-2 normal-case tracking-normal font-normal text-amber-400/80">— OR data active, Barrowman not used</span>}
                      {!orFlightData && manualCdOverride && <span className="ml-2 normal-case tracking-normal font-normal text-violet-400/80">— .ork CD override active, Barrowman not used</span>}
                    </p>
                    <div className="grid grid-cols-2 gap-x-6 gap-y-0.5 text-xs">
                      <span className="text-slate-400">Body skin friction</span>
                      <span className="text-slate-200">{liveBarrowman.CD_friction.toFixed(3)}</span>
                      <span className="text-slate-400">Base (nozzle wake)</span>
                      <span className="text-slate-200">{liveBarrowman.CD_base.toFixed(3)}</span>
                      <span className="text-slate-400">Fin drag</span>
                      <span className="text-slate-200">{liveBarrowman.CD_fins.toFixed(3)}</span>
                      <span className="text-slate-400">Nose pressure</span>
                      <span className="text-slate-200">{liveBarrowman.CD_nose_pressure.toFixed(3)}</span>
                      <span className="text-slate-400">Parasitic (lugs, roughness)</span>
                      <span className="text-slate-200">{liveBarrowman.CD_parasitic.toFixed(3)}</span>
                      <span className="text-slate-300 font-medium pt-1">Base CD total</span>
                      <span className="text-slate-100 font-medium pt-1">{liveBarrowman.CD_total.toFixed(3)}</span>
                      <span className="text-slate-300 font-medium">Effective CD (×{buildQuality})</span>
                      <span className="text-blue-300 font-medium">{(liveBarrowman.CD_total * (parseFloat(buildQuality) || 1)).toFixed(3)}</span>
                    </div>
                    <p className="text-xs text-slate-500 mt-2">Updates live as you change geometry. Build quality multiplier applied at simulation time.</p>
                  </div>
                )}
              </>
            )}

            {/* Collapse link — only shown when .ork is loaded and fields are expanded */}
            {orkData && (
              <div className="mt-3 text-right">
                <button type="button" onClick={() => setShowGeometryDetails(false)}
                  className="text-xs text-slate-500 hover:text-slate-300 transition-colors">
                  ▲ Collapse geometry
                </button>
              </div>
            )}
          </>
        )}

        {/* Stability (CG/CP) — optional for both Tier 2 and Tier 3 */}
        <div className="mt-4 pt-4 border-t border-slate-700/60">
          <p className="text-xs text-slate-400 uppercase tracking-widest mb-3 font-medium">
            Stability — Optional
          </p>
          <div className="grid grid-cols-2 gap-4">
            <Field label="CG from nose tip (in)">
              <input type="number" min="0" max="600" step="any"
                value={cgIn} onChange={e => setCgIn(e.target.value)}
                placeholder="e.g. 18.0" className="input-field" />
              <Help>Center of gravity measured from the nose tip. Found via swing test or simulation (e.g. OpenRocket).</Help>
            </Field>
            <Field label="CP from nose tip (in)">
              <input type="number" min="0" max="600" step="any"
                value={cpIn} onChange={e => setCpIn(e.target.value)}
                placeholder="e.g. 22.5" className="input-field" />
              <Help>Center of pressure from nose tip (Barrowman method). CP must be aft of CG for stable flight. If CP &lt; CG (unstable), a higher drag coefficient is applied to model tumbling descent.</Help>
            </Field>
          </div>
          {orkData && (cpIn || cgIn) && (
            <p className="mt-2 text-xs text-amber-400/80">
              Note: OpenRocket displays CG/CP at M&nbsp;=&nbsp;0.3 in its stability indicator. Values auto-filled from the .ork file reflect that reference condition — CP sits slightly further aft at M&nbsp;=&nbsp;0.3 than at static launch (M&nbsp;=&nbsp;0), so the stability margin shown here may be slightly optimistic. You can override these manually if needed.
            </p>
          )}
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
          <Field label="Max launch angle (°, site limit)">
            <input type="number" min="1" max="20" step="1"
              value={maxAngle} onChange={e => setMaxAngle(e.target.value)}
              placeholder="20" className="input-field" />
            <Help>NAR/Tripoli hard limit is 20°. Enter a lower value if your launch site imposes a stricter angle restriction. The simulation sweeps 0° up to this cap.</Help>
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

        {/* Wind direction for map overlay */}
        <div className="mt-3">
          <Field label="Wind direction (° from North, optional)">
            <input type="number" min="0" max="360" step="1"
              value={windBearing}
              onChange={e => {
                setWindBearing(e.target.value);
                const v = parseFloat(e.target.value);
                onWindBearingChange?.(isNaN(v) ? null : v % 360);
              }}
              placeholder="e.g. 270 = west wind"
              className="input-field" />
          </Field>
          <p className="text-xs text-slate-500 mt-1">
            Shown as a wind arrow on the hazard zone map. 0 = N, 90 = E, 180 = S, 270 = W.
          </p>
        </div>
      </Section>

      {/* ── Motor — hidden for multi-stage (motors entered in stage panels above) */}
      {parseInt(numStages) <= 1 && <Section title="Motor">
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
                <input type="number" min="0.1" step="any"
                  value={avgThrust} onChange={e => setAvgThrust(e.target.value)}
                  placeholder="e.g. 500" className="input-field" />
                <Help>Average thrust over the burn. With burn time, determines total impulse and motor class.</Help>
              </Field>
              <Field label="Burn time (sec)">
                <input type="number" min="0.01" step="any"
                  value={burnTimeS} onChange={e => setBurnTimeS(e.target.value)}
                  placeholder="e.g. 2.5" className="input-field" />
                <Help>Motor burn duration in seconds. Longer burn = more total impulse = higher and faster flight.</Help>
              </Field>
              <Field label="Propellant mass (lbs)">
                <input type="number" min="0.001" step="any"
                  value={propMass} onChange={e => setPropMass(e.target.value)}
                  placeholder="e.g. 0.50" className="input-field" />
                <Help>Propellant mass only (not the motor casing). Rocket gets lighter as it burns, increasing acceleration.</Help>
              </Field>
              <Field label="Total motor mass (lbs)">
                <input type="number" min="0.001" step="any"
                  value={motorMass} onChange={e => setMotorMass(e.target.value)}
                  placeholder="e.g. 1.20" className="input-field" />
                <Help>Full motor weight including casing, propellant, and nozzle. Subtracted to get dry mass at burnout.</Help>
              </Field>
            </div>
          </>
        )}
      </Section>}

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
