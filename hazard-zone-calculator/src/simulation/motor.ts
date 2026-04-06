import type { Motor, ThrustPoint } from '../types';

/** Linear interpolation of thrust at time t. Returns 0 outside motor burn. */
export function thrustAt(motor: Motor, t: number): number {
  const curve = motor.thrustCurve;
  if (curve.length === 0) return 0;
  if (t < curve[0].time || t > curve[curve.length - 1].time) return 0;

  // Binary search for interval
  let lo = 0, hi = curve.length - 1;
  while (lo < hi - 1) {
    const mid = (lo + hi) >> 1;
    if (curve[mid].time <= t) lo = mid; else hi = mid;
  }
  const t0 = curve[lo].time, t1 = curve[hi].time;
  const frac = t1 === t0 ? 0 : (t - t0) / (t1 - t0);
  return curve[lo].thrust + frac * (curve[hi].thrust - curve[lo].thrust);
}

/** Altitude-corrected thrust: T(h) = T_SL(t) + (P_SL - P(h)) * A_nozzle */
export function thrustCorrected(motor: Motor, t: number, _alt_m: number, pressureAtAlt: number): number {
  const T_sl = thrustAt(motor, t);
  if (motor.nozzleExitAreaM2 && motor.nozzleExitAreaM2 > 0) {
    const P_SL = 101325;
    return T_sl + (P_SL - pressureAtAlt) * motor.nozzleExitAreaM2;
  }
  return T_sl;
}

export function totalImpulse(motor: Motor): number {
  const c = motor.thrustCurve;
  let I = 0;
  for (let i = 1; i < c.length; i++) {
    I += 0.5 * (c[i].thrust + c[i - 1].thrust) * (c[i].time - c[i - 1].time);
  }
  return I;
}

export function burnTime(motor: Motor): number {
  const c = motor.thrustCurve;
  return c.length > 0 ? c[c.length - 1].time : 0;
}

/** Parse RASP .eng file text into a Motor object. */
export function parseRaspEng(engText: string): Motor {
  const lines = engText
    .split('\n')
    .map(l => l.trim())
    .filter(l => l && !l.startsWith(';'));

  const headerParts = lines[0].split(/\s+/);
  const name = headerParts[0];
  const diameterMm = parseFloat(headerParts[1]);
  const lengthMm = parseFloat(headerParts[2]);
  // headerParts[3] = delays (ignored)
  const propellantMassKg = parseFloat(headerParts[4]);
  const totalMassKg = parseFloat(headerParts[5]);
  const manufacturer = headerParts[6] ?? 'Unknown';

  const thrustCurve: ThrustPoint[] = [];
  for (const line of lines.slice(1)) {
    const parts = line.split(/\s+/);
    if (parts.length >= 2) {
      const time = parseFloat(parts[0]);
      const thrust = parseFloat(parts[1]);
      if (!isNaN(time) && !isNaN(thrust)) {
        thrustCurve.push({ time, thrust });
      }
    }
  }

  return { name, diameterMm, lengthMm, propellantMassKg, totalMassKg, manufacturer, thrustCurve };
}

/** Create a constant-thrust (boxcar) motor from average thrust + burn time. */
export function makeBoxcarMotor(
  avgThrust_N: number,
  burnTime_s: number,
  propellantMass_kg: number,
  totalMass_kg: number,
  name = 'Custom',
): Motor {
  const curve: ThrustPoint[] = [
    { time: 0, thrust: avgThrust_N },
    { time: burnTime_s - 0.001, thrust: avgThrust_N },
    { time: burnTime_s, thrust: 0 },
  ];
  return {
    name,
    diameterMm: 0,
    lengthMm: 0,
    propellantMassKg: propellantMass_kg,
    totalMassKg: totalMass_kg,
    manufacturer: 'Custom',
    thrustCurve: curve,
  };
}
