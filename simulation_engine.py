"""
FAA Hobby Rocket Hazard Zone Calculator — Physics Engine (V1)
3-DOF point-mass trajectory simulation

Reference: Hazard_Zone_One_Pager.md, OpenRocket thesis (Niskanen), RASAero II manual
Model: Same as TAOS — point mass, no attitude dynamics, nose-forward assumed during descent
       (conservative: lower drag = longer range than actual tumbling)

Coordinate system:
  x = downrange (horizontal, positive downwind)
  z = altitude (positive up)
  Wind along +x direction

Units: SI throughout (m, kg, N, s, Pa, K) except where noted
"""

import math
import numpy as np
from dataclasses import dataclass, field
from typing import List, Tuple, Optional

# ─────────────────────────────────────────────────────────────────────────────
# 1976 US STANDARD ATMOSPHERE
# ─────────────────────────────────────────────────────────────────────────────

# Layer boundaries (geopotential altitude, m) and base values
_ATM_LAYERS = [
    # (base_alt_m, lapse_rate_K/m, base_T_K, base_P_Pa)
    (0,      -0.0065, 288.15, 101325.0),
    (11000,   0.0,    216.65,  22632.1),
    (20000,   0.001,  216.65,   5474.89),
    (32000,   0.0028, 228.65,    868.019),
    (47000,   0.0,    270.65,    110.906),
    (51000,  -0.0028, 270.65,     66.9389),
    (71000,  -0.002,  214.65,      3.95642),
    (86000,   0.0,    186.87,      0.3734),   # above hobby rocket altitudes
]

R_AIR = 287.058   # J/(kg·K)
GAMMA = 1.4
G0    = 9.80665   # m/s²


def isa_temperature(h_m: float, T_offset_K: float = 0.0) -> float:
    """Temperature at geopotential altitude h_m [m], with optional offset."""
    for i in range(len(_ATM_LAYERS) - 1, -1, -1):
        h_base, lapse, T_base, _ = _ATM_LAYERS[i]
        if h_m >= h_base:
            return T_base + lapse * (h_m - h_base) + T_offset_K
    return _ATM_LAYERS[0][2] + T_offset_K


def isa_pressure(h_m: float) -> float:
    """Pressure at geopotential altitude h_m [m] (Pa)."""
    for i in range(len(_ATM_LAYERS) - 1, -1, -1):
        h_base, lapse, T_base, P_base = _ATM_LAYERS[i]
        if h_m >= h_base:
            dh = h_m - h_base
            if abs(lapse) < 1e-10:
                return P_base * math.exp(-G0 * dh / (R_AIR * T_base))
            else:
                return P_base * (T_base / (T_base + lapse * dh)) ** (G0 / (R_AIR * lapse))
    return _ATM_LAYERS[0][3]


def isa_density(h_m: float, T_offset_K: float = 0.0) -> float:
    """Air density at altitude h_m [m] (kg/m³)."""
    T = isa_temperature(h_m, T_offset_K)
    P = isa_pressure(h_m)
    return P / (R_AIR * T)


def speed_of_sound(h_m: float, T_offset_K: float = 0.0) -> float:
    """Speed of sound at altitude h_m [m] (m/s)."""
    T = isa_temperature(h_m, T_offset_K)
    return math.sqrt(GAMMA * R_AIR * T)


def anchored_density(h_m: float, site_elev_m: float, site_T_K: float) -> float:
    """
    Density anchored to launch site conditions.
    Uses ISA profile shifted so site elevation matches site temperature.
    """
    T_isa_site = isa_temperature(site_elev_m)
    T_offset = site_T_K - T_isa_site
    return isa_density(h_m, T_offset)


def anchored_sound_speed(h_m: float, site_elev_m: float, site_T_K: float) -> float:
    T_isa_site = isa_temperature(site_elev_m)
    T_offset = site_T_K - T_isa_site
    return speed_of_sound(h_m, T_offset)


# ─────────────────────────────────────────────────────────────────────────────
# DRAG COEFFICIENT MODEL
# ─────────────────────────────────────────────────────────────────────────────

def cd_from_fineness(fineness_ratio: float) -> float:
    """
    Subsonic CD from fineness ratio (L/D).
    Source: empirical fit from Niskanen/RASAero data.
    Typical range: fB=10-20, CD≈0.35-0.38
    Conservative default if fB unavailable: 0.6
    """
    return 0.35 + 3.0 / (fineness_ratio ** 2)


