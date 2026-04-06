/**
 * Barrowman aerodynamic coefficient calculator.
 *
 * Computes the normal force coefficient slope CNα and the center of pressure
 * location using the simplified Barrowman equations (1967).
 *
 * Reference: Barrowman, J.S., "The Practical Calculation of the Aerodynamic
 * Characteristics of Slender Finned Vehicles", MS Thesis, Catholic University, 1967.
 */

export interface BarrowmanInputs {
  bodyDiameter_m: number;
  noseLength_m: number;
  noseConeType: 'ogive' | 'conical' | 'parabolic' | 'haack';
  finRootChord_m: number;
  finTipChord_m: number;
  finSpan_m: number;
  numFins: number;
}

export interface BarrowmanInputsWithBody extends BarrowmanInputs {
  bodyLength_m: number;
}

/** Returns true if fin geometry is valid enough to compute a fin contribution. */
function hasValidFins(inputs: BarrowmanInputs): boolean {
  return (
    inputs.numFins > 0 &&
    inputs.finSpan_m > 0 &&
    inputs.finRootChord_m > 0 &&
    inputs.bodyDiameter_m > 0 &&
    inputs.finRootChord_m + inputs.finTipChord_m > 0
  );
}

/**
 * Combined fin CNα contribution (all fins, with body-fin interference).
 * Barrowman (1967): CNα_fins = Kfb * 4*N*(s/d)² / (1 + sqrt(1 + (2s/(cr+ct))²))
 */
function computeFinCNAlpha(inputs: BarrowmanInputs): number {
  const { bodyDiameter_m: d, finRootChord_m: cr, finTipChord_m: ct, finSpan_m: s, numFins: N } = inputs;
  const R = d / 2;
  const Kfb = 1 + R / (R + s);
  return Kfb * (4 * N * Math.pow(s / d, 2)) /
    (1 + Math.sqrt(1 + Math.pow((2 * s) / (cr + ct), 2)));
}

/**
 * Normal force coefficient slope (per radian).
 * CNα = CNα_nose + CNα_fins
 */
export function computeCNAlpha(inputs: BarrowmanInputs): number {
  // Nose contribution: slender body theory gives CNα = 2 for all nose shapes
  const CNalpha_nose = 2.0;
  if (!hasValidFins(inputs)) return CNalpha_nose;
  return CNalpha_nose + computeFinCNAlpha(inputs);
}

/**
 * Center of pressure location measured from nose tip (meters).
 *
 * Assumption: fins are base-flush (leading edge at bodyLength - rootChord).
 * Fins set forward of the base are not supported by this interface.
 */
export function computeCPFromNose(inputs: BarrowmanInputsWithBody): number {
  const { noseLength_m, bodyLength_m, finRootChord_m: cr, finTipChord_m: ct } = inputs;

  // Nose CP: at ~46% of nose length for ogive/parabolic, at 67% for conical
  const noseCPFraction = inputs.noseConeType === 'conical' ? 2 / 3 : 0.466;
  const xCP_nose = noseLength_m * noseCPFraction;
  const CNalpha_nose = 2.0;

  if (!hasValidFins(inputs)) return xCP_nose;

  const CNalpha_fins = computeFinCNAlpha(inputs);

  // Fin CP: centroid of fin planform measured from nose
  // Fin leading edge is at body length minus root chord (trailing edge at body end)
  const xFinLeadingEdge = bodyLength_m - cr;
  // Centroid of trapezoid along root chord: (cr + 2*ct)/(3*(cr+ct)) * cr
  const xCP_fins = xFinLeadingEdge + cr * (cr + 2 * ct) / (3 * (cr + ct));

  // Moment-balance average CP location
  const CNalpha_total = CNalpha_nose + CNalpha_fins;
  return (CNalpha_nose * xCP_nose + CNalpha_fins * xCP_fins) / CNalpha_total;
}
