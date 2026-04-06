/**
 * 1976 US Standard Atmosphere (ISA)
 * Piecewise layers with temperature lapse rates.
 * Anchored to launch site elevation and temperature.
 */

const G0 = 9.80665;   // m/s²
const R_AIR = 287.058; // J/(kg·K)
const GAMMA = 1.4;

interface AtmLayer {
  baseAlt: number;   // m
  lapse: number;     // K/m (negative = cooling with altitude)
  baseT: number;     // K
  baseP: number;     // Pa
}

const LAYERS: AtmLayer[] = [
  { baseAlt: 0,     lapse: -0.0065, baseT: 288.15, baseP: 101325.0 },
  { baseAlt: 11000, lapse:  0.0,    baseT: 216.65, baseP:  22632.1 },
  { baseAlt: 20000, lapse:  0.001,  baseT: 216.65, baseP:   5474.89 },
  { baseAlt: 32000, lapse:  0.0028, baseT: 228.65, baseP:    868.019 },
  { baseAlt: 47000, lapse:  0.0,    baseT: 270.65, baseP:    110.906 },
  { baseAlt: 51000, lapse: -0.0028, baseT: 270.65, baseP:     66.9389 },
  { baseAlt: 71000, lapse: -0.002,  baseT: 214.65, baseP:      3.95642 },
  { baseAlt: 86000, lapse:  0.0,    baseT: 186.87, baseP:      0.3734 },
];

function findLayer(h: number): AtmLayer {
  for (let i = LAYERS.length - 1; i >= 0; i--) {
    if (h >= LAYERS[i].baseAlt) return LAYERS[i];
  }
  return LAYERS[0];
}

export function isaTemperature(h_m: number, tOffset = 0): number {
  const layer = findLayer(h_m);
  return layer.baseT + layer.lapse * (h_m - layer.baseAlt) + tOffset;
}

export function isaPressure(h_m: number): number {
  const layer = findLayer(h_m);
  const dh = h_m - layer.baseAlt;
  if (Math.abs(layer.lapse) < 1e-10) {
    return layer.baseP * Math.exp(-G0 * dh / (R_AIR * layer.baseT));
  }
  return layer.baseP * Math.pow(layer.baseT / (layer.baseT + layer.lapse * dh), G0 / (R_AIR * layer.lapse));
}

export function isaTemperatureOffset(siteElev_m: number, siteTemp_K: number): number {
  return siteTemp_K - isaTemperature(siteElev_m);
}

export function airDensity(h_m: number, tOffset = 0): number {
  const T = isaTemperature(h_m, tOffset);
  const P = isaPressure(h_m);
  return P / (R_AIR * T);
}

export function speedOfSound(h_m: number, tOffset = 0): number {
  const T = isaTemperature(h_m, tOffset);
  return Math.sqrt(GAMMA * R_AIR * T);
}

/** Wind speed at altitude using 1/7 power-law gradient. */
export function windAtAltitude(surfaceWind_ms: number, alt_m: number): number {
  if (alt_m <= 10) return surfaceWind_ms;
  return surfaceWind_ms * Math.pow(alt_m / 10, 0.14);
}

export { G0 };
