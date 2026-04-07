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
 *
 * Derived from the fin contribution: the fins at distance (xFinCP - xCG) from
 * the CG experience an effective AoA of q*(xFinCP-xCG)/V due to pitch rate q.
 * The resulting moment: M_q = -CNα_fins * q̄S * (xFinCP-xCG)² * q/V
 * Compared to usage M = Cmq * q̄ * S * d² * q/(2V):
 *   Cmq = -2 * CNα_fins * ((xFinCP - xCG) / d)²
 *
 * Reference: Barrowman (1967) §3.3; Stevens & Lewis "Aircraft Flight Simulation".
 */
export function estimateCmq(
  CNalpha_fins: number,
  xFinCP_m: number,
  xCG_m: number,
  bodyDiameter_m: number,
): number {
  if (bodyDiameter_m <= 0) return 0;
  const leverArm = xFinCP_m - xCG_m;
  return -2 * CNalpha_fins * (leverArm / bodyDiameter_m) ** 2;
}

/**
 * Estimate roll damping coefficient Clp.
 * Simplified to -0.5 (typical for 3–4 fin hobby rocket).
 */
export function estimateClp(): number {
  return -0.5;
}
