// ─── Motor ───────────────────────────────────────────────────────────────────

export interface ThrustPoint {
  time: number;   // seconds
  thrust: number; // Newtons
}

export interface Motor {
  name: string;
  diameterMm: number;
  lengthMm: number;
  propellantMassKg: number;
  totalMassKg: number;
  manufacturer: string;
  thrustCurve: ThrustPoint[];
  nozzleExitAreaM2?: number; // optional, for altitude correction
}

// ─── Rocket Configuration ────────────────────────────────────────────────────

export type InputTier = 'tier1' | 'tier2' | 'tier3';

export interface RocketInputs {
  tier: InputTier;

  // Tier 1
  maxApogee_ft?: number;
  siteElevation_ft?: number;

  // Tier 2+
  bodyDiameter_in?: number;
  bodyLength_in?: number;
  totalMass_lb?: number;
  motor?: Motor;

  // Tier 3 additional
  noseConeType?: 'ogive' | 'conical' | 'parabolic' | 'haack';
  noseLength_in?: number;
  finRootChord_in?: number;
  finTipChord_in?: number;
  finSpan_in?: number;
  finSweep_in?: number;
  nozzleExitDiameter_in?: number;
  surfaceTemp_F?: number;
  numStages?: number;

  // Launch conditions
  surfaceWind_mph?: number;
  cdOverride?: number; // manual CD override
}

// ─── Trajectory ──────────────────────────────────────────────────────────────

export interface TrajectoryPoint {
  t: number;    // seconds
  x: number;    // downrange distance (m)
  z: number;    // altitude AGL (m)
  vx: number;   // m/s
  vz: number;   // m/s
  mass: number; // kg
  mach: number;
  thrust: number; // N
  drag: number;   // N
}

// ─── Result ──────────────────────────────────────────────────────────────────

export interface HazardZoneResult {
  hazardRadius_m: number;
  hazardRadius_ft: number;
  optimalAngle_deg: number;
  maxApogee_m: number;
  maxApogee_ft: number;
  motorClass: string;
  totalImpulse_Ns: number;
  quarterAltitudeRule_m: number;
  quarterRuleConservative: boolean;
  trajectories?: Record<number, TrajectoryPoint[]>; // angle -> trajectory
  warnings: string[];
  // Tier 1 breakdown (descent-from-apogee mode only)
  tier1DescentRange_m?: number;
  tier1AscentOffset_m?: number;
  // Stability (Tier 2/3 only)
  stabilityMargin_cal?: number;
  cdMultiplier?: number;
  cdEffective?: number;
  stabilityCategory?: 'stable' | 'marginal' | 'unstable';
  // OpenRocket comparison
  orkApogee_m?: number;
  orkMotorDesignation?: string;
  // Tier 3 Barrowman drag breakdown
  barrowmanBreakdown?: {
    CD_friction: number;
    CD_base: number;
    CD_fins: number;
    CD_nose_pressure: number;
    CD_total: number;
  };
}

// ─── OpenRocket Data ─────────────────────────────────────────────────────────

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
  cgFromNose_in?: number;
  motorDesignation?: string;
  motorManufacturer?: string;
  maxApogee_m?: number;
  maxVelocity_ms?: number;
  maxAcceleration_ms2?: number;
  maxMach?: number;
  timeToApogee_s?: number;
  flightTime_s?: number;
  groundHitVelocity_ms?: number;
  launchRodVelocity_ms?: number;
}

// ─── Motor Lookup (ThrustCurve.org) ─────────────────────────────────────────

export interface MotorSearchResult {
  motorId: string;
  commonName: string;
  designation: string;
  manufacturer: string;
  totalImpulseNs: number;
  avgThrustN: number;
  burnTimeS: number;
  propWeightG: number;
  totalWeightG: number;
  diameter: number; // mm
  length: number;   // mm
  motorClass: string;
}
