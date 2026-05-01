/**
 * Barrowman component drag buildup for amateur rockets.
 *
 * Computes the subsonic base drag coefficient (referenced to max body cross-section)
 * from first-principles component contributions:
 *   - Skin friction (Prandtl turbulent flat plate, Cf ≈ 0.005 at Re ~2×10^6)
 *   - Base (nozzle wake) drag — Hoerner empirical correlation
 *   - Fin skin friction + interference drag at the fin-body junction
 *   - Nose cone pressure drag (conical only; ogive/haack ≈ 0 subsonic)
 *
 * Mach correction is applied separately via cdMachCorrection() in aerodynamics.ts.
 * Build quality multiplier is applied by the caller after this function returns.
 *
 * All inputs are in inches. Conversions to SI happen internally.
 */

const IN_TO_M = 0.0254;

export interface BarrowmanDragInput {
  noseConeType: 'ogive' | 'conical' | 'parabolic' | 'haack';
  noseLength_in: number;
  bodyDiameter_in: number;
  bodyLength_in: number;   // total rocket length including nose (nose tip to nozzle exit)
  finRootChord_in: number;
  finTipChord_in: number;
  finSpan_in: number;
  numFins: number;
  // fin thickness ratio t/c — not a user input, defaults to 0.05 (typical plywood/fiberglass)
  totalImpulse_Ns?: number;  // from motor; used for Re-based Cf scaling
  totalMass_kg?: number;     // total launch mass (airframe + motor); used for Re-based Cf scaling
}

export interface BarrowmanDragBreakdown {
  CD_friction: number;
  CD_base: number;
  CD_fins: number;
  CD_nose_pressure: number;
  CD_parasitic: number;
  CD_total: number;
}

export function barrowmanDragBreakdown(input: BarrowmanDragInput): BarrowmanDragBreakdown {
  // Re-based skin friction: reduces Cf at high Reynolds numbers (large N/O-class rockets)
  const v_ref_ms = (input.totalImpulse_Ns != null && input.totalImpulse_Ns > 0
                 && input.totalMass_kg    != null && input.totalMass_kg    > 0)
    ? input.totalImpulse_Ns / (input.totalMass_kg * 2.0)
    : 250;
  const Re_L = v_ref_ms * (input.bodyLength_in * IN_TO_M) / 1.5e-5;
  const CF   = Math.max(0.004, 0.005 * Math.pow(3e7 / Math.max(Re_L, 3e7), 0.15));
  /** Parasitic drag: launch lugs, surface roughness, body joints (conservative constant). */
  const CD_parasitic = 0.02;

  const D = input.bodyDiameter_in * IN_TO_M;
  const R = D / 2;
  const A_ref = Math.PI * R * R;

  if (A_ref <= 0 || D <= 0) {
    return { CD_friction: 0.35, CD_base: 0.05, CD_fins: 0, CD_nose_pressure: 0, CD_parasitic, CD_total: 0.35 + 0.05 + CD_parasitic };
  }

  const L_n = input.noseLength_in * IN_TO_M;
  // Body tube length = total - nose (floor at 0)
  const L_b = Math.max(0, input.bodyLength_in * IN_TO_M - L_n);

  // ── Nose cone wetted area ─────────────────────────────────────────────────
  // Slant surface of a cone with half-angle = atan(R / L_n)
  // For ogive/parabolic/haack the actual surface is ~3–5% more; close enough.
  const A_wet_nose = L_n > 0
    ? Math.PI * R * Math.sqrt(L_n * L_n + R * R)
    : 0;

  // ── Nose cone pressure drag (subsonic) ───────────────────────────────────
  // Only conical noses have meaningful pressure drag (no smooth pressure recovery).
  // Ogive and Von Karman (Haack) have ~0 subsonic pressure drag.
  let CD_nose_pressure = 0;
  if (input.noseConeType === 'conical' && L_n > 0) {
    const half_angle = Math.atan(R / L_n);
    CD_nose_pressure = Math.min(2 * Math.sin(half_angle) ** 2, 0.05);
  } else if (input.noseConeType === 'parabolic') {
    CD_nose_pressure = 0.01; // slight blunt-tip correction
  }

  // ── Body tube wetted area ─────────────────────────────────────────────────
  const A_wet_body = Math.PI * D * L_b;

  // ── Total skin friction drag ──────────────────────────────────────────────
  const CD_friction = CF * (A_wet_nose + A_wet_body) / A_ref;

  // ── Base drag (Hoerner empirical) ─────────────────────────────────────────
  // CD_base ≈ 0.029 / sqrt(CD_friction_body) — valid for slender bodies
  const CD_friction_body = CF * A_wet_body / A_ref;
  const CD_base = CD_friction_body > 0
    ? 0.029 / Math.sqrt(CD_friction_body)
    : 0.08; // fallback for zero-length body (unusual)

  // ── Fin drag ──────────────────────────────────────────────────────────────
  // Both exposed surfaces × all fins × leading/trailing edge thickness correction
  // × 1.1 interference factor at the fin-body junction (Hoerner)
  const t_over_c = 0.05; // 5% thickness ratio — typical plywood/fiberglass fin
  let CD_fins = 0;
  if (input.numFins > 0 && input.finRootChord_in > 0 && input.finSpan_in > 0) {
    const c_root = input.finRootChord_in * IN_TO_M;
    const c_tip  = input.finTipChord_in  * IN_TO_M;
    const span   = input.finSpan_in      * IN_TO_M;
    const A_fin  = 0.5 * (c_root + c_tip) * span; // trapezoidal planform area (one fin)
    CD_fins = input.numFins * (2 * A_fin / A_ref) * CF * (1 + 2 * t_over_c) * 1.1;
  }

  const CD_total = CD_friction + CD_nose_pressure + CD_base + CD_fins + CD_parasitic;

  return { CD_friction, CD_base, CD_fins, CD_nose_pressure, CD_parasitic, CD_total };
}

/** Convenience wrapper — returns just the total CD. */
export function barrowmanCD(input: BarrowmanDragInput): number {
  return barrowmanDragBreakdown(input).CD_total;
}

/**
 * Absolute wave drag CD increment for a tangent ogive nose,
 * referenced to the body cross-section (A_nose/A_ref = 1.0 for tangent ogive).
 *
 * Onset at M=0.85, linear Prandtl-Glauert rise to peak 0.025 at M=1.05,
 * transonic plateau to M=1.20, then 1/M Ackeret decay.
 *
 * Source: aerodynamics_reference.md §12.1
 */
export function ogiveWaveDragCD(mach: number): number {
  if (mach < 0.85) return 0;
  if (mach < 1.05) return 0.025 * (mach - 0.85) / 0.20;
  if (mach < 1.20) return 0.025;
  return 0.025 * 1.20 / mach;
}