def cd_mach_correction(cd_subsonic: float, mach: float) -> float:
    """
    Piecewise Mach-number correction to drag coefficient.

    Physics:
    - Subsonic (M < 0.8): nearly constant
    - Transonic (0.8 < M < 1.2): wave drag rise, peaks near M=1
    - Supersonic (M > 1.2): wave drag falls as ~1/M
    """
    if mach < 0.8:
        return cd_subsonic
    elif mach < 1.0:
        # Wave drag rise: smooth ramp from cd_subsonic to cd_subsonic*2.1
        t = (mach - 0.8) / 0.2
        wave = 1.0 + 1.1 * t * t          # quadratic rise
        return cd_subsonic * wave
    elif mach < 1.2:
        # Peak and start of decline
        t = (mach - 1.0) / 0.2
        wave = 2.1 - 0.4 * t              # linear decline from peak
        return cd_subsonic * wave
    else:
        # Supersonic: approximate wave drag ~ C / M
        # Calibrated so CD(1.2) is continuous
        cd_at_12 = cd_subsonic * (2.1 - 0.4)
        return cd_at_12 * (1.2 / mach)


def stability_correction(
    cg_in: Optional[float],
    cp_in: Optional[float],
    body_diameter_in: float,
) -> Optional[dict]:
    """
    Compute static stability margin and CD multiplier for low-stability rockets.

    Margin = (CP - CG) / body_diameter  [calibers]
      >= 1.0 cal → stable     → multiplier 1.0 (no correction)
       0..1 cal  → marginal   → multiplier 1.5 (tumbling likely)
      < 0 cal    → unstable   → multiplier 2.0 (tumbling assumed)

    Returns None if CG or CP not provided.
    """
    if cg_in is None or cp_in is None or body_diameter_in <= 0:
        return None
    margin = (cp_in - cg_in) / body_diameter_in
    if margin >= 1.0:
        return {'margin_cal': margin, 'multiplier': 1.0, 'category': 'stable'}
    if margin >= 0.0:
        return {'margin_cal': margin, 'multiplier': 1.5, 'category': 'marginal'}
    return {'margin_cal': margin, 'multiplier': 2.0, 'category': 'unstable'}


# ─────────────────────────────────────────────────────────────────────────────
# WIND PROFILE (power law gradient)
# ─────────────────────────────────────────────────────────────────────────────

def wind_speed_at_altitude(surface_wind_ms: float, altitude_m: float) -> float:
    """
    Wind speed at altitude using 1/7 power law.
    U(z) = U_surface * (z / 10m)^0.14
    Reference height: 10 m
    Floor: surface wind (don't reduce below surface value at low altitudes)
    """
    if altitude_m <= 10.0:
        return surface_wind_ms
    return surface_wind_ms * (altitude_m / 10.0) ** 0.14


# ─────────────────────────────────────────────────────────────────────────────
# MOTOR / THRUST CURVE
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class ThrustCurve:
    name: str
    diameter_mm: float
    length_mm: float
    propellant_mass_kg: float
    total_mass_kg: float
    manufacturer: str
    time_s: np.ndarray        # [N] time points
    thrust_N: np.ndarray      # [N] thrust values
    nozzle_exit_area_m2: float = 0.0   # for altitude correction; 0 = ignore

    @property
    def total_impulse_Ns(self) -> float:
        return float(np.trapezoid(self.thrust_N, self.time_s))

    @property
    def burn_time_s(self) -> float:
        return float(self.time_s[-1])

    @property
    def average_thrust_N(self) -> float:
        return self.total_impulse_Ns / self.burn_time_s

    @property
    def motor_class(self) -> str:
        I = self.total_impulse_Ns
        classes = [
            (2.5,'A'), (5,'B'), (10,'C'), (20,'D'), (40,'E'), (80,'F'),
            (160,'G'), (320,'H'), (640,'I'), (1280,'J'), (2560,'K'),
            (5120,'L'), (10240,'M'), (20480,'N'), (40960,'O'),
        ]
        for limit, letter in classes:
            if I <= limit:
                return letter
        return 'O+'

    def thrust_at(self, t: float) -> float:
        """Interpolate thrust at time t. Returns 0 after burnout."""
        if t < 0 or t > self.time_s[-1]:
            return 0.0
        return float(np.interp(t, self.time_s, self.thrust_N))

    def thrust_corrected(self, t: float, altitude_m: float) -> float:
        """Altitude-corrected thrust: T(h) = T_SL(t) + (P_SL - P(h)) * A_nozzle."""
        T_sl = self.thrust_at(t)
        if self.nozzle_exit_area_m2 > 0:
            dP = _ATM_LAYERS[0][3] - isa_pressure(altitude_m)
            return T_sl + dP * self.nozzle_exit_area_m2
        return T_sl


