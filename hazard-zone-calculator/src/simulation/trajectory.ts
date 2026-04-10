/**
 * 3-DOF point-mass trajectory integrator (RK4)
 *
 * Coordinate system:
 *   x = downrange (horizontal, positive downwind)
 *   z = altitude AGL (positive up)
 *   Wind along +x (headwind applied as relative velocity reduction)
 *
 * Conservative assumptions (larger hazard zone):
 *   - Nose-forward during descent (low drag — more range than tumbling)
 *   - Lower CD from fineness ratio vs actual detailed geometry
 *   - Max launch angle 20° from vertical (NAR/Tripoli limit)
 *   - Max wind 20 MPH (NAR/Tripoli limit)
 */

import { G0, airDensity, speedOfSound, isaTemperatureOffset, isaPressure } from './atmosphere';
import { cdFromFineness, cdMachCorrection, motorClass } from './aerodynamics';
import { thrustAt, totalImpulse, burnTime } from './motor';
import type { Motor, TrajectoryPoint, HazardZoneResult } from '../types';

const IN_TO_M = 0.0254;
const LB_TO_KG = 0.453592;
const M_TO_FT = 3.28084;
const MPH_TO_MS = 0.44704;

export interface SimConfig {
  bodyDiameter_m: number;
  bodyLength_m: number;
  totalMass_kg: number;
  motor: Motor;
  cdOverride?: number;
  launchAngle_deg: number;      // from vertical
  siteElevation_m: number;
  siteTemp_K: number;
  surfaceWind_ms: number;       // headwind speed
  initialZ_m?: number;          // starting altitude AGL (default 0 = ground launch)
}

// ─── Single trajectory simulation ──────────────────────────────────────────

