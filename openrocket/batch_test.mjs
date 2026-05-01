#!/usr/bin/env node
/**
 * batch_test.mjs v2 — IREC 2026 FAA Hazard Zone batch stress test
 *
 * Changes from v1:
 *   - Tier 3 simulation: Barrowman component drag buildup (CD from geometry)
 *   - Nose cone type extraction from .ork XML
 *   - Multi-stage vehicle detection + stage count
 *   - Per-file override support via batch_overrides.json
 *   - New CSV columns: is_multistage, stage_count, nosecone_type, barrowman_cd, cd_used, override_applied
 *   - apogee_diff_pct already present — now computed for Tier 3 as well
 *
 * Setup:  cd "C:\Users\bsoltes\FAA Hazard analysis\openrocket"
 *         npm install @xmldom/xmldom fflate
 * Run:    node batch_test.mjs
 *
 * Overrides: create batch_overrides.json in the same directory:
 *   {
 *     "12345_TeamName.ork": {
 *       "nosecone_type": "conical",   // override parsed nose type
 *       "diameter_in": 4.0,           // override geometry
 *       "length_in": 72.0,
 *       "mass_lb": 12.5,              // override wet launch mass (lb)
 *       "motor_designation": "K1000T",// override motor
 *       "notes": "explanation"
 *     }
 *   }
 */