def parse_rasp_eng(eng_text: str) -> ThrustCurve:
    """
    Parse a RASP .eng motor file.

    Format:
      ; comment lines
      <name> <diameter_mm> <length_mm> <delays> <propellant_mass_kg> <total_mass_kg> <manufacturer>
      <time_s> <thrust_N>
      ...
    """
    lines = [l.strip() for l in eng_text.strip().splitlines()
             if l.strip() and not l.strip().startswith(';')]

    # First non-comment line is the header
    header = lines[0].split()
    name = header[0]
    diameter_mm = float(header[1])
    length_mm = float(header[2])
    # header[3] = delays (ignored)
    propellant_mass_kg = float(header[4])
    total_mass_kg = float(header[5])
    manufacturer = header[6] if len(header) > 6 else 'Unknown'

    times = []
    thrusts = []
    for line in lines[1:]:
        parts = line.split()
        if len(parts) >= 2:
            try:
                times.append(float(parts[0]))
                thrusts.append(float(parts[1]))
            except ValueError:
                continue

    return ThrustCurve(
        name=name,
        diameter_mm=diameter_mm,
        length_mm=length_mm,
        propellant_mass_kg=propellant_mass_kg,
        total_mass_kg=total_mass_kg,
        manufacturer=manufacturer,
        time_s=np.array(times),
        thrust_N=np.array(thrusts),
    )


def make_boxcar_motor(
    avg_thrust_N: float,
    burn_time_s: float,
    propellant_mass_kg: float,
    total_mass_kg: float,
    name: str = 'Custom',
    nozzle_exit_area_m2: float = 0.0,
) -> ThrustCurve:
    """Create a constant-thrust (boxcar) motor from average thrust and burn time."""
    dt = 0.01
    times = np.arange(0, burn_time_s + dt, dt)
    thrusts = np.where(times < burn_time_s, avg_thrust_N, 0.0)
    return ThrustCurve(
        name=name,
        diameter_mm=0,
        length_mm=0,
        propellant_mass_kg=propellant_mass_kg,
        total_mass_kg=total_mass_kg,
        manufacturer='Custom',
        time_s=times,
        thrust_N=thrusts,
        nozzle_exit_area_m2=nozzle_exit_area_m2,
    )


# ─────────────────────────────────────────────────────────────────────────────
# 3-DOF TRAJECTORY INTEGRATOR
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class RocketConfig:
    """All rocket parameters needed for simulation."""
    # Geometry
    body_diameter_m: float          # reference diameter
    body_length_m: float            # total length
    total_mass_kg: float            # loaded (wet) mass at liftoff

    # Motor
    motor: ThrustCurve

    # Aerodynamics
    cd_override: Optional[float] = None   # if set, use this CD instead of estimating

    # Stability (optional)
    cg_in: Optional[float] = None   # center of gravity from nose tip, inches
    cp_in: Optional[float] = None   # center of pressure from nose tip, inches

    # Launch conditions
    launch_angle_deg: float = 0.0         # from vertical (0 = straight up)
    site_elevation_m: float = 0.0
    site_temperature_K: float = 288.15
    surface_wind_ms: float = 0.0          # headwind (along launch direction)
    initial_z_m: float = 0.0             # starting altitude AGL (>0 for descent-from-apogee)

    @property
    def reference_area_m2(self) -> float:
        return math.pi * (self.body_diameter_m / 2) ** 2

    @property
    def fineness_ratio(self) -> float:
        return self.body_length_m / self.body_diameter_m

    @property
    def cd_subsonic(self) -> float:
        if self.cd_override is not None:
            return self.cd_override
        return cd_from_fineness(self.fineness_ratio)

    @property
    def dry_mass_kg(self) -> float:
        return self.total_mass_kg - self.motor.propellant_mass_kg


