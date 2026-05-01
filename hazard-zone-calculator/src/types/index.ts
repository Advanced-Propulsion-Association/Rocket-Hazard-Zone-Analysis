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

// ─── Multi-Stage ─────────────────────────────────────────────────────────────

export interface StageConfig {
  motor: Motor;
  stageMass_lb: number;         // structural/hardware mass of this stage only (excluding motor)
  separationDelay_s?: number;   // coast time after burnout before separation (default 0)
  tumbleOnSeparation?: boolean; // default true — separated stages tumble, applying 2× CD
  cdOverride?: number;          // per-stage CD override (e.g. from .ork file overridecd)
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
  tier1Table?: Array<{ altitude_ft: number; hazardRadius_ft: number; hazardRadius_m: number }>;
  // Stability (Tier 2/3 only)
  stabilityMargin_cal?: number;
  cdMultiplier?: number;
  cdEffective?: number;
  stabilityCategory?: 'stable' | 'marginal' | 'unstable';
  // Multi-stage: per-stage impact ranges
  stageImpacts?: Array<{ stage: number; label: string; range_m: number; range_ft: number }>;
  // OpenRocket comparison
  orkApogee_m?: number;
  orkMotorDesignation?: string;
  // Tier 3 Barrowman drag breakdown
  barrowmanBreakdown?: {
    CD_friction: number;
    CD_base: number;
    CD_fins: number;
    CD_nose_pressure: number;
    CD_parasitic: number;
    CD_total: number;
  };
}

// ─── Print ───────────────────────────────────────────────────────────────────

export interface PrintInputSummary {
  tier: InputTier;
  siteElevation_ft: number;
  maxWindSpeed_mph: number;
  maxLaunchAngle_deg?: number;  // site-restricted cap (omit = 20° NAR/Tripoli default)
  // Tier 1
  apogee_ft?: number;
  // Tier 2/3
  diameter_in?: number;
  length_in?: number;
  totalMass_lb?: number;
  motorDesignation?: string;
  cdSource?: string;          // e.g. "fineness ratio", ".ork file", "OR CSV"
  buildQualityMultiplier?: number; // e.g. 1.10
  // Tier 3 only
  noseConeType?: string;
  numFins?: number;
  nozzleExitDiameter_in?: number;
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
  cpFromNose_in?: number;
  numStagesDetected?: number;  // count of <stage> elements in the .ork file
  stageData?: Array<{ cdOverride?: number }>; // per-stage overrides; index 0 = booster (firing order)
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
  orkMinCd?: number;
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