import { readFileSync, writeFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join, extname, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';

// ─── Config ──────────────────────────────────────────────────────────────────
const ORK_DIR       = dirname(fileURLToPath(import.meta.url)); // .ork files live alongside this script
const OUT_FILE      = './batch_results_tier3.csv';
const OVERRIDE_FILE = './batch_overrides.json';

// Conservative FAA defaults (worst case)
const SITE_ELEV_FT  = 0;
const SITE_TEMP_F   = 59;
const WIND_MPH      = 20;
const MAX_ANGLE_DEG = 20;

// ─── Unit conversions ────────────────────────────────────────────────────────
const M_TO_FT  = 3.28084;
const M_TO_IN  = 1 / 0.0254;
const IN_TO_M  = 0.0254;
const KG_TO_LB = 2.20462;
const LB_TO_KG = 0.453592;
const MPH_TO_MS = 0.44704;

// ─── Load overrides ───────────────────────────────────────────────────────────
let OVERRIDES = {};
if (existsSync(OVERRIDE_FILE)) {
  try {
    OVERRIDES = JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8'));
    console.log(`Loaded overrides for ${Object.keys(OVERRIDES).length} files from ${OVERRIDE_FILE}`);
  } catch (err) {
    console.warn(`Warning: could not parse ${OVERRIDE_FILE}: ${err.message}`);
  }
}

// ─── ISA Atmosphere ──────────────────────────────────────────────────────────
const G0     = 9.80665;
const R_AIR  = 287.058;
const GAMMA  = 1.4;

const ATM_LAYERS = [
  { baseAlt: 0,     lapse: -0.0065, baseT: 288.15, baseP: 101325.0 },
  { baseAlt: 11000, lapse:  0.0,    baseT: 216.65, baseP:  22632.1  },
  { baseAlt: 20000, lapse:  0.001,  baseT: 216.65, baseP:   5474.89 },
  { baseAlt: 32000, lapse:  0.0028, baseT: 228.65, baseP:    868.019 },
  { baseAlt: 47000, lapse:  0.0,    baseT: 270.65, baseP:    110.906 },
  { baseAlt: 51000, lapse: -0.0028, baseT: 270.65, baseP:     66.9389 },
  { baseAlt: 71000, lapse: -0.002,  baseT: 214.65, baseP:      3.95642 },
  { baseAlt: 86000, lapse:  0.0,    baseT: 186.87, baseP:      0.3734  },
];

function atmLayer(h) {
  for (let i = ATM_LAYERS.length - 1; i >= 0; i--) {
    if (h >= ATM_LAYERS[i].baseAlt) return ATM_LAYERS[i];
  }
  return ATM_LAYERS[0];
}

function isaTemperature(h, tOffset = 0) {
  const L = atmLayer(h);
  return L.baseT + L.lapse * (h - L.baseAlt) + tOffset;
}

function isaPressure(h) {
  const L = atmLayer(h);
  const dh = h - L.baseAlt;
  if (Math.abs(L.lapse) < 1e-10)
    return L.baseP * Math.exp(-G0 * dh / (R_AIR * L.baseT));
  return L.baseP * Math.pow(L.baseT / (L.baseT + L.lapse * dh), G0 / (R_AIR * L.lapse));
}

function tempOffset(siteElev_m, siteTemp_K) {
  return siteTemp_K - isaTemperature(siteElev_m);
}

function airDensity(h, tOffset) {
  return isaPressure(h) / (R_AIR * isaTemperature(h, tOffset));
}

function speedOfSound(h, tOffset) {
  return Math.sqrt(GAMMA * R_AIR * isaTemperature(h, tOffset));
}

// ─── Aerodynamics ────────────────────────────────────────────────────────────
function cdFromFineness(fr) {
  return 0.35 + 3.0 / (fr * fr);
}

function cdMach(cdSub, mach) {
  // OR-calibrated formula (session 8): matches OpenRocket behavior for ogive/haack noses.
  // OR adds ~zero wave drag for tangent ogive (sinphi=0 bug #2998) and very low for haack.
  // At supersonic speeds OR's skin friction decreases (Van Driest) so total CD drops below subsonic.
  // Peak 1.20× at M=1.0 → 0.91× at M=1.3 → 0.71× at M=2.0.
  // Sources: aerodynamics_reference.md §12.1–12.4; research agents session 7.
  // NOTE: NOT used for tangent ogive — use tangentOgiveWaveDrag() instead (session 9 fix).
  if (mach < 0.87) return cdSub;
  if (mach < 1.0) { const t = (mach - 0.87) / 0.13; return cdSub * (1.0 + 0.20 * t * t); }  // 1.0→1.20 at M=1.0
  if (mach < 1.3) { const t = (mach - 1.0) / 0.3;  return cdSub * (1.20 - 0.29 * t); }       // 1.20→0.91 at M=1.3
  return cdSub * 1.055 * Math.pow(mach, -0.561);                                               // 0.91→0.84→0.71 at M=1.3→1.5→2.0
}

/**
 * Mach correction for tangent ogive noses (session 9 fix — v2, session 14 transonic calibration).
 *
 * Root cause of old cdMach() error for ogives:
 *   cdMach() adds a +20% transonic peak at M=1.0 for ALL nose shapes.
 *   For tangent ogive, OR uses sinphi=0 → zero wave drag (bug #2998), so no transonic peak.
 *   BUT at supersonic speeds, OR's skin friction still decreases (Van Driest), so total CD
 *   falls BELOW subsonic value. The cdMach() supersonic decay (0.91× at M=1.3, 0.71× at M=2)
 *   captures this correctly and should be kept.
 *
 * Session 14 calibration: 20 positive M-class outliers remain at Mach 0.85–1.13 with the
 * flat cdSub below M=1.3. Real tangent ogives show ~12–13% drag rise in the transonic regime
 * despite OR's sinphi=0 bug suppressing it. A small parabolic bump (peak +13% at M≈0.975)
 * is added to reduce ~7 of those outliers.
 *
 * Shape:
 *   M < 0.85:       flat at cdSub
 *   M 0.85→1.10:    parabolic bump, +13% peak at M=0.975 (t=0.5)
 *   M ≥ 1.10:       supersonic decay 1.055·M^(-0.561) — smooth at M=1.10 (≈1.00×)
 *
 * Source: aerodynamics_reference.md §12.1; batch calibration session 14.
 */
function cdMachOgive(cdSub, mach) {
  if (mach < 0.85) return cdSub;
  if (mach < 1.1) {
    const t    = (mach - 0.85) / 0.25;        // 0 at M=0.85, 1 at M=1.10
    const bump = 0.13 * 4.0 * t * (1.0 - t);  // parabola, peak +13% at t=0.5 (M≈0.975)
    return cdSub * (1.0 + bump);
  }
  return cdSub * 1.055 * Math.pow(mach, -0.561);
}

/**
 * Barrowman component drag buildup (Tier 3 CD).
 * Ported from barrowmanDrag.ts. Inputs in inches, returns dimensionless CD.
 *
 * Components:
 *   - Skin friction drag (turbulent flat-plate, Cf = 0.005)
 *   - Nose cone pressure drag (conical only; ogive/haack ≈ 0 subsonic)
 *   - Base drag (Hoerner empirical: 0.029 / sqrt(Cf_body))
 *   - Fin skin friction + interference drag (1.1× junction factor)
 *
 * Referenced to max body cross-section area.
 */
function barrowmanDragBuildup({ noseconeType, noseLength_in, bodyDiameter_in, bodyLength_in,
                                 finRootChord_in, finTipChord_in, finSpan_in, numFins,
                                 totalImpulse_Ns = 0, mass_kg = 0 }) {
  // Re-based skin friction: reduce Cf at high Reynolds numbers (N/O class rockets)
  const v_ref_ms  = (mass_kg > 0 && totalImpulse_Ns > 0)
    ? totalImpulse_Ns / (mass_kg * 2.0)
    : 250;
  const Re_L = v_ref_ms * (bodyLength_in * IN_TO_M) / 1.5e-5;
  const CF   = Math.max(0.004, 0.005 * Math.pow(3e7 / Math.max(Re_L, 3e7), 0.15));
  const CD_parasitic = 0.02; // launch lugs, surface roughness, body joints

  const D = bodyDiameter_in * IN_TO_M;
  const R = D / 2;
  const A_ref = Math.PI * R * R;

  if (A_ref <= 0 || D <= 0) {
    return { CD_friction: 0.35, CD_base: 0.05, CD_fins: 0, CD_nose_pressure: 0, CD_total: 0.40 };
  }

  const L_n = noseLength_in * IN_TO_M;
  const L_b = Math.max(0, bodyLength_in * IN_TO_M - L_n);

  // Nose wetted area (slant surface of equivalent cone)
  const A_wet_nose = L_n > 0 ? Math.PI * R * Math.sqrt(L_n * L_n + R * R) : 0;

  // Nose pressure drag — only conical has meaningful subsonic pressure drag
  let CD_nose_pressure = 0;
  const nType = (noseconeType ?? 'ogive').toLowerCase();
  if (nType === 'conical' && L_n > 0) {
    const half_angle = Math.atan(R / L_n);
    CD_nose_pressure = Math.min(2 * Math.sin(half_angle) ** 2, 0.05);
  } else if (nType === 'parabolic') {
    CD_nose_pressure = 0.01;
  }

  // Body tube wetted area
  const A_wet_body = Math.PI * D * L_b;

  // Total skin friction
  const CD_friction = CF * (A_wet_nose + A_wet_body) / A_ref;

  // Base drag (Hoerner empirical)
  const CD_friction_body = CF * A_wet_body / A_ref;
  const CD_base = CD_friction_body > 0
    ? 0.029 / Math.sqrt(CD_friction_body)
    : 0.08;

  // Fin drag
  let CD_fins = 0;
  const t_over_c = 0.05; // 5% thickness ratio
  if (numFins > 0 && finRootChord_in > 0 && finSpan_in > 0) {
    const c_root = finRootChord_in * IN_TO_M;
    const c_tip  = (finTipChord_in ?? 0) * IN_TO_M;
    const span   = finSpan_in * IN_TO_M;
    const A_fin  = 0.5 * (c_root + c_tip) * span;
    CD_fins = numFins * (2 * A_fin / A_ref) * CF * (1 + 2 * t_over_c) * 1.1;
  }

  const CD_total = CD_friction + CD_nose_pressure + CD_base + CD_fins + CD_parasitic;
  return { CD_friction, CD_base, CD_fins, CD_nose_pressure, CD_parasitic, CD_total };
}

// ─── Motor helpers ───────────────────────────────────────────────────────────
function thrustAt(motor, t) {
  const c = motor.thrustCurve;
  if (!c.length) return 0;
  if (t < c[0].time || t > c[c.length - 1].time) return 0;
  let lo = 0, hi = c.length - 1;
  while (lo < hi - 1) { const mid = (lo + hi) >> 1; if (c[mid].time <= t) lo = mid; else hi = mid; }
  const frac = c[hi].time === c[lo].time ? 0 : (t - c[lo].time) / (c[hi].time - c[lo].time);
  return c[lo].thrust + frac * (c[hi].thrust - c[lo].thrust);
}

function totalImpulse(motor) {
  const c = motor.thrustCurve;
  let I = 0;
  for (let i = 1; i < c.length; i++)
    I += 0.5 * (c[i].thrust + c[i - 1].thrust) * (c[i].time - c[i - 1].time);
  return I;
}

function motorClass(I) {
  const classes = [[2.5,'A'],[5,'B'],[10,'C'],[20,'D'],[40,'E'],[80,'F'],
    [160,'G'],[320,'H'],[640,'I'],[1280,'J'],[2560,'K'],[5120,'L'],[10240,'M'],[20480,'N'],[40960,'O']];
  for (const [lim, letter] of classes) if (I <= lim) return letter;
  return 'O+';
}

// ─── RK4 Trajectory simulator ────────────────────────────────────────────────
function simulate(cfg) {
  const { motor, bodyDiameter_m, bodyLength_m, totalMass_kg,
          cdOverride, launchAngle_deg, siteElevation_m, siteTemp_K,
          surfaceWind_ms, initialZ_m = 0, noseconeType = 'ogive' } = cfg;

  const I_total = totalImpulse(motor);
  const mp      = motor.propellantMassKg;
  const dryMass = totalMass_kg - mp;
  const tOff    = tempOffset(siteElevation_m, siteTemp_K);
  const aRad    = launchAngle_deg * Math.PI / 180;
  const sinA    = Math.sin(aRad), cosA = Math.cos(aRad);
  const refArea = Math.PI * (bodyDiameter_m / 2) ** 2;
  const cdSub   = cdOverride ?? cdFromFineness(bodyLength_m / bodyDiameter_m);

  let x = 0, z = initialZ_m;
  let vx = Math.sin(aRad) * 0.5, vz = Math.cos(aRad) * 0.5;
  let m = totalMass_kg;
  let t = 0;
  let wasAboveGround = initialZ_m > 5;
  let maxZ = initialZ_m;
  let maxMach = 0;

  const derivs = (t_, x_, z_, vx_, vz_, m_) => {
    const absZ  = Math.max(z_ + siteElevation_m, 0);
    const T     = thrustAt(motor, t_);
    const P     = isaPressure(absZ);
    const Tcorr = (motor.nozzleExitAreaM2 && T > 0) ? T + (101325 - P) * motor.nozzleExitAreaM2 : T;
    const vxRel = vx_ - surfaceWind_ms, vzRel = vz_;
    const vRel  = Math.sqrt(vxRel ** 2 + vzRel ** 2);
    let dragX = 0, dragZ = 0;
    if (vRel > 0.1) {
      const mach = vRel / speedOfSound(absZ, tOff);
      // Nose-type-specific Mach correction (session 9):
      // Tangent ogive: OR bug #2998 gives ~zero wave drag; use small absolute correction.
      // All other shapes: universal multiplicative correction calibrated to OR session 8.
      const cdAtMach = (noseconeType === 'ogive')
        ? cdMachOgive(cdSub, mach)
        : cdMach(cdSub, mach);
      const D    = 0.5 * airDensity(absZ, tOff) * vRel ** 2 * refArea * cdAtMach;
      dragX = -D * vxRel / vRel;
      dragZ = -D * vzRel / vRel;
    }
    const ax = (Tcorr * sinA + dragX) / m_;
    const az = (Tcorr * cosA + dragZ) / m_ - G0;
    const dm = (I_total > 0 && T > 0 && m_ > dryMass) ? -mp * T / I_total : 0;
    return { dx: vx_, dz: vz_, dvx: ax, dvz: az, dm };
  };

  const maxTime = 600;
  while (t < maxTime) {
    if (z > 5) wasAboveGround = true;
    if (wasAboveGround && z < -1.0) break;
    if (!wasAboveGround && t > 30) break;
    if (z > maxZ) maxZ = z;

    const T_now = thrustAt(motor, t);
    const dt = T_now > 0 ? 0.01 : 0.05;

    const k1 = derivs(t,        x,               z,               vx,               vz,               m);
    const k2 = derivs(t+dt/2,   x+dt/2*k1.dx,   z+dt/2*k1.dz,   vx+dt/2*k1.dvx,  vz+dt/2*k1.dvz,  m+dt/2*k1.dm);
    const k3 = derivs(t+dt/2,   x+dt/2*k2.dx,   z+dt/2*k2.dz,   vx+dt/2*k2.dvx,  vz+dt/2*k2.dvz,  m+dt/2*k2.dm);
    const k4 = derivs(t+dt,     x+dt*k3.dx,     z+dt*k3.dz,     vx+dt*k3.dvx,    vz+dt*k3.dvz,    m+dt*k3.dm);

    x  += dt/6 * (k1.dx  + 2*k2.dx  + 2*k3.dx  + k4.dx);
    z  += dt/6 * (k1.dz  + 2*k2.dz  + 2*k3.dz  + k4.dz);
    vx += dt/6 * (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx);
    vz += dt/6 * (k1.dvz + 2*k2.dvz + 2*k3.dvz + k4.dvz);
    m  = Math.max(m + dt/6 * (k1.dm + 2*k2.dm + 2*k3.dm + k4.dm), dryMass);
    const vRel_now = Math.sqrt((vx - surfaceWind_ms)**2 + vz**2);
    if (vRel_now > 0.1) {
      const absZ_now = Math.max(z + siteElevation_m, 0);
      maxMach = Math.max(maxMach, vRel_now / speedOfSound(absZ_now, tOff));
    }
    t += dt;
  }
  return { finalX_m: Math.abs(x), maxZ_m: maxZ, peakMach: maxMach };
}

// ─── Hazard zone sweep ───────────────────────────────────────────────────────
function computeHazardZone(input) {
  const {
    bodyDiameter_in, bodyLength_in, totalMass_lb, motor,
    cg_in, cp_in, siteElevation_ft, siteTemp_F, surfaceWind_mph,
    cdOverride,    // pre-computed CD (Tier 3 Barrowman); if null falls back to fineness
    noseconeType = 'ogive',
  } = input;

  const diameter_m  = bodyDiameter_in * IN_TO_M;
  const length_m    = bodyLength_in   * IN_TO_M;
  const mass_kg     = totalMass_lb    * LB_TO_KG;
  const siteElev_m  = siteElevation_ft / M_TO_FT;
  const siteTemp_K  = (siteTemp_F - 32) * 5/9 + 273.15;
  const wind_ms     = surfaceWind_mph * MPH_TO_MS;

  // Stability correction — applied on top of whatever CD we have
  let stabMargin = null, stabCat = '', stabMult = 1.0;
  if (cg_in != null && cp_in != null && bodyDiameter_in > 0) {
    stabMargin = (cp_in - cg_in) / bodyDiameter_in;
    if (stabMargin >= 1.0)      { stabCat = 'stable';   stabMult = 1.0; }
    else if (stabMargin >= 0.0) { stabCat = 'marginal'; stabMult = 1.5; }
    else                        { stabCat = 'unstable'; stabMult = 2.0; }
  }

  const fineness = length_m / diameter_m;
  const baseCd = cdOverride ?? cdFromFineness(fineness);
  const effectiveCd = baseCd * stabMult;

  // Sweep angles 0..20 step 2
  let maxRange_m = 0, bestAngle = 0;
  for (let angleDeg = 0; angleDeg <= MAX_ANGLE_DEG; angleDeg += 2) {
    const { finalX_m } = simulate({
      bodyDiameter_m: diameter_m, bodyLength_m: length_m,
      totalMass_kg: mass_kg, motor,
      cdOverride: effectiveCd, launchAngle_deg: angleDeg,
      siteElevation_m: siteElev_m, siteTemp_K, surfaceWind_ms: wind_ms,
      noseconeType,
    });
    if (finalX_m > maxRange_m) { maxRange_m = finalX_m; bestAngle = angleDeg; }
  }

  // Vertical shot for apogee (no wind, no stability penalty on ascent)
  const { maxZ_m, peakMach } = simulate({
    bodyDiameter_m: diameter_m, bodyLength_m: length_m,
    totalMass_kg: mass_kg, motor,
    cdOverride: baseCd, launchAngle_deg: 0,
    siteElevation_m: siteElev_m, siteTemp_K, surfaceWind_ms: 0,
    noseconeType,
  });

  return {
    hazardRadius_ft: maxRange_m * M_TO_FT,
    ourApogee_ft:    maxZ_m * M_TO_FT,
    stabilityMargin_cal: stabMargin,
    stabilityCategory:   stabCat,
    bestAngle_deg:       bestAngle,
    peakMach,
  };
}

// Tier 1: descent from apogee with conservative defaults
function computeTier1(apogee_ft) {
  const apogee_m   = apogee_ft / M_TO_FT;
  const siteElev_m = SITE_ELEV_FT / M_TO_FT;
  const siteTemp_K = (SITE_TEMP_F - 32) * 5/9 + 273.15;
  const wind_ms    = WIND_MPH * MPH_TO_MS;
  const mass_kg    = 1.5;
  const diameter_m = 0.065;
  const length_m   = 50 * IN_TO_M;

  const descentMotor = {
    name: 'Tier1', diameterMm: 0, lengthMm: 0,
    propellantMassKg: 0, totalMassKg: mass_kg,
    manufacturer: '', thrustCurve: [],
  };

  const { finalX_m: descentRange_m } = simulate({
    bodyDiameter_m: diameter_m, bodyLength_m: length_m,
    totalMass_kg: mass_kg, motor: descentMotor,
    cdOverride: 0.50, launchAngle_deg: 0,
    siteElevation_m: siteElev_m, siteTemp_K,
    surfaceWind_ms: wind_ms, initialZ_m: apogee_m,
  });

  const ascentOffset_m = apogee_m * Math.tan(20 * Math.PI / 180) * 0.4;
  const physicsRange_m = descentRange_m + ascentOffset_m;
  const quarterRule_m  = apogee_m / 4;
  return Math.max(physicsRange_m, quarterRule_m) * M_TO_FT;
}

// ─── ThrustCurve.org lookup ───────────────────────────────────────────────────
const motorCache = new Map();

async function lookupMotor(designation) {
  if (!designation) return null;
  const key = designation.toLowerCase().trim();
  if (motorCache.has(key)) return motorCache.get(key);

  try {
    const searchRes = await fetch('https://www.thrustcurve.org/api/v1/search.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designation, availability: 'all' }),
    });
    if (!searchRes.ok) { motorCache.set(key, null); return null; }
    const searchData = await searchRes.json();
    const results = searchData.results ?? [];
    if (!results.length) { motorCache.set(key, null); return null; }
    const motorId = results[0].motorId;

    const dlRes = await fetch('https://www.thrustcurve.org/api/v1/download.json', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motorIds: [motorId], data: 'samples' }),
    });
    if (!dlRes.ok) { motorCache.set(key, null); return null; }
    const dlData = await dlRes.json();
    const downloads = dlData.results ?? [];
    if (!downloads.length) { motorCache.set(key, null); return null; }

    const ranked = ['cert', 'mfr', 'user'];
    const best = ranked.map(s => downloads.find(d => d.source === s && d.samples?.length))
      .find(Boolean) ?? downloads.find(d => d.samples?.length) ?? downloads[0];
    // downloads[0].motor can be an empty object {} for some motors (e.g. O5500X-PS).
    // Fall back to the search result, which always has propWeightG/totalWeightG populated.
    const meta   = downloads[0].motor ?? {};
    const sMeta  = results[0];  // search result — always has mass data

    const motor = {
      name:             String(meta.commonName  ?? sMeta.commonName  ?? motorId),
      diameterMm:       Number(meta.diameter    ?? sMeta.diameter    ?? 0),
      lengthMm:         Number(meta.length      ?? sMeta.length      ?? 0),
      propellantMassKg: Number(meta.propWeightG  ?? sMeta.propWeightG  ?? 0) / 1000,
      totalMassKg:      Number(meta.totalWeightG ?? sMeta.totalWeightG ?? 0) / 1000,
      manufacturer:     String(meta.manufacturer ?? sMeta.manufacturer ?? 'Unknown'),
      thrustCurve:      (best?.samples ?? []).map(s => ({ time: s.time, thrust: s.thrust })),
    };
    motorCache.set(key, motor);
    return motor;
  } catch {
    motorCache.set(key, null);
    return null;
  }
}