@dataclass
class TrajectoryPoint:
    t: float
    x: float       # downrange (m)
    z: float       # altitude AGL (m)
    vx: float      # downrange velocity (m/s)
    vz: float      # vertical velocity (m/s)
    mass: float    # kg
    thrust: float  # N
    drag: float    # N
    mach: float


def simulate_trajectory(
    config: RocketConfig,
    dt_max: float = 0.05,
    max_time_s: float = 600.0,
) -> List[TrajectoryPoint]:
    """
    RK4 integration of 3-DOF point-mass trajectory.

    State vector: [x, z, vx, vz, m]

    Equations of motion:
      dx/dt  = vx
      dz/dt  = vz
      dvx/dt = (T*sin(α_launch) - Dx) / m        [wind handled as relative velocity]
      dvz/dt = (T*cos(α_launch) - Dz) / m - g
      dm/dt  = -mp * T(t) / I_total               [mass depletion proportional to thrust]

    Launch angle convention: measured from vertical
      α_launch: rocket body axis angle from vertical
      At launch: vx0 = V * sin(α), vz0 = V * cos(α)

    Wind: treated as constant relative velocity offset on drag calculation
          V_rel = V_rocket - V_wind
    """
    motor = config.motor
    I_total = motor.total_impulse_Ns
    mp = motor.propellant_mass_kg

    # Initial conditions — rocket on rail, small initial velocity (1 m/s to avoid div/0)
    alpha_rad = math.radians(config.launch_angle_deg)
    v0 = 1.0   # m/s on launch rail

    # Site offset for atmosphere anchoring
    site_elev = config.site_elevation_m
    site_T = config.site_temperature_K

    # State: [x, z, vx, vz, m]
    # If starting above ground (descent-from-apogee), begin at initial_z_m with zero velocity
    z0 = config.initial_z_m
    state = np.array([
        0.0,
        z0,
        v0 * math.sin(alpha_rad) if z0 <= 5 else 0.0,
        v0 * math.cos(alpha_rad) if z0 <= 5 else 0.0,
        config.total_mass_kg,
    ])

    # Skip "must rise first" guard when starting mid-air
    was_above_ground: bool = z0 > 5

    points: List[TrajectoryPoint] = []
    t = 0.0

    def derivatives(t: float, s: np.ndarray) -> np.ndarray:
        x, z, vx, vz, m = s
        abs_z = max(z + site_elev, 0.0)   # altitude MSL

        # Thrust (altitude-corrected)
        T = motor.thrust_corrected(t, abs_z)

        # Rocket speed relative to ground
        Vx_rel = vx - config.surface_wind_ms   # headwind reduces effective x-velocity
        Vy_rel = vz
        V_rel = math.sqrt(Vx_rel**2 + Vy_rel**2)

        # Drag
        a_sound = anchored_sound_speed(abs_z, site_elev, site_T)
        mach = V_rel / a_sound if a_sound > 0 else 0.0
        cd = cd_mach_correction(config.cd_subsonic, mach)
        rho = anchored_density(abs_z, site_elev, site_T)
        D = 0.5 * rho * V_rel**2 * config.reference_area_m2 * cd

        # Thrust direction: along rocket axis (same as initial launch angle)
        # (point-mass model: thrust direction fixed at launch angle during powered phase)
        if V_rel > 0.5:
            # During unpowered flight: drag opposes velocity
            drag_x = -D * Vx_rel / V_rel
            drag_z = -D * Vy_rel / V_rel
        else:
            drag_x = 0.0
            drag_z = 0.0

        thrust_x = T * math.sin(alpha_rad)
        thrust_z = T * math.cos(alpha_rad)

        ax = (thrust_x + drag_x) / m
        az = (thrust_z + drag_z) / m - G0

        # Mass depletion proportional to thrust (so total depletion = mp)
        if I_total > 0:
            dm = -mp * T / I_total
        else:
            dm = 0.0

        # Clamp mass at dry mass
        if m <= config.dry_mass_kg and dm < 0:
            dm = 0.0

        return np.array([vx, vz, ax, az, dm])

    def record(t, s, T, D, mach):
        x, z, vx, vz, m = s
        points.append(TrajectoryPoint(
            t=t, x=x, z=z, vx=vx, vz=vz, mass=m,
            thrust=T, drag=D, mach=mach
        ))

    # Adaptive time step RK4
    while t < max_time_s:
        x, z, vx, vz, m = state
        abs_z = max(z + site_elev, 0.0)

        if z > 5:
            was_above_ground = True

        T_now = motor.thrust_corrected(t, abs_z)
        Vx_rel = vx - config.surface_wind_ms
        V_rel = math.sqrt(Vx_rel**2 + vz**2)
        a_sound = anchored_sound_speed(abs_z, site_elev, site_T)
        mach_now = V_rel / a_sound if a_sound > 0 else 0.0
        cd_now = cd_mach_correction(config.cd_subsonic, mach_now)
        rho_now = anchored_density(abs_z, site_elev, site_T)
        D_now = 0.5 * rho_now * V_rel**2 * config.reference_area_m2 * cd_now

        record(t, state, T_now, D_now, mach_now)

        # Termination: landed after liftoff
        if was_above_ground and z < -1.0:
            break
        # Termination: rocket barely left the ground (zero-thrust or underpowered)
        if not was_above_ground and z < -1.0 and t > motor.burn_time_s + 1.0:
            break
        # Safety bail: never leaves ground after 30s
        if not was_above_ground and t > 30:
            break

        # Adaptive time step: smaller near burnout and apogee
        dt = min(dt_max, 0.2)
        if T_now > 0:
            dt = min(dt, 0.02)    # fine resolution during burn

        # RK4
        k1 = derivatives(t, state)
        k2 = derivatives(t + dt/2, state + dt/2 * k1)
        k3 = derivatives(t + dt/2, state + dt/2 * k2)
        k4 = derivatives(t + dt,   state + dt   * k3)

        state = state + (dt / 6) * (k1 + 2*k2 + 2*k3 + k4)
        t += dt

    return points


