import { describe, it, expect } from 'vitest';
import { simulate6DOF } from '../src/simulation/trajectory6dof';
import type { Config6DOF, Motor } from '../src/types';

const zeroMotor: Motor = {
  name: 'none', diameterMm: 0, lengthMm: 0,
  propellantMassKg: 0, totalMassKg: 1.5,
  manufacturer: '', thrustCurve: [],
};

const baseConfig: Config6DOF = {
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

describe('simulate6DOF', () => {
  it('a dropped rocket falls and lands', () => {
    const pts = simulate6DOF({ ...baseConfig, initialZ_m: 100 });
    const last = pts[pts.length - 1];
    expect(last.state.z).toBeLessThan(1.0);
    expect(last.t).toBeGreaterThan(1.0);
  });

  it('without wind or tilt, rocket lands near launch pad', () => {
    const pts = simulate6DOF({
      ...baseConfig,
      initialZ_m: 500,
      windSpeed_ms: 0,
      launchAngle_rad: 0,
    });
    const last = pts[pts.length - 1];
    const range = Math.sqrt(last.state.x ** 2 + last.state.y ** 2);
    expect(range).toBeLessThan(50);
  });

  it('returns at least one trajectory point', () => {
    const pts = simulate6DOF({ ...baseConfig, initialZ_m: 50 });
    expect(pts.length).toBeGreaterThan(0);
  });

  it('altitude starts positive and ends near zero', () => {
    const pts = simulate6DOF({ ...baseConfig, initialZ_m: 200 });
    expect(pts[0].state.z).toBeGreaterThan(100);
    expect(pts[pts.length - 1].state.z).toBeLessThan(5);
  });
});