// ─── .ork XML parser (Node.js version using @xmldom/xmldom) ──────────────────
function isZip(buf) {
  return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b;
}

function isGzip(buf) {
  return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b;
}

async function decompressGzip(buf) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(buf);
  writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function extractXml(buf) {
  if (isZip(buf)) {
    const files = unzipSync(buf);
    const entries = Object.entries(files);
    if (!entries.length) throw new Error('Empty ZIP');
    const [, data] =
      entries.find(([n]) => n.endsWith('.ork') || n === 'rocket.ork') ?? entries[0];
    return new TextDecoder().decode(data);
  }
  if (isGzip(buf)) {
    return new TextDecoder().decode(await decompressGzip(buf));
  }
  return new TextDecoder().decode(buf);
}

function getText(el, tag) {
  if (!el) return '';
  const child = el.getElementsByTagName(tag)[0];
  return child ? (child.textContent ?? '') : '';
}

function getNum(el, tag) {
  const n = parseFloat(getText(el, tag));
  return isFinite(n) ? n : 0;
}

function parseRadiusStr(txt) {
  const t = txt.trim().toLowerCase();
  const s = t.startsWith('auto') ? t.replace(/^auto\s*/, '') : t;
  const n = parseFloat(s);
  return isFinite(n) && n > 0 ? n : 0;
}

function getRadius(el) {
  if (!el) return 0;
  for (const tag of ['radius', 'outerradius', 'outsideradius', 'aftradius']) {
    const child = el.getElementsByTagName(tag)[0];
    if (child) { const r = parseRadiusStr(child.textContent ?? ''); if (r > 0) return r; }
  }
  const attr = el.getAttribute('radius');
  if (attr) { const r = parseRadiusStr(attr); if (r > 0) return r; }
  return 0;
}

/**
 * Normalize nose cone shape string from OR XML to our canonical set.
 * OR values: OGIVE, CONICAL, PARABOLIC, HAACK, POWER, ELLIPSOID, SPHERICAL
 */