# ─────────────────────────────────────────────────────────────────────────────
# HAZARD ZONE CALCULATOR
# ─────────────────────────────────────────────────────────────────────────────

@dataclass
class HazardZoneResult:
    hazard_radius_m: float
    hazard_radius_ft: float
    optimal_launch_angle_deg: float
    max_apogee_m: float
    max_apogee_ft: float
    motor_class: str
    total_impulse_Ns: float
    quarter_altitude_rule_m: float
    quarter_rule_conservative: bool
    trajectories: dict = field(default_factory=dict)   # angle -> points (optional)
    # Stability
    stability_margin_cal: Optional[float] = None
    cd_multiplier: Optional[float] = None
    stability_category: Optional[str] = None

    def summary(self) -> str:
        status = "OK - Conservative" if self.quarter_rule_conservative else "WARN - May underestimate, use physics result"
        lines = [
            f"  ----------------------------------------",
            f"  HAZARD ZONE RESULT",
            f"  ----------------------------------------",
            f"  Radius:           {self.hazard_radius_m:.0f} m  ({self.hazard_radius_ft:.0f} ft)",
            f"  Optimal angle:    {self.optimal_launch_angle_deg:.1f} deg from vertical",
            f"  Max apogee:       {self.max_apogee_m:.0f} m  ({self.max_apogee_ft:.0f} ft)",
            f"  Motor class:      {self.motor_class}  ({self.total_impulse_Ns:.0f} N*s)",
            f"  1/4-altitude rule:{self.quarter_altitude_rule_m:.0f} m  ({self.quarter_altitude_rule_m*3.281:.0f} ft)",
            f"  1/4-rule status:  {status}",
            f"  ----------------------------------------",
        ]
        return '\n'.join(lines)


