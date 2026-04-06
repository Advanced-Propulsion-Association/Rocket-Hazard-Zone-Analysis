import { describe, it, expect } from 'vitest';
import { runMonteCarlo, hazardRadiusFromPoints } from '../src/simulation/montecarlo';
import type { Config6DOF, Motor, ScatterPoint } from '../src/types';

const zeroMotor: Motor = {
  name: 'none', diameterMm: 0, lengthMm: 0,
  propellantMassKg: 0, totalMassKg: 1.5,
  manufacturer: '', thrustCurve: [],
};

const cfg: Config6DOF = {
  bodyDiameter_m: 0.064,
  bodyLength_m: 1.2,
  noseConeLength_m: 0.25,
  finRootChord_m: 0.10,
  finTipChord_m: 0.05,
  finSpan_m: 0.08,
  finSweepAngle_rad: 0,
  numFins: 3,
  totalMass_kg: 1.5,
  motor: zeroMotor,
  Ixx_kgm2: 0.002,
  Iyy_kgm2: 0.18,
  CNalpha: 8.0,
  CP_m: 0.85,
  CG_m: 0.60,
  CD: 0.4,
  Cmq: -20,
  Cnr: -20,
  Clp: -0.5,
  thrustCurve: [],
  propellantMass_kg: 0,
  launchAltitude_m: 0,
  launchAngle_rad: 0,
  windSpeed_ms: 0,
  windDirection_rad: 0,
  launchAzimuth_deg: 0,
  siteTemp_K: 288.15,
  initialRollRate_rads: 0,
};

describe('runMonteCarlo', () => {
  it('returns exactly N scatter points', () => {
    const result = runMonteCarlo(cfg, 10, () => {});
    expect(result.scatter.length).toBe(10);
  });

  it('with zero variance, all points are within 1m of each other', () => {
    const result = runMonteCarlo(cfg, 5, () => {}, { windVariance: 0, angleVariance: 0, impulseVariance: 0, pitchPerturbance: 0 });
    const xs = result.scatter.map(p => p.x);
    const ys = result.scatter.map(p => p.y);
    const xRange = Math.max(...xs) - Math.min(...xs);
    const yRange = Math.max(...ys) - Math.min(...ys);
    expect(xRange).toBeLessThan(1);
    expect(yRange).toBeLessThan(1);
  });
});

describe('hazardRadiusFromPoints', () => {
  it('hazard radius is max distance from origin', () => {
    const points: ScatterPoint[] = [
      { x: 100, y: 0, runIndex: 0 },
      { x: 0, y: 200, runIndex: 1 },
      { x: -50, y: -50, runIndex: 2 },
    ];
    const r = hazardRadiusFromPoints(points);
    expect(r).toBeCloseTo(200, 0);
  });
});