function normalizeNoseShape(raw) {
  const s = (raw ?? '').trim().toUpperCase();
  if (s === 'OGIVE' || s === 'VONKARMAN' || s === 'KARMAN') return 'ogive';
  if (s === 'CONICAL') return 'conical';
  if (s === 'PARABOLIC') return 'parabolic';
  if (s === 'HAACK' || s === 'VONKARMAN') return 'haack';
  if (s === 'POWER' || s === 'POWERSERIES') return 'parabolic'; // approximate
  if (s === 'ELLIPSOID' || s === 'ELLIPTIC') return 'ogive';   // approximate
  if (s === 'SPHERICAL') return 'ogive';                        // approximate
  return s.toLowerCase() || 'ogive';
}

// ─── Geometry-based structural mass helpers ─────────────────────────────────

/** Return the first DIRECT child element with the given tag (doesn't descend into subcomponents). */
function getDirectChild(el, tagName) {
  const tag = tagName.toLowerCase();
  for (let i = 0; i < el.childNodes.length; i++) {
    const n = el.childNodes[i];
    if (n.nodeType === 1 && (n.tagName ?? '').toLowerCase() === tag) return n;
  }
  return null;
}

/** Text content of first direct child with given tag, or null if absent. */
function directChildText(el, tagName) {
  const ch = getDirectChild(el, tagName);
  return ch ? (ch.textContent ?? '') : null;
}

/**
 * True if OR uses an explicit value for this element's mass rather than computing from geometry.
 *
 * In OR 1.10 XML format, the <overridemass> child element IS the active override value —
 * no separate "enabled" attribute exists. Presence of <overridemass> child (with value > 0)
 * means OR uses that value instead of geometry.
 *
 * Covers:
 *   direct <overridemass> child — OR uses this value, skip geometry
 *   direct <mass> child — intrinsic mass (masscomponent, parachute, etc.)
 */
function hasExplicitMassOverride(el) {
  return getDirectChild(el, 'overridemass') !== null
      || getDirectChild(el, 'mass') !== null;
}

/** Material density (kg/m³) from direct <material> child, or 0 if absent. */
function getMatDensity(el) {
  const matEl = getDirectChild(el, 'material');
  if (!matEl) return 0;
  const d = parseFloat(matEl.getAttribute('density') ?? '');
  return isFinite(d) && d > 0 ? d : 0;
}

/**
 * When a child radius tag is bare "auto" (no numeric value), OR derives the
 * component's outer radius from the parent tube's inner radius.
 * DOM path: el → <subcomponents> → parentTube
 */
function resolveAutoOuterRadius(el) {
  const subcomponents = el.parentNode;
  if (!subcomponents) return 0;
  const parentTube = subcomponents.parentNode;
  if (!parentTube) return 0;
  const r = parseRadiusStr(directChildText(parentTube, 'radius') ?? directChildText(parentTube, 'outerradius') ?? '');
  const t = parseFloat(directChildText(parentTube, 'thickness') ?? '') || 0;
  return r > 0 ? r - t : 0;
}

/**
 * When a centeringring's innerradius is bare "auto", OR sets it to match the
 * sibling innertube (motor mount) outer radius. Searches sibling nodes in the
 * same <subcomponents> element.
 */
function resolveAutoInnerRadius(el) {
  const subcomponents = el.parentNode;
  if (!subcomponents) return 0;
  for (let i = 0; i < subcomponents.childNodes.length; i++) {
    const sib = subcomponents.childNodes[i];
    if (sib.nodeType === 1 && (sib.tagName ?? '').toLowerCase() === 'innertube') {
      const r = parseRadiusStr(directChildText(sib, 'outerradius') ?? directChildText(sib, 'radius') ?? '');
      if (r > 0) return r;
    }
  }
  return 0;
}

/** Hollow cylinder (tube) mass: ρ × π × (r_o² − r_i²) × L */
function tubeMass(density, r_m, t_m, L_m) {
  if (t_m <= 0 || t_m >= r_m || L_m <= 0) return 0;
  const ri = r_m - t_m;
  return density * Math.PI * (r_m * r_m - ri * ri) * L_m;
}

/**
 * Compute geometry-based structural mass for OR components that have no explicit
 * mass override — OR computes their mass from <material density> × geometry.
 * Our component_sum misses these because they carry no <mass> tag.
 *
 * Handles: bodytube, innertube, nosecone (+ shoulder), transition, bulkhead,
 *          centeringring, trapezoidfinset, ellipticalfinset, freeformfinset.
 * Returns kg.
 */
function computeGeometryMasses(doc) {
  let total = 0;

  // ── Body tubes, inner tubes, and tube couplers (hollow cylinders) ─────────
  // tubecoupler uses <outerradius>; body/innertubes use <radius>.
  // bare "auto" (no numeric value) → resolve outer radius from parent tube inner radius.
  for (const tag of ['bodytube', 'innertube', 'tubecoupler']) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (hasExplicitMassOverride(el)) continue;
      const density = getMatDensity(el);
      if (!density) continue;
      const rTxt = directChildText(el, 'radius') ?? directChildText(el, 'outerradius') ?? '';
      let r = parseRadiusStr(rTxt);
      if (!r && rTxt.trim().toLowerCase() === 'auto') r = resolveAutoOuterRadius(el);
      const t = parseFloat(directChildText(el, 'thickness') ?? '');
      const L = parseFloat(directChildText(el, 'length')    ?? '');
      const m = tubeMass(density, r, t, L);
      if (m > 0) total += m;
    }
  }

  // ── Nose cones (hollow shell, conical slant-length approximation) ────────
  const noseEls = doc.getElementsByTagName('nosecone');
  for (let i = 0; i < noseEls.length; i++) {
    const el = noseEls[i];
    if (hasExplicitMassOverride(el)) continue;
    const density = getMatDensity(el);
    if (!density) continue;
    const r = parseRadiusStr(directChildText(el, 'aftradius') ?? directChildText(el, 'radius') ?? '');
    const t = parseFloat(directChildText(el, 'thickness') ?? '');
    const L = parseFloat(directChildText(el, 'length')    ?? '');
    if (r > 0 && t > 0 && L > 0) {
      // Lateral surface ≈ conical frustum: SA = π r √(L² + r²)
      const slant = Math.sqrt(L * L + r * r);
      total += density * Math.PI * r * slant * t;
    }
    // Aft shoulder (cylindrical)
    const sL = parseFloat(directChildText(el, 'aftshoulderlength')    ?? '');
    const sR = parseFloat(directChildText(el, 'aftshoulderradius')    ?? '');
    const sT = parseFloat(directChildText(el, 'aftshoulderthickness') ?? '');
    const sm = tubeMass(density, sR, sT, sL);
    if (sm > 0) total += sm;
  }

  // ── Transitions / boat tails (hollow frustum) ───────────────────────────
  const transEls = doc.getElementsByTagName('transition');
  for (let i = 0; i < transEls.length; i++) {
    const el = transEls[i];
    if (hasExplicitMassOverride(el)) continue;
    const density = getMatDensity(el);
    if (!density) continue;
    const r1 = parseRadiusStr(directChildText(el, 'foreradius') ?? '');
    const r2 = parseRadiusStr(directChildText(el, 'aftradius')  ?? '');
    const t  = parseFloat(directChildText(el, 'thickness') ?? '');
    const L  = parseFloat(directChildText(el, 'length')    ?? '');
    if (r1 > 0 && r2 > 0 && t > 0 && L > 0) {
      const dr    = Math.abs(r2 - r1);
      const slant = Math.sqrt(L * L + dr * dr);
      total += density * Math.PI * (r1 + r2) * slant * t;
    }
  }

  // ── Bulkheads and centering rings (solid disk or washer) ────────────────
  // bare "auto" outerradius → parent tube inner radius
  // bare "auto" innerradius on centeringring → sibling innertube outer radius
  for (const tag of ['bulkhead', 'centeringring']) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      const el = els[i];
      if (hasExplicitMassOverride(el)) continue;
      const density = getMatDensity(el);
      if (!density) continue;
      const roTxt = directChildText(el, 'outerradius') ?? directChildText(el, 'radius') ?? '';
      let ro = parseRadiusStr(roTxt);
      if (!ro && roTxt.trim().toLowerCase() === 'auto') ro = resolveAutoOuterRadius(el);
      const riTxt = directChildText(el, 'innerradius') ?? '';
      let ri = parseRadiusStr(riTxt); // 0 for bulkhead
      if (!ri && tag === 'centeringring' && riTxt.trim().toLowerCase() === 'auto') {
        ri = resolveAutoInnerRadius(el);
      }
      const t  = parseFloat(directChildText(el, 'thickness') ?? '');
      if (ro > 0 && t > 0) total += density * Math.PI * (ro * ro - ri * ri) * t;
    }
  }

  // ── Trapezoidal fins (solid plate) ──────────────────────────────────────
  const trapEls = doc.getElementsByTagName('trapezoidfinset');
  for (let i = 0; i < trapEls.length; i++) {
    const el = trapEls[i];
    if (hasExplicitMassOverride(el)) continue;
    const density = getMatDensity(el);
    if (!density) continue;
    const nFins  = parseInt(directChildText(el, 'fincount') ?? '') || 3;
    const t      = parseFloat(directChildText(el, 'thickness')  ?? '');
    const rootC  = parseFloat(directChildText(el, 'rootchord') ?? '');
    const tipC   = parseFloat(directChildText(el, 'tipchord')  ?? '') || 0;
    const span   = parseFloat(directChildText(el, 'height')    ?? '');
    // Include fin tab (rectangle: tablength × tabheight) — OR includes tab in fin mass
    const tabC = parseFloat(directChildText(el, 'tablength') ?? '') || 0;
    const tabH = parseFloat(directChildText(el, 'tabheight') ?? '') || 0;
    const trapArea = (rootC + tipC) / 2 * span + tabC * tabH;
    if (t > 0 && rootC > 0 && span > 0) total += density * trapArea * t * nFins;
  }

  // ── Elliptical fins (solid plate, ellipse area) ─────────────────────────
  const ellEls = doc.getElementsByTagName('ellipticalfinset');
  for (let i = 0; i < ellEls.length; i++) {
    const el = ellEls[i];
    if (hasExplicitMassOverride(el)) continue;
    const density = getMatDensity(el);
    if (!density) continue;
    const nFins = parseInt(directChildText(el, 'fincount') ?? '') || 3;
    const t     = parseFloat(directChildText(el, 'thickness')  ?? '');
    const rootC = parseFloat(directChildText(el, 'rootchord') ?? '');
    const span  = parseFloat(directChildText(el, 'height')    ?? '');
    if (t > 0 && rootC > 0 && span > 0) total += density * Math.PI / 4 * rootC * span * t * nFins;
  }

  // ── Freeform fins (shoelace polygon area) ───────────────────────────────
  const freeEls = doc.getElementsByTagName('freeformfinset');
  for (let i = 0; i < freeEls.length; i++) {
    const el = freeEls[i];
    if (hasExplicitMassOverride(el)) continue;
    const density = getMatDensity(el);
    if (!density) continue;
    const nFins = parseInt(directChildText(el, 'fincount') ?? '') || 3;
    const t     = parseFloat(directChildText(el, 'thickness') ?? '');
    const fpEl  = getDirectChild(el, 'finpoints');
    if (!t || !fpEl) continue;
    // Parse <point x="..." y="..."/> children
    const pts = [];
    for (let j = 0; j < fpEl.childNodes.length; j++) {
      const pn = fpEl.childNodes[j];
      if (pn.nodeType === 1 && (pn.tagName ?? '').toLowerCase() === 'point') {
        const x = parseFloat(pn.getAttribute('x') ?? '');
        const y = parseFloat(pn.getAttribute('y') ?? '');
        if (isFinite(x) && isFinite(y)) pts.push([x, y]);
      }
    }
    if (pts.length >= 3) {
      let area = 0;
      for (let j = 0; j < pts.length; j++) {
        const [x1, y1] = pts[j];
        const [x2, y2] = pts[(j + 1) % pts.length];
        area += x1 * y2 - x2 * y1;
      }
      // Add fin tab (rectangle: tablength × tabheight) — OR includes tab in fin mass
      const tabLen = parseFloat(directChildText(el, 'tablength') ?? '') || 0;
      const tabHgt = parseFloat(directChildText(el, 'tabheight') ?? '') || 0;
      const finArea = Math.abs(area) / 2 + tabLen * tabHgt;
      total += density * finArea * t * nFins;
    }
  }

  // ── Shock cords (linear density kg/m × cord length) ──────────────────────
  const shockEls = doc.getElementsByTagName('shockcord');
  for (let i = 0; i < shockEls.length; i++) {
    const el = shockEls[i];
    if (hasExplicitMassOverride(el)) continue;
    const matEl = getDirectChild(el, 'material');
    if (!matEl) continue;
    const linDens = parseFloat(matEl.getAttribute('density') ?? '');
    const cordLen = parseFloat(directChildText(el, 'cordlength') ?? '');
    if (isFinite(linDens) && linDens > 0 && isFinite(cordLen) && cordLen > 0) {
      total += linDens * cordLen;
    }
  }

  return total;
}