def compute_hazard_zone(
    config: RocketConfig,
    angle_step_deg: float = 2.0,
    store_trajectories: bool = False,
) -> HazardZoneResult:
    """
    Sweep launch angles from 0° to 20° (NAR/Tripoli max) and return max impact range.

    The hazard zone radius is the maximum horizontal distance from the launch pad
    at which the rocket could impact the ground — worst case over all launch angles.
    """
    angles = np.arange(0, 20.0 + angle_step_deg, angle_step_deg)

    # Stability correction: low-stability rockets tumble during descent → higher effective CD
    body_diameter_in = config.body_diameter_m / 0.0254
    stab = stability_correction(config.cg_in, config.cp_in, body_diameter_in)
    effective_cd_override = config.cd_override
    if stab and stab['multiplier'] != 1.0:
        base_cd = config.cd_override if config.cd_override is not None else cd_from_fineness(config.fineness_ratio)
        effective_cd_override = base_cd * stab['multiplier']

    max_range_m = 0.0
    best_angle = 0.0
    max_apogee_m = 0.0
    trajectories = {}

    for angle in angles:
        cfg = RocketConfig(
            body_diameter_m=config.body_diameter_m,
            body_length_m=config.body_length_m,
            total_mass_kg=config.total_mass_kg,
            motor=config.motor,
            cd_override=effective_cd_override,
            launch_angle_deg=float(angle),
            site_elevation_m=config.site_elevation_m,
            site_temperature_K=config.site_temperature_K,
            surface_wind_ms=config.surface_wind_ms,
        )
        points = simulate_trajectory(cfg)

        # Max apogee (straight-up shot captures absolute ceiling)
        apogee = max(p.z for p in points)
        if angle < 1.0:   # near-vertical
            max_apogee_m = max(max_apogee_m, apogee)

        # Impact range (last point's x when z ≈ 0)
        # Find ground impact: last point before z goes negative
        impact_x = abs(points[-1].x)

        if impact_x > max_range_m:
            max_range_m = impact_x
            best_angle = float(angle)

        if store_trajectories:
            trajectories[float(angle)] = points

    # Compute apogee for 0° launch (true max altitude)
    vertical_cfg = RocketConfig(
        body_diameter_m=config.body_diameter_m,
        body_length_m=config.body_length_m,
        total_mass_kg=config.total_mass_kg,
        motor=config.motor,
        cd_override=effective_cd_override,
        launch_angle_deg=0.0,
        site_elevation_m=config.site_elevation_m,
        site_temperature_K=config.site_temperature_K,
        surface_wind_ms=0.0,   # no wind for apogee estimate
    )
    vert_points = simulate_trajectory(vertical_cfg)
    max_apogee_m = max(p.z for p in vert_points)

    quarter_rule = max_apogee_m / 4.0

    return HazardZoneResult(
        hazard_radius_m=max_range_m,
        hazard_radius_ft=max_range_m * 3.28084,
        optimal_launch_angle_deg=best_angle,
        max_apogee_m=max_apogee_m,
        max_apogee_ft=max_apogee_m * 3.28084,
        motor_class=config.motor.motor_class,
        total_impulse_Ns=config.motor.total_impulse_Ns,
        quarter_altitude_rule_m=quarter_rule,
        quarter_rule_conservative=(quarter_rule >= max_range_m),
        trajectories=trajectories if store_trajectories else {},
        stability_margin_cal=stab['margin_cal'] if stab else None,
        cd_multiplier=stab['multiplier'] if stab else None,
        stability_category=stab['category'] if stab else None,
    )


# ─────────────────────────────────────────────────────────────────────────────
# TIER 1: OPERATOR MODE (altitude only)
# ─────────────────────────────────────────────────────────────────────────────