export function simulate(config: SimConfig, dtMax = 0.05): TrajectoryPoint[] {
  const motor = config.motor;
  const I_total = totalImpulse(motor);
  const mp = motor.propellantMassKg;
  void burnTime; // burn time used only in termination logic

  const siteElev = config.siteElevation_m;
  const tOffset = isaTemperatureOffset(siteElev, config.siteTemp_K);

  const alphaRad = (config.launchAngle_deg * Math.PI) / 180;
  const sinA = Math.sin(alphaRad);
  const cosA = Math.cos(alphaRad);

  const refArea = Math.PI * Math.pow(config.bodyDiameter_m / 2, 2);
  const fineness = config.bodyLength_m / config.bodyDiameter_m;
  const cdSub = config.cdOverride ?? cdFromFineness(fineness);
  const dryMass = config.totalMass_kg - mp;

  // State: [x, z, vx, vz, m]
  const z0 = config.initialZ_m ?? 0;
  let x = 0, z = z0, vx = sinA * 0.5, vz = cosA * 0.5, m = config.totalMass_kg;

  const points: TrajectoryPoint[] = [];
  let t = 0;
  const maxTime = 600;
  // If starting above 5m (e.g. descent-from-apogee), skip the "must rise first" guard
  let wasAboveGround = z0 > 5;

  const derivs = (t_: number, _x_: number, z_: number, vx_: number, vz_: number, m_: number) => {
    const absZ = Math.max(z_ + siteElev, 0);
    const T = thrustAt(motor, t_);
    const P = isaPressure(absZ);
    const Tcorr = (motor.nozzleExitAreaM2 && T > 0)
      ? T + (101325 - P) * motor.nozzleExitAreaM2
      : T;

    const vxRel = vx_ - config.surfaceWind_ms;
    const vzRel = vz_;
    const vRel = Math.sqrt(vxRel * vxRel + vzRel * vzRel);

    let dragX = 0, dragZ = 0;
    if (vRel > 0.1) {
      const aSnd = speedOfSound(absZ, tOffset);
      const mach = vRel / aSnd;
      const cd = cdMachCorrection(cdSub, mach);
      const rho = airDensity(absZ, tOffset);
      const D = 0.5 * rho * vRel * vRel * refArea * cd;
      dragX = -D * vxRel / vRel;
      dragZ = -D * vzRel / vRel;
    }

    const ax = (Tcorr * sinA + dragX) / m_;
    const az = (Tcorr * cosA + dragZ) / m_ - G0;

    let dm = 0;
    if (I_total > 0 && T > 0 && m_ > dryMass) {
      dm = -mp * T / I_total;
    }

    return { dx: vx_, dz: vz_, dvx: ax, dvz: az, dm };
  };

  while (t < maxTime) {
    if (z > 5) wasAboveGround = true;
    if (wasAboveGround && z < -1.0) break;
    // Safety: if rocket never leaves the ground (zero-thrust motor), bail early
    if (!wasAboveGround && t > 30) break;

    // Record
    {
      const absZ = Math.max(z + siteElev, 0);
      const T = thrustAt(motor, t);
      const vxRel = vx - config.surfaceWind_ms;
      const vRel = Math.sqrt(vxRel * vxRel + vz * vz);
      const aSnd = speedOfSound(absZ, tOffset);
      const mach = vRel / (aSnd || 1);
      const cd = cdMachCorrection(cdSub, mach);
      const rho = airDensity(absZ, tOffset);
      const D = 0.5 * rho * vRel * vRel * refArea * cd;
      points.push({ t, x, z, vx, vz, mass: m, mach, thrust: T, drag: D });
    }

    // Adaptive timestep
    const T_now = thrustAt(motor, t);
    let dt = T_now > 0 ? 0.02 : Math.min(dtMax, 0.1);

    // RK4
    const k1 = derivs(t,        x,              z,              vx,              vz,              m);
    const k2 = derivs(t+dt/2,   x+dt/2*k1.dx,  z+dt/2*k1.dz,  vx+dt/2*k1.dvx, vz+dt/2*k1.dvz, m+dt/2*k1.dm);
    const k3 = derivs(t+dt/2,   x+dt/2*k2.dx,  z+dt/2*k2.dz,  vx+dt/2*k2.dvx, vz+dt/2*k2.dvz, m+dt/2*k2.dm);
    const k4 = derivs(t+dt,     x+dt*k3.dx,    z+dt*k3.dz,    vx+dt*k3.dvx,   vz+dt*k3.dvz,   m+dt*k3.dm);

    x  += (dt / 6) * (k1.dx  + 2*k2.dx  + 2*k3.dx  + k4.dx);
    z  += (dt / 6) * (k1.dz  + 2*k2.dz  + 2*k3.dz  + k4.dz);
    vx += (dt / 6) * (k1.dvx + 2*k2.dvx + 2*k3.dvx + k4.dvx);
    vz += (dt / 6) * (k1.dvz + 2*k2.dvz + 2*k3.dvz + k4.dvz);
    m  += (dt / 6) * (k1.dm  + 2*k2.dm  + 2*k3.dm  + k4.dm);
    m   = Math.max(m, dryMass);
    t  += dt;
  }

  return points;
}

// ─── Hazard zone: sweep launch angles ───────────────────────────────────────

export function stabilityCorrection(
  cg_in: number | undefined,
  cp_in: number | undefined,
  bodyDiameter_in: number,
): { margin_cal: number; multiplier: number; category: 'stable' | 'marginal' | 'unstable' } | null {
  if (cg_in == null || cp_in == null || bodyDiameter_in <= 0) return null;
  const margin = (cp_in - cg_in) / bodyDiameter_in;
  if (margin >= 1.0) return { margin_cal: margin, multiplier: 1.0, category: 'stable' };
  if (margin >= 0.0) return { margin_cal: margin, multiplier: 1.5, category: 'marginal' };
  return { margin_cal: margin, multiplier: 2.0, category: 'unstable' };
}

export interface HazardZoneInput {
  bodyDiameter_in: number;
  bodyLength_in: number;
  totalMass_lb: number;
  motor: Motor;
  cdOverride?: number;
  buildQuality?: number;    // multiplier on base CD (1.0 = ideal, 1.3 = typical build)
  cg_in?: number;
  cp_in?: number;
  siteElevation_ft: number;
  siteTemp_F: number;
  surfaceWind_mph: number;
  storeTrajectories?: boolean;
}

