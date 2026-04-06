import { describe, it, expect } from 'vitest';
import { computeCNAlpha, computeCPFromNose } from '../src/simulation/barrowman';

describe('computeCNAlpha', () => {
  it('returns nose contribution of 2.0 with no fins', () => {
    const result = computeCNAlpha({
      bodyDiameter_m: 0.064,
      noseLength_m: 0.25,
      noseConeType: 'ogive',
      finRootChord_m: 0,
      finTipChord_m: 0,
      finSpan_m: 0,
      numFins: 0,
    });
    expect(result).toBeCloseTo(2.0, 1);
  });

  it('increases CNα with larger fins', () => {
    const base = computeCNAlpha({
      bodyDiameter_m: 0.064,
      noseLength_m: 0.25,
      noseConeType: 'ogive',
      finRootChord_m: 0.10,
      finTipChord_m: 0.05,
      finSpan_m: 0.08,
      numFins: 3,
    });
    const bigger = computeCNAlpha({
      bodyDiameter_m: 0.064,
      noseLength_m: 0.25,
      noseConeType: 'ogive',
      finRootChord_m: 0.15,
      finTipChord_m: 0.07,
      finSpan_m: 0.12,
      numFins: 3,
    });
    expect(bigger).toBeGreaterThan(base);
  });

  it('4-fin rocket has higher CNα than 3-fin with same fin geometry', () => {
    const config = {
      bodyDiameter_m: 0.064,
      noseLength_m: 0.25,
      noseConeType: 'ogive' as const,
      finRootChord_m: 0.10,
      finTipChord_m: 0.05,
      finSpan_m: 0.08,
    };
    const cn3 = computeCNAlpha({ ...config, numFins: 3 });
    const cn4 = computeCNAlpha({ ...config, numFins: 4 });
    expect(cn4).toBeGreaterThan(cn3);
  });
});

describe('computeCPFromNose', () => {
  it('CP is aft of nose for a stable configuration', () => {
    const cp = computeCPFromNose({
      bodyDiameter_m: 0.064,
      noseLength_m: 0.25,
      bodyLength_m: 1.0,
      noseConeType: 'ogive',
      finRootChord_m: 0.10,
      finTipChord_m: 0.05,
      finSpan_m: 0.08,
      numFins: 3,
    });
    // CP should be somewhere in the aft half of the rocket
    expect(cp).toBeGreaterThan(0.5);
    expect(cp).toBeLessThan(1.0);
  });
});