def tier1_hazard_zone(
    max_apogee_ft: float,
    site_elevation_ft: float = 0.0,
) -> HazardZoneResult:
    """
    Operator mode: only know max expected altitude.

    Method (matches TypeScript computeTier1HazardZone):
      1. Simulate ballistic DESCENT from apogee with zero initial velocity.
         CD=0.60 (conservative: high drag → slow fall → more time in wind → longer range).
         Conservative defaults: 1.5 kg rocket, 65 mm diameter, 50 in long.
      2. Add geometric ascent offset = apogee × tan(20°) × 0.4 to account for
         horizontal drift during powered ascent at max 20° tilt.
         (0.4 factor accounts for drag/gravity reducing effective horizontal travel.)
      3. Report max(physics result, NAR/Tripoli ¼-altitude rule).
    """
    apogee_m = max_apogee_ft * 0.3048
    site_m   = site_elevation_ft * 0.3048
    wind_ms  = 8.94   # 20 MPH

    # Conservative rocket defaults: 1.5 kg, 65 mm dia, 50 in long, CD=0.60
    mass_kg   = 1.5
    dia_m     = 0.065
    len_m     = 50 * 0.0254   # 50 inches = 1.27 m

    # Zero-thrust motor for pure ballistic descent
    descent_motor = make_boxcar_motor(
        avg_thrust_N=0.001,
        burn_time_s=0.01,
        propellant_mass_kg=0.0,
        total_mass_kg=mass_kg,
        name='Tier1_Descent',
    )

    cfg = RocketConfig(
        body_diameter_m=dia_m,
        body_length_m=len_m,
        total_mass_kg=mass_kg,
        motor=descent_motor,
        cd_override=0.60,        # high CD = slow fall = more wind drift = conservative
        launch_angle_deg=0.0,
        site_elevation_m=site_m,
        site_temperature_K=288.15,
        surface_wind_ms=wind_ms,
        initial_z_m=apogee_m,   # start at apogee altitude
    )

    descent_pts     = simulate_trajectory(cfg)
    descent_range_m = abs(descent_pts[-1].x)

    # Ascent offset: worst-case horizontal travel during powered climb at 20° tilt
    ascent_offset_m = apogee_m * math.tan(math.radians(20)) * 0.4
    physics_range_m = descent_range_m + ascent_offset_m
    quarter_rule_m  = apogee_m / 4.0
    hazard_m        = max(physics_range_m, quarter_rule_m)

    warnings = []
    if max_apogee_ft > 18000:
        warnings.append('Launch above 18,000 ft MSL — may require FAA coordination under 14 CFR Part 101.')
    if max_apogee_ft > 60000:
        warnings.append('Launch above 60,000 ft — requires FAA launch license (14 CFR Part 450).')

    return HazardZoneResult(
        hazard_radius_m=hazard_m,
        hazard_radius_ft=hazard_m * 3.28084,
        optimal_launch_angle_deg=20.0,
        max_apogee_m=apogee_m,
        max_apogee_ft=max_apogee_ft,
        motor_class='?',
        total_impulse_Ns=0.0,
        quarter_altitude_rule_m=quarter_rule_m,
        quarter_rule_conservative=(quarter_rule_m >= hazard_m),
        trajectories={},
    )


# ─────────────────────────────────────────────────────────────────────────────
# VALIDATION TESTS
# ─────────────────────────────────────────────────────────────────────────────

# Known test cases for validation
ESTES_D12_ENG = """; Estes D12 motor - RASP .eng format
; Total impulse ~16.85 N*s, avg thrust 12N, burn 1.68s - Class D
; Motor mass: 42.2g total, 11.8g propellant (18mm motor, steel casing)
D12 18 70 3-5-7 0.0118 0.0422 Estes
0.000  0.0
0.020 29.7
0.060 20.0
0.200 14.0
0.400 12.5
0.600 11.5
0.800 11.0
1.000 10.5
1.200  9.5
1.400  8.5
1.500  6.0
1.600  2.0
1.680  0.0
"""

AEROTECH_K1000T_ENG = """; AeroTech K1000T — approximate RASP data
; Total impulse ~2131 N·s, Class K
K1000T 54 403 P 0.899 1.874 AeroTech
0.000 0.0
0.020 1250.0
0.100 1100.0
0.200 1050.0
0.400 1000.0
0.600 980.0
0.800 960.0
1.000 940.0
1.200 920.0
1.400 900.0
1.600 880.0
1.800 850.0
1.900 800.0
2.000 700.0
2.100 500.0
2.131 0.0
"""