/**
 * Extract total wet launch mass from .ork XML (returns kg or null if not found).
 *
 * Strategy (in priority order):
 *   1. Databranch "Mass" column at t=0 — OR simulation total wet mass (structural + motor).
 *      When this source is used, do NOT add motor.totalMassKg separately.
 *   2. Sum component <mass> + <overridemass> elements AND geometry-computed structural
 *      masses (body tubes, nose cone, fins, etc.) — sanity-checked 0.5–400 kg.
 *      Add motor.totalMassKg separately when this source is used.
 */
function extractMass(doc) {
  const branchEls = Array.from(doc.getElementsByTagName('databranch'));
  for (const branch of branchEls) {
    const types = (branch.getAttribute('types') ?? '').split(',').map(s => s.trim().toLowerCase());
    const massIdx = types.findIndex(c => c === 'mass');
    if (massIdx < 0) continue;
    const dps = Array.from(branch.getElementsByTagName('datapoint'));
    if (!dps.length) continue;
    const vals = (dps[0].textContent ?? '').split(',');
    const v = parseFloat(vals[massIdx] ?? '');
    if (isFinite(v) && v >= 0.5 && v <= 2000) {
      return { mass_kg: v, source: 'databranch_t0', includesMotor: true };
    }
  }

  // Sum all <mass> elements (structural components) AND <overridemass> elements.
  // OR uses <overridemass> when a component's mass is explicitly overridden in the UI.
  // These are additive: <mass> gives base structural, <overridemass> gives explicit overrides
  // for components that don't have a <mass> child (ballast, altimeter bays, etc.).
  let total = 0;
  for (const tag of ['mass', 'overridemass']) {
    const els = doc.getElementsByTagName(tag);
    for (let i = 0; i < els.length; i++) {
      const v = parseFloat(els[i].textContent ?? '');
      if (isFinite(v) && v > 0) total += v;
    }
  }

  // Add geometry-computed structural masses: OR computes mass from material density × geometry
  // for body tubes, nose cones, fins, etc. that lack explicit <mass> overrides. These are
  // entirely absent from the <mass>/<overridemass> sum above.
  const geomMass = computeGeometryMasses(doc);
  const geomAdded = geomMass > 0;
  if (geomAdded) total += geomMass;

  if (total >= 0.5 && total <= 400) {
    return { mass_kg: total, source: geomAdded ? 'component_sum+geom' : 'component_sum', includesMotor: false };
  }

  return null;
}

/**
 * Compute CP from nose tip (meters) using simplified Barrowman equations.
 * Returns null if insufficient geometry data.
 */
function barrowmanCP(ork) {
  const {
    noseLength_m, diameter_m, totalLength_m,
    finRoot_m, finTip_m, finSpan_m, finSweep_m = 0, numFins = 3,
  } = ork;

  if (!diameter_m || diameter_m <= 0) return null;
  if (!noseLength_m || noseLength_m <= 0) return null;

  const r = diameter_m / 2;
  const d = diameter_m;

  const Cn_nose = 2;
  const x_nose  = (2 / 3) * noseLength_m;

  if (!finRoot_m || finRoot_m <= 0 || !finSpan_m || finSpan_m <= 0) {
    return x_nose;
  }

  const Cr = finRoot_m;
  const Ct = finTip_m ?? 0;
  const s  = finSpan_m;
  const Xs = finSweep_m;
  const n  = numFins;

  const midSweep = Xs + (Cr - Ct) / 2;
  const l_m = Math.sqrt(s * s + midSweep * midSweep);

  const K = 1 + r / (r + s);

  const denom = 1 + Math.sqrt(1 + Math.pow(2 * l_m / (Cr + Ct || Cr), 2));
  const Cn_fins = K * (4 * n * Math.pow(s / d, 2)) / denom;

  const x_cpf_from_le = Xs * (Cr + 2 * Ct) / (3 * (Cr + Ct || Cr)) +
    (Cr * Cr + Cr * Ct + Ct * Ct) / (3 * (Cr + Ct || Cr));

  const x_finLE = totalLength_m - Cr;
  const x_fins  = x_finLE + x_cpf_from_le;

  const Cn_total = Cn_nose + Cn_fins;
  if (Cn_total <= 0) return null;
  return (Cn_nose * x_nose + Cn_fins * x_fins) / Cn_total;
}

/**
 * Parse a single stage's geometry from its root element.
 * Returns { noseconeType, noseLength_m, radius_m, bodyLen_m, totalLen_m, finData... }
 */
