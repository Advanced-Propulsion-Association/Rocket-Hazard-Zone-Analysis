import type { Config6DOF, MonteCarloResult, ScatterPoint } from '../types';
import { simulate6DOF } from './trajectory6dof';

export interface VarianceOptions {
  windVariance?: number;      // fraction of wind speed (default 0.20 = ±20%)
  angleVariance?: number;     // radians (default ~0.035 rad = ±2°)
  impulseVariance?: number;   // fraction of total impulse (default 0.03 = ±3%)
  pitchPerturbance?: number;  // radians initial pitch (default ~0.017 rad = ±1°)
}

/** Uniform random in [-1, 1] */
function rand(): number { return Math.random() * 2 - 1; }

/** Compute hazard radius = max distance from launch pad (origin) */
export function hazardRadiusFromPoints(points: ScatterPoint[]): number {
  if (points.length === 0) return 0;
  return Math.max(...points.map(p => Math.sqrt(p.x * p.x + p.y * p.y)));
}

/** 99th-percentile distance from launch pad */
function p99Radius(points: ScatterPoint[]): number {
  if (points.length === 0) return 0;
  const dists = points.map(p => Math.sqrt(p.x * p.x + p.y * p.y)).sort((a, b) => a - b);
  const idx = Math.min(Math.floor(dists.length * 0.99), dists.length - 1);
  return dists[idx];
}

export function runMonteCarlo(
  nominalConfig: Config6DOF,
  numRuns: number,
  onProgress: (completed: number) => void,
  variance: VarianceOptions = {},
): MonteCarloResult {
  const {
    windVariance     = 0.20,
    angleVariance    = 2.0 * Math.PI / 180,   // 2 degrees in radians
    impulseVariance  = 0.03,
    pitchPerturbance = 1.0 * Math.PI / 180,   // 1 degree in radians
  } = variance;

  const scatter: ScatterPoint[] = [];
  let nominalTrajectory = simulate6DOF({ ...nominalConfig, initialZ_m: 0 });

  for (let i = 0; i < numRuns; i++) {
    // Randomize wind speed (±20%) and direction (0–360° uniform)
    const windSpeed = Math.max(0, nominalConfig.windSpeed_ms * (1 + windVariance * rand()));
    const windDirection = Math.random() * 2 * Math.PI;

    // Randomize launch angle (small perturbation from nominal)
    const launchAngle = Math.max(0, nominalConfig.launchAngle_rad + angleVariance * rand());

    // Motor impulse scaling
    const impulseScale = 1 + impulseVariance * rand();
    const scaledMotor = {
      ...nominalConfig.motor,
      thrustCurve: nominalConfig.motor.thrustCurve.map(pt => ({
        ...pt,
        thrust: pt.thrust * impulseScale,
      })),
    };

    // Initial pitch perturbation
    const pitchPerturb = pitchPerturbance * rand();

    const runConfig: Config6DOF & { initialZ_m?: number } = {
      ...nominalConfig,
      motor: scaledMotor,
      windSpeed_ms: windSpeed,
      windDirection_rad: windDirection,
      launchAngle_rad: launchAngle,
      initialQ_rads: pitchPerturb,
    };

    const pts = simulate6DOF(runConfig);
    const last = pts[pts.length - 1];
    // Guard against NaN from degenerate configs (e.g., zero-thrust, zero-angle)
    const lx = isFinite(last.state.x) ? last.state.x : 0;
    const ly = isFinite(last.state.y) ? last.state.y : 0;
    scatter.push({ x: lx, y: ly, runIndex: i });

    if ((i + 1) % 50 === 0) onProgress(i + 1);
  }

  onProgress(numRuns);

  const hazardRadius_m = hazardRadiusFromPoints(scatter);
  const M_TO_FT = 3.28084;

  return {
    scatter,
    hazardRadius_m,
    hazardRadius_ft: hazardRadius_m * M_TO_FT,
    hazardRadius_p99_m: p99Radius(scatter),
    nominalTrajectory,
    nominalConfig,
  };
}
