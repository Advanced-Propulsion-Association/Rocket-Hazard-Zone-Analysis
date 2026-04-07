/**
 * 6-DOF RK4 trajectory integrator for hobby rockets.
 *
 * 13-state vector: [x, y, z, vx, vy, vz, phi, theta, psi, p, q, r, mass]
 * Body-frame Euler equations with symmetric rocket (Izz = Iyy).
 */

import type { Config6DOF, State6DOF, TrajectoryPoint6DOF } from '../types';
import { airDensity, speedOfSound, isaTemperatureOffset, windAtAltitude } from './atmosphere';
import { cdMachCorrection } from './aerodynamics';
import { thrustAt, burnTime } from './motor';

const G0 = 9.80665; // m/s²
const STATE_LEN = 13;

// ── helpers ──────────────────────────────────────────────────────────────────

type StateVec = number[]; // length 13

function stateToVec(s: State6DOF): StateVec {
  return [s.x, s.y, s.z, s.vx, s.vy, s.vz, s.phi, s.theta, s.psi, s.p, s.q, s.r, s.mass];
}

function vecToState(v: StateVec): State6DOF {
  return { x: v[0], y: v[1], z: v[2], vx: v[3], vy: v[4], vz: v[5],
           phi: v[6], theta: v[7], psi: v[8], p: v[9], q: v[10], r: v[11], mass: v[12] };
}

function vecAdd(a: StateVec, b: StateVec): StateVec {
  const r = new Array(STATE_LEN);
  for (let i = 0; i < STATE_LEN; i++) r[i] = a[i] + b[i];
  return r;
}

function vecScale(a: StateVec, s: number): StateVec {
  const r = new Array(STATE_LEN);
  for (let i = 0; i < STATE_LEN; i++) r[i] = a[i] * s;
  return r;
}

// ── derivatives ──────────────────────────────────────────────────────────────

interface DerivContext {
  tOffset: number;    // ISA temperature offset
  windX: number;
  windY: number;
  Ixx: number;
  Iyy: number;
  cpMinusCg: number;  // CP_m - CG_m (positive = statically stable)
  refArea: number;    // reference area (m²)
  refLen: number;     // reference length (body diameter, m)
  cdBase: number;
  CNalpha: number;
  Cmq: number;
  Cnr: number;
  Clp: number;
  motor: Config6DOF['motor'];
  burnEnd: number;
  propMass: number;
  launchAlt: number;
}

/**
 * Compute derivative of state vector at time t.
 * Returns [dx, dy, dz, dvx, dvy, dvz, dphi, dtheta, dpsi, dp, dq, dr, dmass]
 * and also the telemetry values (alpha, mach, thrust, drag) as a side channel.
 */
