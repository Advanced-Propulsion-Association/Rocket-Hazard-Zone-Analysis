// ─── Re-export v1 motor types (unchanged) ────────────────────────────────────

export interface ThrustPoint {
  time: number;
  thrust: number;
}

export interface Motor {
  name: string;
  diameterMm: number;
  lengthMm: number;
  propellantMassKg: number;
  totalMassKg: number;
  manufacturer: string;
  thrustCurve: ThrustPoint[];
  nozzleExitAreaM2?: number;
}

// ─── 6-DOF state vector ───────────────────────────────────────────────────────

export interface State6DOF {
  x: number;     // downrange position (m) — aligned with wind
  y: number;     // lateral position (m)
  z: number;     // altitude AGL (m)
  vx: number;    // velocity x (m/s)
  vy: number;    // velocity y (m/s)
  vz: number;    // velocity z (m/s)
  phi: number;   // roll angle (rad)
  theta: number; // pitch angle from vertical (rad) — 0 = straight up
  psi: number;   // yaw angle (rad)
  p: number;     // roll rate (rad/s)
  q: number;     // pitch rate (rad/s)
  r: number;     // yaw rate (rad/s)
  mass: number;  // kg
}

// ─── 6-DOF simulation config ──────────────────────────────────────────────────

export interface Config6DOF {
  bodyDiameter_m: number;
  bodyLength_m: number;
  noseConeLength_m: number;
  totalMass_kg: number;
  motor: Motor;
  Ixx_kgm2: number;              // axial MOI (kg·m²)
  Iyy_kgm2: number;              // transverse MOI (kg·m²) — same for yaw (symmetric)
  CNalpha: number;               // normal force slope (per rad)
  CP_m: number;                  // CP from nose (m)
  CG_m: number;                  // CG from nose (m)
  CD: number;                    // drag coefficient
  Cmq: number;                   // pitch damping coefficient
  Cnr: number;                   // yaw damping coefficient
  Clp: number;                   // roll damping coefficient
  finRootChord_m: number;
  finTipChord_m: number;
  finSpan_m: number;
  finSweepAngle_rad: number;
  numFins: number;
  thrustCurve: [number, number][];  // [time_s, thrust_N][]
  propellantMass_kg: number;
  launchAngle_rad: number;       // from vertical (0–20°)
  launchAzimuth_deg: number;     // 0 = into wind
  launchAltitude_m: number;
  siteTemp_K: number;
  windSpeed_ms: number;          // wind speed (along +X)
  windDirection_rad: number;
  initialRollRate_rads: number;  // p0 — 0 for unspun rockets
  initialQ_rads?: number;        // initial pitch rate perturbation (Monte Carlo use)
}

// ─── Trajectory output ────────────────────────────────────────────────────────

export interface TrajectoryPoint6DOF {
  t: number;
  state: State6DOF;
  alpha: number;   // angle of attack (rad) — telemetry
  mach: number;
  thrust: number;
  drag: number;
}

// ─── Monte Carlo ──────────────────────────────────────────────────────────────

export interface ScatterPoint {
  x: number;   // landing downrange (m)
  y: number;   // landing lateral (m)
  runIndex: number;
}

export interface MonteCarloResult {
  scatter: ScatterPoint[];
  /** Headline hazard radius: P99 of landing distances (statistically robust for FAA reporting). */
  hazardRadius_m: number;
  hazardRadius_ft: number;
  /** Maximum landing distance across all runs (supplemental; high variance with small N). */
  hazardRadius_max_m: number;
  nominalTrajectory: TrajectoryPoint6DOF[];
  nominalConfig: Config6DOF;
}

// ─── Worker messages ──────────────────────────────────────────────────────────

export type WorkerRequest = {
  type: 'run';
  config: Config6DOF;
  numRuns: number;
};

export type WorkerProgress = {
  type: 'progress';
  completed: number;
  total: number;
};

export type WorkerResult = {
  type: 'result';
  result: MonteCarloResult;
};

// ─── OpenRocket data (extended for 6-DOF) ────────────────────────────────────

export interface OpenRocketData {
  rocketName?: string;
  bodyDiameter_in: number;
  bodyLength_in: number;
  noseConeType: 'ogive' | 'conical' | 'parabolic' | 'haack';
  noseLength_in: number;
  finRootChord_in: number;
  finTipChord_in: number;
  finSpan_in: number;
  finSweep_in?: number;
  numFins?: number;
  cgFromNose_in?: number;        // CG location from nose tip (from .ork component data)
  cpFromNose_in?: number;        // CP from Barrowman (computed or from .ork)
  motorDesignation?: string;
  motorManufacturer?: string;
  // Stored OpenRocket simulation results for the default motor configuration
  maxApogee_m?: number;
  maxVelocity_ms?: number;
  maxAcceleration_ms2?: number;
  maxMach?: number;
  timeToApogee_s?: number;
  flightTime_s?: number;
  groundHitVelocity_ms?: number;
  launchRodVelocity_ms?: number;
}

// ─── Motor lookup ─────────────────────────────────────────────────────────────

export interface MotorSearchResult {
  motorId: string;
  commonName: string;
  designation: string;
  manufacturer: string;
  totalImpulseNs: number;
  avgThrustN: number;
  burnTimeS: number;
  propWeightKg: number;    // ThrustCurve.org returns grams — convert at import boundary
  totalWeightKg: number;
  diameterMm: number;
  lengthMm: number;
  motorClass: string;
}