function parseStageGeometry(stageEl, doc) {
  // Nose cone in this stage
  const noseEl = stageEl.getElementsByTagName('nosecone')[0] ?? null;
  const noseLen = noseEl ? getNum(noseEl, 'length') : 0;
  const noseRad = noseEl ? getRadius(noseEl) : 0;
  // Nose shape
  let noseconeShape = 'ogive';
  if (noseEl) {
    const shapeEl = noseEl.getElementsByTagName('shape')[0];
    const shapeAttr = noseEl.getAttribute('shape');
    const shapeRaw = shapeEl ? (shapeEl.textContent ?? '') : (shapeAttr ?? '');
    noseconeShape = normalizeNoseShape(shapeRaw);
  }

  const bodyEls  = Array.from(stageEl.getElementsByTagName('bodytube'));
  let maxRad = 0;
  for (const el of bodyEls) { const r = getRadius(el); if (r > maxRad) maxRad = r; }
  const radius_m   = maxRad > 0 ? maxRad : noseRad;
  const bodyLen_m  = bodyEls.reduce((s, el) => s + getNum(el, 'length'), 0);
  const totalLen_m = noseLen + bodyLen_m;

  // Motor in this stage (pick last motor matching a motormount)
  const motorMountEls = Array.from(stageEl.getElementsByTagName('motormount'));
  let motorDesig = null;
  for (const mm of motorMountEls) {
    const mEls = Array.from(mm.getElementsByTagName('motor'));
    if (mEls.length > 0) {
      const last = mEls[mEls.length - 1];
      const d = getText(last, 'designation');
      if (d) motorDesig = d;
    }
  }

  // Fins
  const trapEls  = Array.from(stageEl.getElementsByTagName('trapezoidfinset'));
  const ellipEls = Array.from(stageEl.getElementsByTagName('ellipticalfinset'));
  const freeEls  = Array.from(stageEl.getElementsByTagName('freefinset'));
  const finEl    = trapEls[trapEls.length - 1] ?? ellipEls[ellipEls.length - 1] ?? freeEls[freeEls.length - 1] ?? null;
  const finRoot_m  = finEl ? getNum(finEl, 'rootchord') : 0;
  const finTip_m   = finEl ? getNum(finEl, 'tipchord')  : 0;
  const finSpan_m  = finEl ? getNum(finEl, 'height')    : 0;
  const finSweep_m = finEl ? getNum(finEl, 'sweeplength') : 0;
  const finCountEl = finEl?.getElementsByTagName('fincount')[0];
  const numFins    = finCountEl ? (parseInt(finCountEl.textContent ?? '3', 10) || 3) : 3;

  return {
    noseconeShape, noseLength_m: noseLen, radius_m, bodyLen_m, totalLen_m,
    motorDesig,
    finRoot_m, finTip_m, finSpan_m, finSweep_m, numFins,
  };
}

async function parseOrk(buf) {
  const xmlString = await extractXml(buf);
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');

  const rocketEl = doc.getElementsByTagName('rocket')[0] ?? null;
  const rocketName = rocketEl
    ? (getText(rocketEl, 'name') || rocketEl.getAttribute('name') || undefined)
    : undefined;

  // ── Multi-stage detection ────────────────────────────────────────────────
  // Stages are direct children of rocket's subcomponents element.
  // stageEls[0] = sustainer (top), stageEls[N-1] = booster (bottom)
  const allStageEls = rocketEl
    ? Array.from(rocketEl.getElementsByTagName('stage'))
    : Array.from(doc.getElementsByTagName('stage'));

  // Filter to only direct-child stages of the rocket subcomponents
  // (avoid nested stages inside other components — unusual but possible)
  // Heuristic: a stage with a <nosecone> or <bodytube> descendant
  const stageEls = allStageEls.filter(s =>
    s.getElementsByTagName('bodytube').length > 0 ||
    s.getElementsByTagName('nosecone').length > 0
  );
  const stageCount = stageEls.length;
  const isMultiStage = stageCount > 1;

  // Parse per-stage geometry; stage[0] = sustainer
  const stageGeoms = stageEls.map(s => parseStageGeometry(s, doc));

  // ── Full-rocket geometry (combine all stages top-to-bottom) ──────────────
  // Use sustainer nose, max radius across all stages, sum of all lengths
  const sustainerGeom = stageGeoms[0] ?? null;
  let noseconeShape = sustainerGeom?.noseconeShape ?? 'ogive';
  let noseLen = sustainerGeom?.noseLength_m ?? 0;
  let radius_m = 0;
  let totalLen_m = 0;
  for (const g of stageGeoms) {
    if (g.radius_m > radius_m) radius_m = g.radius_m;
    totalLen_m += g.totalLen_m;
  }
  // Nose length applies to sustainer only — don't double-count across stages
  if (!sustainerGeom) {
    // Fallback: scan entire doc (original approach)
    const noseElFB = doc.getElementsByTagName('nosecone')[0] ?? null;
    noseLen = noseElFB ? getNum(noseElFB, 'length') : 0;
    const noseRadFB = noseElFB ? getRadius(noseElFB) : 0;
    const bodyElsFB = Array.from(doc.getElementsByTagName('bodytube'));
    for (const el of bodyElsFB) { const r = getRadius(el); if (r > radius_m) radius_m = r; }
    if (radius_m === 0) radius_m = noseRadFB;
    const bodyLen = bodyElsFB.reduce((s, el) => s + getNum(el, 'length'), 0);
    totalLen_m = noseLen + bodyLen;
    noseconeShape = 'ogive';
  }

  // ── Fins: use sustainer fins for CP/stability; booster fins for drag ──────
  // For a conservative hazard zone, sustainer fins govern stability.
  // Use aft-most finset of entire rocket for Barrowman CP (as before).
  const trapEls  = Array.from(doc.getElementsByTagName('trapezoidfinset'));
  const ellipEls = Array.from(doc.getElementsByTagName('ellipticalfinset'));
  const freeEls  = Array.from(doc.getElementsByTagName('freefinset'));
  const finEl    = trapEls[trapEls.length - 1] ?? ellipEls[ellipEls.length - 1] ?? freeEls[freeEls.length - 1] ?? null;
  const finRoot_m  = finEl ? getNum(finEl, 'rootchord') : 0;
  const finTip_m   = finEl ? getNum(finEl, 'tipchord')  : 0;
  const finSpan_m  = finEl ? getNum(finEl, 'height')    : 0;
  const finSweep_m = finEl ? getNum(finEl, 'sweeplength') : 0;
  const finCountEl = finEl?.getElementsByTagName('fincount')[0];
  const numFins    = finCountEl ? (parseInt(finCountEl.textContent ?? '3', 10) || 3) : 3;

  // ── Motor (default config, sustainer = last motor in default config) ──────
  const motorConfigEls = Array.from(doc.getElementsByTagName('motorconfiguration'));
  const defConfig = motorConfigEls.find(e => e.getAttribute('default') === 'true') ?? motorConfigEls[0];
  const defConfigId = defConfig?.getAttribute('configid') ?? null;
  const allMotorEls = Array.from(doc.getElementsByTagName('motor'));
  const matchMotors = defConfigId
    ? allMotorEls.filter(e => e.getAttribute('configid') === defConfigId)
    : allMotorEls;

  // For multi-stage: collect per-stage motors (stage[0] = sustainer = index 0)
  const perStageMotors = stageGeoms.map(g => g.motorDesig).filter(Boolean);

  // Primary motor = sustainer motor (first non-null per-stage or fallback to last match)
  const primaryMotorDesig = (stageGeoms[0]?.motorDesig)
    ?? (matchMotors.length > 0 ? (getText(matchMotors[matchMotors.length - 1], 'designation') || undefined) : undefined);

  // ── Stored OR simulation results ──────────────────────────────────────────
  const allSimEls = Array.from(doc.getElementsByTagName('simulation'));
  const matchSim  = defConfigId
    ? allSimEls.find(s => s.getElementsByTagName('configid')[0]?.textContent?.trim() === defConfigId)
    : allSimEls[0];
  const fdEl = matchSim?.getElementsByTagName('flightdata')[0] ?? null;
  let orApogee_m;
  if (fdEl) {
    const v = parseFloat(fdEl.getAttribute('maxaltitude') ?? '');
    if (isFinite(v) && v > 0) orApogee_m = v;
  }

  // ── CG from databranch ────────────────────────────────────────────────────
  let cgFromNose_m;
  const branchEls = Array.from(doc.getElementsByTagName('databranch'));
  for (const branch of branchEls) {
    const types = (branch.getAttribute('types') ?? '').split(',').map(s => s.trim().toLowerCase());
    const cgIdx = types.findIndex(c => c === 'cg location');
    const dps   = Array.from(branch.getElementsByTagName('datapoint'));
    if (!dps.length || cgIdx < 0) continue;
    const firstVals = (dps[0].textContent ?? '').split(',');
    const v = parseFloat(firstVals[cgIdx] ?? '');
    if (isFinite(v) && v > 0) { cgFromNose_m = v; break; }
  }

  if (cgFromNose_m == null) {
    const cgEl = doc.getElementsByTagName('cg')[0];
    if (cgEl) {
      const v = parseFloat(cgEl.textContent ?? '');
      if (isFinite(v) && v > 0) cgFromNose_m = v;
    }
  }

  // ── Barrowman CP ──────────────────────────────────────────────────────────
  const cpFromNose_m = barrowmanCP({
    noseLength_m: noseLen,
    diameter_m:   radius_m * 2,
    totalLength_m: totalLen_m,
    finRoot_m, finTip_m, finSpan_m, finSweep_m, numFins,
  });

  // ── Mass extraction ───────────────────────────────────────────────────────
  const massResult = extractMass(doc);

  return {
    rocketName,
    diameter_in:    radius_m * 2 * M_TO_IN,
    length_in:      totalLen_m * M_TO_IN,
    motorDesig:     primaryMotorDesig,
    orApogee_ft:    orApogee_m != null ? orApogee_m * M_TO_FT : null,
    massResult,
    cg_in:          cgFromNose_m != null ? cgFromNose_m * M_TO_IN : null,
    cp_in:          cpFromNose_m != null ? cpFromNose_m * M_TO_IN : null,
    cp_source:      cpFromNose_m != null ? 'barrowman' : null,
    // New fields
    noseconeShape,
    noseLength_in:  noseLen * M_TO_IN,
    stageCount,
    isMultiStage,
    perStageMotors,
    // Fin geometry in inches (for Barrowman drag buildup)
    finRootChord_in: finRoot_m * M_TO_IN,
    finTipChord_in:  finTip_m  * M_TO_IN,
    finSpan_in:      finSpan_m * M_TO_IN,
    numFins,
  };
}

