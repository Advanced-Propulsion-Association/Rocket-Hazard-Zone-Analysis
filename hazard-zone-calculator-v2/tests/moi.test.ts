import { describe, it, expect } from 'vitest';
import { estimateMOI, estimateCmq, estimateClp } from '../src/simulation/moi';

describe('estimateMOI', () => {
  it('Ixx is less than Iyy for a long thin rocket', () => {
    const { Ixx, Iyy } = estimateMOI({
      totalMass_kg: 1.5,
      bodyDiameter_m: 0.064,
      totalLength_m: 1.2,
    });
    expect(Ixx).toBeLessThan(Iyy);
  });

  it('both MOI values are positive', () => {
    const { Ixx, Iyy } = estimateMOI({
      totalMass_kg: 2.0,
      bodyDiameter_m: 0.076,
      totalLength_m: 1.5,
    });
    expect(Ixx).toBeGreaterThan(0);
    expect(Iyy).toBeGreaterThan(0);
  });

  it('heavier rocket has proportionally larger MOI', () => {
    const light = estimateMOI({ totalMass_kg: 1.0, bodyDiameter_m: 0.064, totalLength_m: 1.0 });
    const heavy = estimateMOI({ totalMass_kg: 2.0, bodyDiameter_m: 0.064, totalLength_m: 1.0 });
    expect(heavy.Ixx / light.Ixx).toBeCloseTo(2.0, 2);
    expect(heavy.Iyy / light.Iyy).toBeCloseTo(2.0, 2);
  });
});

describe('estimateCmq', () => {
  it('is negative (damping)', () => {
    expect(estimateCmq(5.0, 1.0, 0.064)).toBeLessThan(0);
  });

  it('returns 0 for zero diameter (guard against divide-by-zero)', () => {
    expect(estimateCmq(5.0, 1.0, 0)).toBe(0);
  });

  it('larger CNalpha gives larger magnitude Cmq', () => {
    const cmq1 = estimateCmq(5.0, 1.0, 0.064);
    const cmq2 = estimateCmq(10.0, 1.0, 0.064);
    expect(Math.abs(cmq2)).toBeGreaterThan(Math.abs(cmq1));
  });
});

describe('estimateClp', () => {
  it('is negative (damping)', () => {
    expect(estimateClp()).toBeLessThan(0);
  });

  it('returns -0.5', () => {
    expect(estimateClp()).toBe(-0.5);
  });
});
