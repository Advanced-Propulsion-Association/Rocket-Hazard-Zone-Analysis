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
 * Piecewise model calibrated to match RASAero II outputs for typical rockets.
 *
 *  M < 0.8   : subsonic baseline
 *  0.8–1.0   : transonic wave-drag rise (quadratic)
 *  1.0–1.2   : peak and linear decline
 *  M > 1.2   : supersonic ~1/M falloff
 */
export function cdMachCorrection(cdSubsonic: number, mach: number): number {
  if (mach < 0.8) return cdSubsonic;
  if (mach < 1.0) {
    const t = (mach - 0.8) / 0.2;
    return cdSubsonic * (1.0 + 1.1 * t * t);
  }
  if (mach < 1.2) {
    const t = (mach - 1.0) / 0.2;
    return cdSubsonic * (2.1 - 0.4 * t);
  }
  // Supersonic: continuous at M=1.2
  const cdAt12 = cdSubsonic * (2.1 - 0.4);
  return cdAt12 * (1.2 / mach);
}

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