export function computeHazardZone(input: HazardZoneInput): HazardZoneResult {
  const diameter_m = input.bodyDiameter_in * IN_TO_M;
  const length_m   = input.bodyLength_in * IN_TO_M;
  const mass_kg    = input.totalMass_lb * LB_TO_KG;
  const siteElev_m = input.siteElevation_ft * (1 / M_TO_FT);
  const siteTemp_K = (input.siteTemp_F - 32) * 5/9 + 273.15;
  const wind_ms    = input.surfaceWind_mph * MPH_TO_MS;

  const I_total = totalImpulse(input.motor);
  const mClass  = motorClass(I_total);

  const warnings: string[] = [];
  if (I_total > 10240) warnings.push('Motor class M or above — additional FAA notification required.');
  if (input.surfaceWind_mph > 20) warnings.push('Wind exceeds NAR/Tripoli 20 MPH launch limit.');

  // Build quality + stability correction pipeline
  // Order: base CD → × buildQuality → × stability multiplier (if unstable)
  const stabResult = stabilityCorrection(input.cg_in, input.cp_in, input.bodyDiameter_in);
  const FR = length_m / diameter_m;
  const baseCdGeometry = (input.cdOverride ?? cdFromFineness(FR)) * (input.buildQuality ?? 1.0);
  let effectiveCdOverride: number = baseCdGeometry;
  if (stabResult && stabResult.multiplier !== 1.0) {
    effectiveCdOverride = baseCdGeometry * stabResult.multiplier;
    if (stabResult.category === 'marginal') {
      warnings.push(`Marginal stability (${stabResult.margin_cal.toFixed(2)} cal) — CD increased ×1.5 to model tumbling descent.`);
    } else {
      warnings.push(`Unstable rocket (${stabResult.margin_cal.toFixed(2)} cal) — CD increased ×2.0 to model tumbling descent. Result may be less conservative than nose-forward model.`);
    }
  }

  let maxRange_m = 0;
  let bestAngle = 0;
  const trajectories: Record<number, TrajectoryPoint[]> = {};

  for (let angleDeg = 0; angleDeg <= 20; angleDeg += 2) {
    const cfg: SimConfig = {
      bodyDiameter_m: diameter_m,
      bodyLength_m:   length_m,
      totalMass_kg:   mass_kg,
      motor:          input.motor,
      cdOverride:     effectiveCdOverride,
      launchAngle_deg: angleDeg,
      siteElevation_m: siteElev_m,
      siteTemp_K,
      surfaceWind_ms:  wind_ms,
    };

    const pts = simulate(cfg);
    const impactX = Math.abs(pts[pts.length - 1].x);

    if (impactX > maxRange_m) {
      maxRange_m = impactX;
      bestAngle = angleDeg;
    }

    if (input.storeTrajectories) {
      trajectories[angleDeg] = pts;
    }
  }

  // Apogee from vertical, no-wind shot
  const vertCfg: SimConfig = {
    bodyDiameter_m: diameter_m,
    bodyLength_m:   length_m,
    totalMass_kg:   mass_kg,
    motor:          input.motor,
    cdOverride:     effectiveCdOverride,
    launchAngle_deg: 0,
    siteElevation_m: siteElev_m,
    siteTemp_K,
    surfaceWind_ms: 0,
  };
  const vertPts = simulate(vertCfg);
  const maxApogee_m = Math.max(...vertPts.map(p => p.z));
  const quarterRule_m = maxApogee_m / 4;

  return {
    hazardRadius_m:           maxRange_m,
    hazardRadius_ft:          maxRange_m * M_TO_FT,
    optimalAngle_deg:         bestAngle,
    maxApogee_m,
    maxApogee_ft:             maxApogee_m * M_TO_FT,
    motorClass:               mClass,
    totalImpulse_Ns:          I_total,
    quarterAltitudeRule_m:    quarterRule_m,
    quarterRuleConservative:  quarterRule_m >= maxRange_m,
    trajectories: input.storeTrajectories ? trajectories : undefined,
    warnings,
    stabilityMargin_cal:  stabResult?.margin_cal,
    cdMultiplier:         stabResult?.multiplier,
    cdEffective:          effectiveCdOverride,
    stabilityCategory:    stabResult?.category,
  };
}

// ─── Tier 1: descent-from-apogee hazard zone ────────────────────────────────

