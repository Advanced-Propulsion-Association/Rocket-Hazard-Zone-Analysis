import { ogiveWaveDragCD } from './barrowmanDrag';

/**
 * Drag coefficient model for amateur rockets.
 *
 * For a conservative hazard zone (max range), we use the MINIMUM plausible CD:
 * - Lower CD → less deceleration → higher apogee & longer ballistic range
 * - The 3-DOF nose-forward assumption is already conservative vs 6-DOF tumbling
 *
 * CD from fineness ratio (L/D) — empirical fit from OpenRocket/RASAero data.
 * Full geometry (Tier 3) uses Barrowman-based components.
 */

export function cdFromFineness(finessRatio: number): number {
  // fB = L/D.  Typical range 8–20, CD(subsonic) ≈ 0.35–0.40
  return 0.35 + 3.0 / (finessRatio * finessRatio);
}

/**
 * Mach-number correction applied on top of subsonic CD.
 * OR-calibrated model (session 8) matching OpenRocket behavior for ogive/haack noses.
 *
 * OR adds ~zero wave drag for tangent ogive (sinphi=0 bug #2998) and very little for
 * haack/Von Kármán noses. At supersonic speeds OR's Van Driest skin friction correction
 * reduces total CD below subsonic. Peak 1.20× at M=1.0, decaying to 0.71× at M=2.0.
 *
 *  M < 0.87  : subsonic baseline (drag rise onset matches OR ~M=0.85–0.90)
 *  0.87–1.0  : transonic rise (quadratic) → 1.20× at M=1.0
 *  1.0–1.3   : linear decline → 0.91× at M=1.3
 *  M > 1.3   : power-law decay; 0.84× at M=1.5, 0.71× at M=2.0
 *
 * Sources: aerodynamics_reference.md §12.1–12.4
 */
export function cdMachCorrection(cdSubsonic: number, mach: number): number {
  if (mach < 0.87) return cdSubsonic;
  if (mach < 1.0) {
    const t = (mach - 0.87) / 0.13;
    return cdSubsonic * (1.0 + 0.20 * t * t);  // 1.0→1.20 at M=1.0
  }
  if (mach < 1.3) {
    const t = (mach - 1.0) / 0.3;
    return cdSubsonic * (1.20 - 0.29 * t);      // 1.20→0.91 at M=1.3
  }
  // Supersonic: power-law decay continuous at M=1.3; 0.91→0.84→0.71 at M=1.3→1.5→2.0
  return cdSubsonic * 1.055 * Math.pow(mach, -0.561);
}

/**
 * Mach correction for tangent ogive noses.
 * Uses absolute additive wave drag (not a multiplier) + Van Driest supersonic skin friction decay.
 */
export function cdMachCorrectionOgive(cdSubsonic: number, mach: number): number {
  const wave = ogiveWaveDragCD(mach);
  if (mach < 0.85) return cdSubsonic;
  if (mach <= 1.10) return cdSubsonic + wave;
  return cdSubsonic * 1.055 * Math.pow(mach, -0.561) + wave;
}

/**
 * Named CD profiles for the Tier 1 and Tier 2 dropdowns.
 * Lower CD = less drag = longer range = LARGER (more conservative) FAA hazard zone.
 */
export const CD_PROFILES = [
  { label: 'Streamlined — polished, optimized fins',  value: 0.35 },
  { label: 'Standard — typical build',           value: 0.50 },
  { label: 'Rough — rough finish, blocky fins',        value: 0.65 },
  { label: 'Unfinished — very rough, no optimization', value: 0.80 },
] as const;

export type CdProfile = typeof CD_PROFILES[number];

/** Motor class from total impulse (N·s). */
export function motorClass(totalImpulse_Ns: number): string {
  const classes: [number, string][] = [
    [2.5,'A'],[5,'B'],[10,'C'],[20,'D'],[40,'E'],[80,'F'],
    [160,'G'],[320,'H'],[640,'I'],[1280,'J'],[2560,'K'],
    [5120,'L'],[10240,'M'],[20480,'N'],[40960,'O'],
  ];
  for (const [limit, letter] of classes) {
    if (totalImpulse_Ns <= limit) return letter;
  }
  return 'O+';
}