// ─── CSV helpers ─────────────────────────────────────────────────────────────
function csvEscape(v) {
  if (v == null) return '';
  const s = String(v);
  return s.includes(',') || s.includes('"') || s.includes('\n')
    ? `"${s.replace(/"/g, '""')}"` : s;
}

function row(fields) {
  return fields.map(csvEscape).join(',');
}

// ─── Main ─────────────────────────────────────────────────────────────────────
const HEADERS = [
  'team', 'filename', 'rocket_name', 'parse_status',
  'motor_designation', 'motor_found',
  'or_apogee_ft', 'diameter_in', 'length_in',
  'mass_found', 'mass_source', 'mass_lb',
  'cg_found', 'cg_in', 'cp_found', 'cp_in',
  'stability_cal', 'stability_category',
  'tier_run',
  'our_apogee_ft', 'apogee_diff_pct', 'peak_mach',
  'hazard_zone_ft',
  'motor_class', 'total_impulse_ns',
  // New columns
  'is_multistage', 'stage_count',
  'nosecone_type',
  'barrowman_cd', 'cd_used',
  'override_applied',
  'missing_fields', 'warnings',
];

async function processFile(filePath) {
  const filename = basename(filePath);
  const teamMatch = filename.match(/^(\d+)/);
  const team = teamMatch ? teamMatch[1] : '';

  const result = {
    team, filename,
    rocket_name: '', parse_status: '',
    motor_designation: '', motor_found: '',
    or_apogee_ft: '', diameter_in: '', length_in: '',
    mass_found: '', mass_source: '', mass_lb: '',
    cg_found: '', cg_in: '', cp_found: '', cp_in: '',
    stability_cal: '', stability_category: '',
    tier_run: '',
    our_apogee_ft: '', apogee_diff_pct: '', peak_mach: '',
    hazard_zone_ft: '',
    motor_class: '', total_impulse_ns: '',
    is_multistage: '', stage_count: '',
    nosecone_type: '',
    barrowman_cd: '', cd_used: '',
    override_applied: 'no',
    missing_fields: '', warnings: '',
  };

  let orkData;
  try {
    const buf = new Uint8Array(readFileSync(filePath));
    orkData = await parseOrk(buf);
    result.parse_status = 'ok';
  } catch (err) {
    result.parse_status = `PARSE_ERROR: ${err.message}`;
    return result;
  }

  // ── Apply per-file overrides ───────────────────────────────────────────────
  const ovr = OVERRIDES[filename];
  if (ovr) {
    result.override_applied = 'yes';
    const ovrNotes = ovr.notes ? ` [${ovr.notes}]` : '';
    const ovrFields = [];
    if (ovr.nosecone_type !== undefined) { orkData.noseconeShape = ovr.nosecone_type; ovrFields.push('nosecone_type'); }
    if (ovr.diameter_in   !== undefined) { orkData.diameter_in   = ovr.diameter_in;   ovrFields.push('diameter_in'); }
    if (ovr.length_in     !== undefined) { orkData.length_in     = ovr.length_in;     ovrFields.push('length_in'); }
    if (ovr.motor_designation !== undefined) { orkData.motorDesig = ovr.motor_designation; ovrFields.push('motor'); }
    // mass_lb and cd_override are applied later (after motor/barrowman computation)
    if (ovr.cd_override !== undefined) { ovrFields.push('cd'); }
    if (ovrFields.length > 0)
      result.warnings = `override: ${ovrFields.join(', ')}${ovrNotes}`;
  }

  result.rocket_name   = orkData.rocketName ?? '';
  result.diameter_in   = orkData.diameter_in  > 0 ? orkData.diameter_in.toFixed(2) : '';
  result.length_in     = orkData.length_in    > 0 ? orkData.length_in.toFixed(2)   : '';
  result.motor_designation = orkData.motorDesig ?? '';
  result.or_apogee_ft  = orkData.orApogee_ft  != null ? orkData.orApogee_ft.toFixed(0) : '';
  result.cg_found      = orkData.cg_in != null ? 'yes' : 'no';
  result.cg_in         = orkData.cg_in != null ? orkData.cg_in.toFixed(2) : '';
  result.cp_found      = orkData.cp_in != null ? 'yes' : 'no';
  result.cp_in         = orkData.cp_in != null ? orkData.cp_in.toFixed(2) : '';
  result.is_multistage = orkData.isMultiStage ? 'yes' : 'no';
  result.stage_count   = String(orkData.stageCount ?? 1);
  result.nosecone_type = orkData.noseconeShape ?? '';

  // Barrowman CD computed later inside motor block (needs motor impulse + mass for Re-aware Cf)
  let barrowmanCd = null;

  // cd_override from batch_overrides.json: bypasses Barrowman buildup entirely.
  // Use when Barrowman overestimates for a specific rocket (e.g. very high fineness
  // where Cf=0.005 >> actual flight Cf at Re~10^8). Value should be the effective
  // subsonic CD that reproduces OR's apogee when passed to simulate() as cdOverride.
  if (ovr?.cd_override !== undefined) {
    barrowmanCd = Number(ovr.cd_override);
    result.barrowman_cd = barrowmanCd.toFixed(4);
  }

  // Mass
  let mass_kg = null;
  if (orkData.massResult) {
    mass_kg = orkData.massResult.mass_kg;
    result.mass_found  = 'yes';
    result.mass_source = orkData.massResult.source;
    result.mass_lb     = (mass_kg * KG_TO_LB).toFixed(3);
  } else {
    result.mass_found = 'no';
  }

  // Motor lookup
  let motor = null;
  if (orkData.motorDesig) {
    try {
      motor = await lookupMotor(orkData.motorDesig);
    } catch { /* network error */ }
  }
  result.motor_found = motor ? 'yes' : 'no';

  if (motor) {
    const I = totalImpulse(motor);
    result.motor_class      = motorClass(I);
    result.total_impulse_ns = I.toFixed(1);

    // Apply mass override after motor lookup (lb → kg)
    if (ovr?.mass_lb !== undefined) {
      mass_kg = Number(ovr.mass_lb) * LB_TO_KG;
      result.mass_found  = 'yes';
      result.mass_source = 'override';
      result.mass_lb     = Number(ovr.mass_lb).toFixed(3);
    }

    const includesMotor = orkData.massResult?.includesMotor ?? false;
    const totalMass_kg = mass_kg != null
      ? (includesMotor || (ovr?.mass_lb !== undefined)
          ? mass_kg
          : mass_kg + motor.totalMassKg)
      : null;

    // Compute Barrowman CD with Re-aware skin friction (needs motor impulse + mass)
    if (!ovr?.cd_override && totalMass_kg != null && orkData.diameter_in > 0 && orkData.length_in > 0 && orkData.noseLength_in > 0) {
      const bd = barrowmanDragBuildup({
        noseconeType:    orkData.noseconeShape,
        noseLength_in:   orkData.noseLength_in,
        bodyDiameter_in: orkData.diameter_in,
        bodyLength_in:   orkData.length_in,
        finRootChord_in: orkData.finRootChord_in,
        finTipChord_in:  orkData.finTipChord_in,
        finSpan_in:      orkData.finSpan_in,
        numFins:         orkData.numFins,
        totalImpulse_Ns: I,
        mass_kg:         totalMass_kg,
      });
      barrowmanCd = bd.CD_total;
      result.barrowman_cd = barrowmanCd.toFixed(4);
    }

    const missing = [];
    if (!orkData.diameter_in || orkData.diameter_in <= 0) missing.push('diameter');
    if (!orkData.length_in   || orkData.length_in   <= 0) missing.push('length');
    if (totalMass_kg == null) missing.push('mass');
    result.missing_fields = missing.join('; ');

    // Multi-stage: our single-stage simulation only models the sustainer from the pad,
    // missing all booster energy and giving a wildly low apogee. If OR has already run
    // a full multi-stage simulation and stored the result, use that apogee directly
    // (same Tier 1 logic used for no-motor rockets). This is strictly better than
    // simulating sustainer-only.
    if (orkData.isMultiStage && orkData.orApogee_ft != null) {
      result.tier_run = 'tier1_multistage_or';
      result.cd_used  = 'n/a';
      const warn = `MULTI-STAGE (${orkData.stageCount} stages, motors: ${orkData.perStageMotors.join(' / ')}): using OR stored apogee (full multi-stage sim)`;
      result.warnings = result.warnings ? result.warnings + ' | ' + warn : warn;
      try {
        result.hazard_zone_ft = computeTier1(orkData.orApogee_ft).toFixed(0);
        result.or_apogee_ft   = orkData.orApogee_ft.toFixed(0);
        if (orkData.orApogee_ft != null) {
          result.apogee_diff_pct = '0.0';  // we're using OR apogee directly
        }
      } catch (err) {
        result.tier_run = 'tier1_multistage_error';
        result.warnings = result.warnings ? result.warnings + ' | ' + err.message : err.message;
      }
    } else if (totalMass_kg != null && orkData.diameter_in > 0 && orkData.length_in > 0) {
      // Choose tier: Tier 3 if Barrowman CD available, Tier 2 otherwise
      const tierCd   = barrowmanCd ?? null;
      const tierLabel = barrowmanCd != null ? 'tier3' : 'tier2';
      const cdLabel   = barrowmanCd != null ? `barrowman:${barrowmanCd.toFixed(4)}` : `fineness:${cdFromFineness(orkData.length_in / orkData.diameter_in).toFixed(4)}`;
      result.tier_run = tierLabel;
      result.cd_used  = cdLabel;

      try {
        const hz = computeHazardZone({
          bodyDiameter_in: orkData.diameter_in,
          bodyLength_in:   orkData.length_in,
          totalMass_lb:    totalMass_kg * KG_TO_LB,
          motor,
          cg_in: orkData.cg_in ?? undefined,
          cp_in: orkData.cp_in ?? undefined,
          siteElevation_ft: SITE_ELEV_FT,
          siteTemp_F:       SITE_TEMP_F,
          surfaceWind_mph:  WIND_MPH,
          cdOverride:       tierCd,   // null = use fineness fallback inside computeHazardZone
          noseconeType:     orkData.noseconeShape,
        });
        result.hazard_zone_ft     = hz.hazardRadius_ft.toFixed(0);
        result.our_apogee_ft      = hz.ourApogee_ft.toFixed(0);
        result.peak_mach          = hz.peakMach != null ? hz.peakMach.toFixed(2) : '';
        result.stability_cal      = hz.stabilityMargin_cal != null ? hz.stabilityMargin_cal.toFixed(3) : '';
        result.stability_category = hz.stabilityCategory ?? '';

        if (orkData.orApogee_ft != null && hz.ourApogee_ft > 0) {
          const diff = ((hz.ourApogee_ft - orkData.orApogee_ft) / orkData.orApogee_ft) * 100;
          result.apogee_diff_pct = diff.toFixed(1);
        }

        if (orkData.isMultiStage) {
          const warn = `MULTI-STAGE (${orkData.stageCount} stages, motors: ${orkData.perStageMotors.join(' / ')}): simulated as single-stage (sustainer only)`;
          result.warnings = result.warnings ? result.warnings + ' | ' + warn : warn;
        }
      } catch (err) {
        result.tier_run = `${tierLabel}_error`;
        result.warnings = result.warnings ? result.warnings + ' | ' + err.message : err.message;
      }
    } else if (orkData.orApogee_ft != null) {
      result.tier_run = 'tier1_no_mass';
      result.cd_used  = 'n/a';
      try {
        result.hazard_zone_ft = computeTier1(orkData.orApogee_ft).toFixed(0);
      } catch (err) {
        result.tier_run = 'tier1_error';
        result.warnings = result.warnings ? result.warnings + ' | ' + err.message : err.message;
      }
    } else {
      result.tier_run = 'skipped_no_mass_no_apogee';
    }
  } else {
    const missing = [];
    if (!orkData.diameter_in || orkData.diameter_in <= 0) missing.push('diameter');
    if (!orkData.length_in   || orkData.length_in   <= 0) missing.push('length');
    if (mass_kg == null) missing.push('mass');
    missing.push('motor');
    result.missing_fields = missing.join('; ');

    if (orkData.orApogee_ft != null) {
      result.tier_run = 'tier1_no_motor';
      result.cd_used  = 'n/a';
      try {
        result.hazard_zone_ft = computeTier1(orkData.orApogee_ft).toFixed(0);
      } catch (err) {
        result.tier_run = 'tier1_error';
        result.warnings = result.warnings ? result.warnings + ' | ' + err.message : err.message;
      }
    } else {
      result.tier_run = 'skipped_no_motor_no_apogee';
    }
  }

  return result;
}