/**
 * Tier 1 hazard zone: user supplies only the max expected apogee.
 *
 * Method:
 *  1. Simulate ballistic descent from apogee altitude (zero initial velocity)
 *     under max 20 MPH headwind, conservative CD=0.60, standard 1.5 kg rocket.
 *  2. Add geometric ascent offset = apogee × tan(20°) × 0.4 to account for
 *     horizontal drift during the powered ascent at the maximum 20° tilt angle.
 *  3. Report the greater of (physics result, NAR/Tripoli ¼-altitude rule).
 */
export function computeTier1HazardZone(
  apogee_ft: number,
  siteElev_ft: number,
  buildQuality = 1.0,
): HazardZoneResult {
  const apogee_m    = apogee_ft   * (1 / M_TO_FT);
  const siteElev_m  = siteElev_ft * (1 / M_TO_FT);
  const wind_ms     = 20 * MPH_TO_MS;  // NAR/Tripoli max
  const siteTemp_K  = 288.15;           // standard day (59°F)

  // Conservative rocket defaults: 1.5 kg, 65 mm diameter, 50 in long, CD=0.60
  const mass_kg    = 1.5;
  const diameter_m = 0.065;
  const length_m   = 50 * 0.0254;

  // Zero-thrust motor: pure ballistic descent
  const descentMotor: Motor = {
    name: 'Tier1_Descent',
    diameterMm: 0,
    lengthMm: 0,
    propellantMassKg: 0,
    totalMassKg: mass_kg,
    manufacturer: '',
    thrustCurve: [],
  };

  const cfg: SimConfig = {
    bodyDiameter_m: diameter_m,
    bodyLength_m:   length_m,
    totalMass_kg:   mass_kg,
    motor:          descentMotor,
    cdOverride:     0.60 * buildQuality,
    launchAngle_deg: 0,
    siteElevation_m: siteElev_m,
    siteTemp_K,
    surfaceWind_ms: wind_ms,
    initialZ_m:     apogee_m,
  };

  // Simulate one canonical descent — same physics for all launch angles
  const descentPts = simulate(cfg);
  const descentRange_m = Math.abs(descentPts[descentPts.length - 1].x);

  // Worst-case ascent offset at 20° tilt (factor 0.4 accounts for drag/gravity
  // reducing effective horizontal range during the powered climb)
  const maxAscentOffset_m = apogee_m * Math.tan(20 * Math.PI / 180) * 0.4;
  const physicsRange_m    = descentRange_m + maxAscentOffset_m;
  const quarterRule_m     = apogee_m / 4;
  const hazardRadius_m    = Math.max(physicsRange_m, quarterRule_m);

  // Build a sweep of shifted descent trajectories — one per launch angle.
  // Each trajectory has the same descent shape but starts at a different
  // downrange position (the apogee x-offset for that angle).
  // This recreates the multi-arc "ballistic sweep" visual used in Tier 2/3.
  const trajectories: Record<number, TrajectoryPoint[]> = {};
  for (let angleDeg = 0; angleDeg <= 20; angleDeg += 4) {
    const offsetFactor = angleDeg === 0 ? 0 : Math.tan(angleDeg * Math.PI / 180) * 0.4;
    const offset_m = apogee_m * offsetFactor;
    trajectories[angleDeg] = descentPts.map(p => ({ ...p, x: p.x + offset_m }));
  }

  const warnings: string[] = [];
  if (apogee_ft > 18000) {
    warnings.push('Launch above 18,000 ft MSL — may require FAA coordination under 14 CFR Part 101.');
  }
  if (apogee_ft > 60000) {
    warnings.push('Launch above 60,000 ft — requires FAA launch license (14 CFR Part 450).');
  }

  return {
    hazardRadius_m,
    hazardRadius_ft:         hazardRadius_m * M_TO_FT,
    optimalAngle_deg:        20,
    maxApogee_m:             apogee_m,
    maxApogee_ft:            apogee_ft,
    motorClass:              '?',
    totalImpulse_Ns:         0,
    quarterAltitudeRule_m:   quarterRule_m,
    quarterRuleConservative: quarterRule_m >= hazardRadius_m,
    trajectories,
    warnings,
    tier1DescentRange_m:     descentRange_m,
    tier1AscentOffset_m:     maxAscentOffset_m,
    cdEffective:             0.60 * buildQuality,
  };
}
