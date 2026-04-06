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

/**
 * Normal force coefficient slope (per radian).
 * CNα = CNα_nose + CNα_fins
 */
export function computeCNAlpha(inputs: BarrowmanInputs): number {
  const { bodyDiameter_m, finRootChord_m, finTipChord_m, finSpan_m, numFins } = inputs;
  const R = bodyDiameter_m / 2;
  const d = bodyDiameter_m;

  // Nose contribution: slender body theory gives CNα = 2 for all nose shapes
  const CNalpha_nose = 2.0;

  if (numFins === 0 || finSpan_m <= 0 || finRootChord_m <= 0) {
    return CNalpha_nose;
  }

  // Body-fin interference factor: accounts for body blocking fin root
  const Kfb = 1 + R / (R + finSpan_m);

  // Barrowman fin CNα (all fins combined), standard form:
  // CNα_fins = Kfb * 4*N*(s/d)^2 / (1 + sqrt(1 + (2*s/(cr+ct))^2))
  const CNalpha_fins =
    Kfb *
    (4 * numFins * Math.pow(finSpan_m / d, 2)) /
    (1 + Math.sqrt(1 + Math.pow((2 * finSpan_m) / (finRootChord_m + finTipChord_m), 2)));

  return CNalpha_nose + CNalpha_fins;
}

/**
 * Center of pressure location measured from nose tip (meters).
 */
export function computeCPFromNose(inputs: BarrowmanInputsWithBody): number {
  const {
    bodyDiameter_m, noseLength_m, bodyLength_m,
    finRootChord_m, finTipChord_m, finSpan_m, numFins,
  } = inputs;
  const R = bodyDiameter_m / 2;
  const d = bodyDiameter_m;

  // Nose CP: at ~46% of nose length for ogive/parabolic, at 67% for conical
  const noseCPFraction = inputs.noseConeType === 'conical' ? 2 / 3 : 0.466;
  const xCP_nose = noseLength_m * noseCPFraction;
  const CNalpha_nose = 2.0;

  if (numFins === 0 || finSpan_m <= 0 || finRootChord_m <= 0) {
    return xCP_nose;
  }

  const Kfb = 1 + R / (R + finSpan_m);
  const CNalpha_fins =
    Kfb *
    (4 * numFins * Math.pow(finSpan_m / d, 2)) /
    (1 + Math.sqrt(1 + Math.pow((2 * finSpan_m) / (finRootChord_m + finTipChord_m), 2)));

  // Fin CP: at the centroid of the fin planform, measured from nose
  // Fin leading edge is at body length minus root chord (trailing edge at body end)
  const xFinLeadingEdge = bodyLength_m - finRootChord_m;
  // Centroid of trapezoid along root chord: (r + 2t)/(3(r+t)) * root_chord
  const xCP_fins_local = finRootChord_m *
    (finRootChord_m + 2 * finTipChord_m) / (3 * (finRootChord_m + finTipChord_m));
  const xCP_fins = xFinLeadingEdge + xCP_fins_local;

  // Area-weighted average CP location
  const CNalpha_total = CNalpha_nose + CNalpha_fins;
  return (CNalpha_nose * xCP_nose + CNalpha_fins * xCP_fins) / CNalpha_total;
}