def run_validation():
    """
    Validate physics engine against known benchmark cases.

    Benchmark 1: Estes Alpha on D12-3
      - Expected apogee: ~130-180m (425-590 ft) per OpenRocket
      - Typical hazard zone: ~80-120m

    Benchmark 2: High-power rocket on K1000T
      - Expected apogee: ~1500-2500m (4900-8200 ft)
      - NAR 1/4 rule: ~375-625m
    """
    print("=" * 60)
    print("FAA HAZARD ZONE CALCULATOR — PHYSICS VALIDATION")
    print("=" * 60)

    # ── Test 1: Estes Alpha on D12-3 ──────────────────────────────
    print("\n[TEST 1] Estes Alpha III on D12-3")
    print("  Expected apogee: ~130-160m (425-525 ft) per OpenRocket")
    print("  Rocket: 41mm dia, 457mm long, 84.7g loaded (42.5g dry body + 42.2g motor)")

    d12 = parse_rasp_eng(ESTES_D12_ENG)
    print(f"  Motor: {d12.name} | Class {d12.motor_class} | {d12.total_impulse_Ns:.1f} N*s | {d12.burn_time_s:.2f}s burn")

    estes_alpha = RocketConfig(
        body_diameter_m=0.041,     # 41mm body tube
        body_length_m=0.457,       # 18 inches
        total_mass_kg=0.0847,      # 84.7g: 42.5g dry body + 42.2g D12 motor
        motor=d12,
        site_elevation_m=0.0,
        site_temperature_K=288.15,
        surface_wind_ms=0.0,       # calm first
    )

    # Straight-up trajectory for apogee check
    vert = simulate_trajectory(estes_alpha)
    apogee = max(p.z for p in vert)
    t_apogee = next(p.t for p in reversed(vert) if p.z == apogee or p.z >= apogee - 1)
    v_burnout = next((p for p in vert if p.thrust == 0.0), None)
    print(f"  Computed apogee (calm, vertical): {apogee:.0f} m  ({apogee*3.281:.0f} ft)")
    if v_burnout:
        v_bo = math.sqrt(v_burnout.vx**2 + v_burnout.vz**2)
        print(f"  Burnout velocity: {v_bo:.0f} m/s ({v_bo*2.237:.0f} mph)  alt: {v_burnout.z:.0f} m")
    print(f"  CD (subsonic): {estes_alpha.cd_subsonic:.3f}  fineness: {estes_alpha.fineness_ratio:.1f}")

    # Hazard zone with 20 MPH wind
    estes_alpha.surface_wind_ms = 8.94
    result = compute_hazard_zone(estes_alpha, store_trajectories=False)
    print(result.summary())

    # ── Test 2: High-power K1000T ──────────────────────────────────
    print("\n[TEST 2] High-power rocket on K1000T (54mm, ~1.8kg)")
    print("  Expected apogee: ~1500-2500m | 1/4 rule: ~375-625m")

    k1000 = parse_rasp_eng(AEROTECH_K1000T_ENG)
    print(f"  Motor: {k1000.name} | Class {k1000.motor_class} | {k1000.total_impulse_Ns:.0f} N*s | {k1000.burn_time_s:.2f}s burn")

    hp_rocket = RocketConfig(
        body_diameter_m=0.054,
        body_length_m=1.4,
        total_mass_kg=1.874,   # match motor total mass for simplicity
        motor=k1000,
        site_elevation_m=0.0,
        site_temperature_K=288.15,
        surface_wind_ms=8.94,
    )

    result2 = compute_hazard_zone(hp_rocket, store_trajectories=False)
    print(result2.summary())

    # ── Test 3: NAR/Tripoli 1/4 rule validation table ────────────────
    print("\n[TEST 3] NAR/Tripoli 1/4-altitude rule validation")
    print(f"  {'Apogee (ft)':>12} | {'1/4 Rule (ft)':>13} | {'Physics (ft)':>12} | Status")
    print("  " + "-"*70)

    altitudes_ft = [1000, 5000, 10000, 30000]
    for alt_ft in altitudes_ft:
        r = tier1_hazard_zone(alt_ft, site_elevation_ft=0)
        q_rule = alt_ft / 4
        physics_ft = r.hazard_radius_ft
        status = "OK - Conservative" if q_rule >= physics_ft else "WARN - May underestimate"
        print(f"  {alt_ft:>12,} | {q_rule:>13,.0f} | {physics_ft:>12,.0f} | {status}")

    # ── Test 4: ISA Atmosphere sanity check ─────────────────────────
    print("\n[TEST 4] ISA Atmosphere sanity check")
    test_alts = [0, 1000, 5000, 10000, 11000, 15000]
    print(f"  {'Alt (m)':>8} | {'T (K)':>8} | {'P (Pa)':>10} | {'rho(kg/m3)':>10} | {'a (m/s)':>8}")
    print("  " + "-"*55)
    for h in test_alts:
        T = isa_temperature(h)
        P = isa_pressure(h)
        rho = isa_density(h)
        a = speed_of_sound(h)
        print(f"  {h:>8} | {T:>8.2f} | {P:>10.1f} | {rho:>10.4f} | {a:>8.2f}")
    # Cross-check: at sea level T=288.15K, P=101325Pa, ρ=1.225 kg/m³, a=340.3 m/s


if __name__ == "__main__":
    run_validation()