async function main() {
  const entries = readdirSync(ORK_DIR);
  const orkFiles = entries
    .filter(f => extname(f).toLowerCase() === '.ork')
    .map(f => join(ORK_DIR, f))
    .filter(f => statSync(f).isFile());

  console.log(`Found ${orkFiles.length} .ork files in ${ORK_DIR}`);
  console.log(`Output: ${OUT_FILE}`);
  if (Object.keys(OVERRIDES).length > 0)
    console.log(`Overrides active: ${Object.keys(OVERRIDES).length} files`);
  console.log();

  const rows = [HEADERS.join(',')];
  let done = 0, tier3 = 0, tier2 = 0, tier1 = 0, skipped = 0, errors = 0, multiStage = 0;
  const motorMissCount = { yes: 0, no: 0 };
  const massMissCount  = { yes: 0, no: 0 };
  const cgMissCount    = { yes: 0, no: 0 };
  const cpMissCount    = { yes: 0, no: 0 };

  for (const filePath of orkFiles) {
    process.stdout.write(`[${done + 1}/${orkFiles.length}] ${basename(filePath)}...`);
    const r = await processFile(filePath);

    rows.push(row(HEADERS.map(h => r[h] ?? '')));
    done++;

    if (r.motor_found === 'yes') motorMissCount.yes++; else motorMissCount.no++;
    if (r.mass_found  === 'yes') massMissCount.yes++;  else massMissCount.no++;
    if (r.cg_found    === 'yes') cgMissCount.yes++;    else cgMissCount.no++;
    if (r.cp_found    === 'yes') cpMissCount.yes++;    else cpMissCount.no++;
    if (r.is_multistage === 'yes') multiStage++;

    const tier = r.tier_run;
    if (tier.startsWith('tier3'))       tier3++;
    else if (tier.startsWith('tier2'))  tier2++;
    else if (tier.startsWith('tier1'))  tier1++;
    else if (tier.startsWith('skip'))   skipped++;
    if (r.parse_status.startsWith('PARSE_ERROR')) errors++;

    const diffStr = r.apogee_diff_pct ? `diff=${r.apogee_diff_pct}%` : '';
    console.log(` → ${r.tier_run || r.parse_status}  hz=${r.hazard_zone_ft || '-'} ft  apogee=${r.our_apogee_ft || r.or_apogee_ft || '-'} ft  ${diffStr}`);

    if (done % 10 === 0) {
      writeFileSync(OUT_FILE, rows.join('\n'));
    }
  }

  writeFileSync(OUT_FILE, rows.join('\n'));

  console.log('\n─── Summary ──────────────────────────────────────────────────────────');
  console.log(`Total files:       ${orkFiles.length}`);
  console.log(`Parse errors:      ${errors}`);
  console.log(`Tier 3 runs:       ${tier3} / ${orkFiles.length}   (Barrowman CD)`);
  console.log(`Tier 2 runs:       ${tier2} / ${orkFiles.length}   (fineness ratio CD)`);
  console.log(`Tier 1 runs:       ${tier1} / ${orkFiles.length}   (apogee-only)`);
  console.log(`Skipped:           ${skipped}`);
  console.log(`Multi-stage:       ${multiStage} / ${orkFiles.length}`);
  console.log(`Motor found:       ${motorMissCount.yes} / ${orkFiles.length}`);
  console.log(`Mass found:        ${massMissCount.yes} / ${orkFiles.length}`);
  console.log(`CG found:          ${cgMissCount.yes} / ${orkFiles.length}`);
  console.log(`CP found:          ${cpMissCount.yes} / ${orkFiles.length}`);
  console.log(`\nResults saved to: ${OUT_FILE}`);
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