function deriv(
  sv: StateVec,
  t: number,
  ctx: DerivContext,
): { ddt: StateVec; alpha: number; mach: number; thrustMag: number; dragMag: number } {
  const [_x, _y, z, vx, vy, vz, phi, theta, psi, p, q, r, mass] = sv;

  const alt = Math.max(z + ctx.launchAlt, 0);

  // --- atmosphere ---
  const rho = airDensity(alt, ctx.tOffset);
  const a = speedOfSound(alt, ctx.tOffset);

  // --- wind (power-law profile) ---
  const wScale = windAtAltitude(1, Math.max(z, 0)); // multiplier at altitude
  const wx = ctx.windX * wScale;
  const wy = ctx.windY * wScale;

  // --- airspeed (inertial - wind) ---
  const vax = vx - wx;
  const vay = vy - wy;
  const vaz = vz; // no vertical wind
  const Va = Math.sqrt(vax * vax + vay * vay + vaz * vaz);
  const mach = a > 0 ? Va / a : 0;

  // --- body axis unit vector (nose direction) ---
  const ct = Math.cos(theta);
  const st = Math.sin(theta);
  const cp = Math.cos(phi);
  const sp = Math.sin(phi);
  const cpsi = Math.cos(psi);
  const spsi = Math.sin(psi);

  // Body x-axis in inertial frame (nose direction).
  // Convention: theta=0 → nose up (+z), psi rotates in x-y plane.
  const bx_i = st * cpsi;
  const by_i = st * spsi;
  const bz_i = ct;

  // --- angle of attack ---
  let alpha = 0;
  let alphaEff = 0; // clamped for aero force computation
  if (Va > 0.1) {
    // component of airspeed along body axis
    const vaBody = vax * bx_i + vay * by_i + vaz * bz_i;
    const cosAlpha = Math.max(-1, Math.min(1, vaBody / Va));
    alpha = Math.acos(cosAlpha);
    // Linear CNalpha model valid only for small alpha. Beyond ~15 deg the rocket
    // is in post-stall / tumble regime. Clamp to prevent numerical blow-up.
    alphaEff = Math.min(alpha, 0.25); // ~14 deg
  }

  // --- thrust ---
  let thrustMag = 0;
  let mdot = 0;
  if (t <= ctx.burnEnd && ctx.burnEnd > 0) {
    thrustMag = thrustAt(ctx.motor, t);
    if (ctx.burnEnd > 0 && ctx.propMass > 0) {
      mdot = -ctx.propMass / ctx.burnEnd; // constant mass flow approximation
    }
  }

  // Thrust acts along body axis
  const Tx = thrustMag * bx_i;
  const Ty = thrustMag * by_i;
  const Tz = thrustMag * bz_i;

  // --- drag ---
  const cd = cdMachCorrection(ctx.cdBase, mach);
  const qBar = 0.5 * rho * Va * Va;
  const dragMag = qBar * ctx.refArea * cd;

  // Drag opposes airspeed
  let Dx = 0, Dy = 0, Dz = 0;
  if (Va > 0.1) {
    Dx = -dragMag * vax / Va;
    Dy = -dragMag * vay / Va;
    Dz = -dragMag * vaz / Va;
  }

  // --- normal (lift) force from angle of attack ---
  const Fnormal = qBar * ctx.refArea * ctx.CNalpha * alphaEff;

  // Hoist perpendicular airspeed so both the force and moment sections can use it.
  let vaPerpX = 0, vaPerpY = 0, vaPerpZ = 0, vaPerpMag = 0;
  let Nx = 0, Ny = 0, Nz = 0;
  if (Va > 0.1 && alphaEff > 1e-6) {
    // Airspeed component perpendicular to body axis
    const vaPar = vax * bx_i + vay * by_i + vaz * bz_i;
    vaPerpX = vax - vaPar * bx_i;
    vaPerpY = vay - vaPar * by_i;
    vaPerpZ = vaz - vaPar * bz_i;
    vaPerpMag = Math.sqrt(vaPerpX * vaPerpX + vaPerpY * vaPerpY + vaPerpZ * vaPerpZ);
    if (vaPerpMag > 1e-6) {
      // Normal force is perpendicular to body axis, opposing the cross-flow (into the wind).
      // Acts in the -vaPerpDir direction: pushes the rocket body toward the airspeed vector.
      Nx = -Fnormal * vaPerpX / vaPerpMag;
      Ny = -Fnormal * vaPerpY / vaPerpMag;
      Nz = -Fnormal * vaPerpZ / vaPerpMag;
    }
  }

  // --- translational acceleration ---
  const m = Math.max(mass, 0.01);
  const dvx = (Tx + Dx + Nx) / m;
  const dvy = (Ty + Dy + Ny) / m;
  const dvz = (Tz + Dz + Nz) / m - G0;

  // --- moments (body frame) ---
  // Restoring moment from CP-CG offset.
  // The moment vector = r_{CG→CP} × F_N = (-momentArm * nose_dir) × (Fnormal * vaPerpDir)
  //                   = -momentArm * Fnormal * (nose_dir × vaPerpDir)
  // Project onto body pitch axis (body-y) and body yaw axis (body-z) for Mm and Nm.
  //
  // Body axes in inertial frame (ZYX convention with theta from vertical):
  //   body-x (nose): (st*cpsi, st*spsi, ct)              — already computed as bx_i, by_i, bz_i
  //   body-y (pitch axis, phi=0): (-spsi, cpsi, 0)
  //   body-z (yaw axis, phi=0):   (-ct*cpsi, -ct*spsi, st)
  //   With roll phi: bodyY = cp*by0 - sp*bz0,  bodyZ = sp*by0 + cp*bz0
  let Mm = 0; // pitch moment
  let Nm = 0; // yaw moment
  if (Va > 0.1 && alphaEff > 1e-6 && vaPerpMag > 1e-6) {
    const momentArm = ctx.cpMinusCg; // positive when CP behind CG (stable)

    // Body pitch and yaw axes in inertial frame (accounting for roll phi)
    const by0x = -spsi,          by0y = cpsi,          by0z = 0;
    const bz0x = -ct * cpsi,     bz0y = -ct * spsi,    bz0z = st;
    const bodyYx = cp * by0x - sp * bz0x;
    const bodyYy = cp * by0y - sp * bz0y;
    const bodyYz = cp * by0z - sp * bz0z;
    const bodyZx = sp * by0x + cp * bz0x;
    const bodyZy = sp * by0y + cp * bz0y;
    const bodyZz = sp * by0z + cp * bz0z;

    // Cross product: nose_dir × vaPerpDir_hat
    const ph = vaPerpX / vaPerpMag;
    const qh = vaPerpY / vaPerpMag;
    const rh = vaPerpZ / vaPerpMag;
    const crossX = by_i * rh - bz_i * qh;
    const crossY = bz_i * ph - bx_i * rh;
    const crossZ = bx_i * qh - by_i * ph;

    // Moment = r_{CG→CP} × F_N = (-momentArm * noseDir) × (-Fnormal * vaPerpDir_hat)
    //        = momentArm * Fnormal * (noseDir × vaPerpDir_hat)
    // Positive for stable rocket (CP aft) gives restoring (negative dq when nose up).
    const scale = momentArm * Fnormal;
    Mm = scale * (crossX * bodyYx + crossY * bodyYy + crossZ * bodyYz);
    Nm = scale * (crossX * bodyZx + crossY * bodyZy + crossZ * bodyZz);
  }

  // Damping moments
  const dampQ = ctx.Cmq * qBar * ctx.refArea * ctx.refLen * ctx.refLen * q / (2 * (Va > 0.1 ? Va : 0.1));
  const dampR = ctx.Cnr * qBar * ctx.refArea * ctx.refLen * ctx.refLen * r / (2 * (Va > 0.1 ? Va : 0.1));
  const dampP = ctx.Clp * qBar * ctx.refArea * ctx.refLen * ctx.refLen * p / (2 * (Va > 0.1 ? Va : 0.1));

  Mm += dampQ;
  Nm += dampR;
  const Lm = dampP; // roll moment (no aerodynamic roll excitation for symmetric rocket)

  // --- Euler equations (body frame, symmetric: Izz = Iyy) ---
  // Standard form: Iyy*q_dot = Mm + (Izz-Ixx)*r*p = Mm + (Iyy-Ixx)*r*p
  //               Izz*r_dot = Nm + (Ixx-Iyy)*p*q = Nm - (Iyy-Ixx)*p*q
  const dp = Lm / ctx.Ixx;
  const dq = (Mm + (ctx.Iyy - ctx.Ixx) * p * r) / ctx.Iyy;
  const dr = (Nm - (ctx.Iyy - ctx.Ixx) * p * q) / ctx.Iyy;

  // --- kinematic equations ---
  const cosTheta = Math.cos(theta);
  const cosThetaGuard = Math.abs(cosTheta) < 0.01 ? Math.sign(cosTheta || 1) * 0.01 : cosTheta;
  // Guard tanTheta against gimbal lock singularity at theta = ±90°
  const tanTheta = Math.sin(theta) / cosThetaGuard;

  const dphi = p + (q * sp + r * cp) * tanTheta;
  const dtheta = q * cp - r * sp;
  const dpsi = (q * sp + r * cp) / cosThetaGuard;

  const ddt: StateVec = [vx, vy, vz, dvx, dvy, dvz, dphi, dtheta, dpsi, dp, dq, dr, mdot];
  return { ddt, alpha, mach, thrustMag, dragMag };
}

