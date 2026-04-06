/**
 * Moment of inertia estimation for hobby rockets.
 *
 * Uses a uniform-density solid cylinder approximation. This is conservative:
 * real rockets with heavy motors aft have higher Iyy than this estimate,
 * which increases stability — so the approximation is slightly pessimistic.
 */

export interface MOIInputs {
  totalMass_kg: number;
  bodyDiameter_m: number;
  totalLength_m: number;
}

export interface MOIResult {
  Ixx: number;   // axial (roll) MOI in kg·m²
  Iyy: number;   // transverse (pitch/yaw) MOI in kg·m²
}

/**
 * Solid cylinder MOI approximation.
 *   Ixx = 0.5 * m * R²           (spin about long axis)
 *   Iyy = m * (3R² + L²) / 12   (spin about transverse axis through CG)
 */
export function estimateMOI(inputs: MOIInputs): MOIResult {
  const { totalMass_kg: m, bodyDiameter_m, totalLength_m: L } = inputs;
  const R = bodyDiameter_m / 2;
  return {
    Ixx: 0.5 * m * R * R,
    Iyy: m * (3 * R * R + L * L) / 12,
  };
}

/**
 * Estimate pitch/yaw damping coefficient Cmq (= Cnr for symmetric rocket).
 * Empirical approximation: Cmq ≈ -2 * CNα * (L/2) / d
 */
export function estimateCmq(CNalpha: number, bodyLength_m: number, bodyDiameter_m: number): number {
  return -2 * CNalpha * (bodyLength_m / 2) / bodyDiameter_m;
}

/**
 * Estimate roll damping coefficient Clp.
 * Simplified to -0.5 (typical for 3–4 fin hobby rocket).
 */
export function estimateClp(): number {
  return -0.5;
}