// ── RK4 step ─────────────────────────────────────────────────────────────────

function rk4Step(
  sv: StateVec,
  t: number,
  dt: number,
  ctx: DerivContext,
): { next: StateVec; alpha: number; mach: number; thrust: number; drag: number } {
  const { ddt: k1, alpha, mach, thrustMag, dragMag } = deriv(sv, t, ctx);
  const { ddt: k2 } = deriv(vecAdd(sv, vecScale(k1, dt / 2)), t + dt / 2, ctx);
  const { ddt: k3 } = deriv(vecAdd(sv, vecScale(k2, dt / 2)), t + dt / 2, ctx);
  const { ddt: k4 } = deriv(vecAdd(sv, vecScale(k3, dt)), t + dt, ctx);

  // weighted sum: sv + dt/6 * (k1 + 2*k2 + 2*k3 + k4)
  const combined = vecAdd(k1, vecAdd(vecScale(k2, 2), vecAdd(vecScale(k3, 2), k4)));
  const next = vecAdd(sv, vecScale(combined, dt / 6));

  return { next, alpha, mach, thrust: thrustMag, drag: dragMag };
}

// ── main entry point ─────────────────────────────────────────────────────────

export function simulate6DOF(cfg: Config6DOF & { initialZ_m?: number }): TrajectoryPoint6DOF[] {
  const motor = cfg.motor;
  const bt = burnTime(motor);
  const tOffset = isaTemperatureOffset(cfg.launchAltitude_m, cfg.siteTemp_K);

  // Wind decomposition
  const windX = cfg.windSpeed_ms * Math.cos(cfg.windDirection_rad);
  const windY = cfg.windSpeed_ms * Math.sin(cfg.windDirection_rad);

  // Launch geometry
  const launchAzRad = cfg.launchAzimuth_deg * Math.PI / 180;

  // Initial attitude: theta = angle from vertical, psi = azimuth
  const theta0 = cfg.launchAngle_rad; // already radians, from vertical
  const psi0 = launchAzRad;

  const refArea = Math.PI * (cfg.bodyDiameter_m / 2) ** 2;

  const ctx: DerivContext = {
    tOffset,
    windX,
    windY,
    Ixx: cfg.Ixx_kgm2,
    Iyy: cfg.Iyy_kgm2,
    cpMinusCg: cfg.CP_m - cfg.CG_m,
    refArea,
    refLen: cfg.bodyDiameter_m,
    cdBase: cfg.CD,
    CNalpha: cfg.CNalpha,
    Cmq: cfg.Cmq,
    Cnr: cfg.Cnr,
    Clp: cfg.Clp,
    motor,
    burnEnd: bt,
    propMass: motor.propellantMassKg,
    launchAlt: cfg.launchAltitude_m,
  };

  // Initial state
  const z0 = cfg.initialZ_m ?? 0;
  const initState: State6DOF = {
    x: 0, y: 0, z: z0,
    vx: 0, vy: 0, vz: 0,
    phi: 0, theta: theta0, psi: psi0,
    p: cfg.initialRollRate_rads,
    q: cfg.initialQ_rads ?? 0,
    r: 0,
    mass: cfg.totalMass_kg,
  };

  let sv = stateToVec(initState);
  let t = 0;
  const points: TrajectoryPoint6DOF[] = [];
  let maxZ = z0;
  let hasBeenHigh = z0 > 5;

  const MAX_T = 600; // safety bail
  const RECORD_INTERVAL = 0.05; // record every 50ms
  let nextRecord = 0;

  // Record initial point
  const { alpha: a0, mach: m0, thrustMag: th0, dragMag: d0 } = deriv(sv, t, ctx);
  points.push({ t, state: vecToState(sv), alpha: a0, mach: m0, thrust: th0, drag: d0 });
  nextRecord = RECORD_INTERVAL;

  while (t < MAX_T) {
    // Adaptive timestep: finer during burn
    const dt = t < bt ? 0.01 : 0.05;

    const { next, alpha, mach, thrust, drag } = rk4Step(sv, t, dt, ctx);
    sv = next;
    t += dt;

    // Clamp altitude and mass
    if (sv[12] < cfg.totalMass_kg - ctx.propMass) {
      sv[12] = cfg.totalMass_kg - ctx.propMass;
    }

    const z = sv[2];
    if (z > maxZ) maxZ = z;
    if (z > 5) hasBeenHigh = true;

    // Record at intervals
    if (t >= nextRecord) {
      points.push({ t, state: vecToState(sv), alpha, mach, thrust, drag });
      nextRecord += RECORD_INTERVAL;
    }

    // Termination: ground impact after reaching altitude
    if (hasBeenHigh && z < -1.0) break;

    // Timeout: never rose significantly
    if (!hasBeenHigh && t > 30) break;
  }

  // Record final point if not already recorded
  if (points.length === 0 || Math.abs(points[points.length - 1].t - t) > 0.001) {
    const { alpha: af, mach: mf, thrustMag: thf, dragMag: df } = deriv(sv, t, ctx);
    points.push({ t, state: vecToState(sv), alpha: af, mach: mf, thrust: thf, drag: df });
  }

  return points;
}
