# 6-DOF Rocket Flight Mechanics Reference

**Purpose:** Physics reference for FAA hazard zone calculator — understanding what a 6-DOF model adds over 3-DOF, and how to model tumbling spent stages for multi-stage hazard zones.

**Primary Sources:**
- Niskanen, S. (2013). *OpenRocket Technical Documentation* (v13.05)
- RocketPy Team (2024). *Equations of Motion v0/v1*. docs.rocketpy.org
- Box, S., Bishop, C.M., Hunt, H. (2009). *Estimating Dynamic and Aerodynamic Parameters of Passively Controlled High Power Rockets*
- Barrowman, J.S. & Barrowman, J.A. (1966). *The Theoretical Prediction of the Center of Pressure*. NARAM-8
- Martins, J.T. (2017). *On the Trajectory of a Tumbling Body*. IST Lisboa
- Cornell MAE 5070: *Dynamical Equations for Flight Vehicles*

---

## 1. The Six Degrees of Freedom

A rigid body in free flight has exactly 6 independent degrees of freedom:

### Translational DOF (3)
| DOF | Coordinate | Description |
|-----|-----------|-------------|
| x | East (downrange) | Horizontal position |
| y | North (crossrange) | Horizontal position |
| z | Up (altitude) | Vertical position |

Velocity components in the body frame: **u** (axial), **v** (lateral), **w** (normal to centerline).

### Rotational DOF (3)
| DOF | Symbol | Body-frame rate | Description |
|-----|--------|----------------|-------------|
| Roll | φ | p | Rotation about the rocket's longitudinal axis |
| Pitch | θ | q | Nose-up/nose-down rotation |
| Yaw | ψ | r | Left/right nose rotation |

**Angle of attack:** `α = arctan(w/u)` (pitch plane only) or `α_total = arccos(v_axis · v_vel / |v|)`

**Critical FAA relevance:** A 3-DOF model assumes α = 0 always. A 6-DOF model computes actual attitude separately from the velocity vector, capturing weathercocking, oscillations, and tumbling.

---

## 2. Equations of Motion

### 2.1 Coordinate Systems

**Inertial frame A:** Origin at launch site, axes (East, North, Up). Position **r** = (x, y, z).

**Body-fixed frame B:** Origin at CG. Axis b₃ points along nose direction. Angular velocity **ω** = (ω₁, ω₂, ω₃) in B.

### 2.2 Translational Equations (Body Frame with Rotation)

```
m(du/dt) = F_x + m(rv - qw)
m(dv/dt) = F_y + m(pw - ru)
m(dw/dt) = F_z + m(qu - pv)
```

Where (u,v,w) = velocity in body frame, (p,q,r) = angular rates in body frame, (F_x,F_y,F_z) = total applied forces in body frame.

### 2.3 Euler Moment Equations (Rotational)

For a rigid body about its CG, principal axes assumed:
```
I_xx · dp/dt = M_x + (I_yy - I_zz) · q · r
I_yy · dq/dt = M_y + (I_zz - I_xx) · p · r
I_zz · dr/dt = M_z + (I_xx - I_yy) · p · q
```

Variables:
- **I_xx, I_yy** = pitch/yaw moment of inertia [kg·m²] (large for slender rockets)
- **I_zz** = roll moment of inertia [kg·m²] (small; for HPR ~0.001 vs ~0.5 kg·m²)
- **(p, q, r)** = roll, pitch, yaw rates [rad/s]
- **(M_x, M_y, M_z)** = applied aerodynamic + thrust moments [N·m]

For an axisymmetric rocket: I_xx = I_yy (by symmetry). Roll dynamics nearly decouple from pitch/yaw.

### 2.4 Attitude Representation: Euler Angles vs Quaternions

#### Euler Angles
Kinematic equations (body rates → Euler angle rates):
```
dφ/dt = p + (q·sin(φ) + r·cos(φ)) · tan(θ)
dθ/dt = q·cos(φ) - r·sin(φ)
dψ/dt = (q·sin(φ) + r·cos(φ)) / cos(θ)
```

**Fatal problem — Gimbal Lock:** When θ = ±90° (vertical flight), `1/cos(θ)` is singular. This occurs during every normal rocket launch. Euler angles **cannot** be used as primary integration variables in a rocket 6-DOF simulation.

#### Quaternions (Preferred)

Quaternion **q** = (e₀, e₁, e₂, e₃), constraint: e₀² + e₁² + e₂² + e₃² = 1

Rotation matrix (body ← inertial):
```
T = [ e₀²+e₁²-e₂²-e₃²    2(e₁e₂+e₀e₃)      2(e₁e₃-e₀e₂)  ]
    [ 2(e₁e₂-e₀e₃)        e₀²-e₁²+e₂²-e₃²   2(e₂e₃+e₀e₁)  ]
    [ 2(e₁e₃+e₀e₂)        2(e₂e₃-e₀e₁)      e₀²-e₁²-e₂²+e₃² ]
```

Quaternion kinematic ODEs (no singularity):
```
de₀/dt = -(1/2)(ω₁·e₁ + ω₂·e₂ + ω₃·e₃)
de₁/dt =  (1/2)(ω₁·e₀ + ω₃·e₂ - ω₂·e₃)
de₂/dt =  (1/2)(ω₂·e₀ - ω₃·e₁ + ω₁·e₃)
de₃/dt =  (1/2)(ω₃·e₀ + ω₂·e₁ - ω₁·e₂)
```

**Both OpenRocket and RocketPy use quaternions** as the integration variables. Euler angles are only computed for output display after the fact.

### 2.5 State-Space Form (13 States)

Full 6-DOF state vector (as used by RocketPy):
```
u = [x, y, z, vx, vy, vz, e₀, e₁, e₂, e₃, ω₁, ω₂, ω₃]ᵀ
```
Integrated via RK4 or RK45. The derivative du/dt is computed each timestep from force and moment models.

---

## 3. Stability Derivatives

### 3.1 Reference Quantities

Non-dimensionalization:
- Reference area: `A_ref = π·d²/4` where d = body diameter [m²]
- Reference length: `L_ref = d` (body diameter) [m]
- Dynamic pressure: `q̄ = ½ρV²` [Pa]

### 3.2 Normal Force Coefficient Derivative (C_Nα)

```
C_N = C_Nα · α    (small angle approximation)
C_Nα = ∂C_N/∂α   [rad⁻¹]
```

**Physical meaning:** How much normal (side) force is generated per radian of AoA. Higher C_Nα = stronger restoring force = more stable rocket.

### 3.3 Barrowman Equations for C_Nα and CP Location

Barrowman (NASA, 1967) provides closed-form equations for slender finned vehicles at subsonic speed and small AoA.

**Nose cone:**
```
(C_Nα)_nose = 2              (all nose cone shapes)
X_nose = 0.466·L_N           (ogive)
X_nose = 0.667·L_N           (conical)
```
L_N = nose cone length measured from tip.

**Conical transition:**
```
(C_Nα)_trans = 2·[(d_R/d)² - (d_F/d)²]
X_trans = X_P + (L_T/3)·[1 + (1 - d_F/d_R)/(1 - (d_F/d_R)²)]
```

**Fin set (N fins):**
```
(C_Nα)_fins = (4·N·(s/d)²) / (1 + √(1 + (2·L_F/(C_R+C_T))²)) · (1 + R/(s+R))
```

**Total CP:**
```
X_CP = (Σ (C_Nα)_i · X_i) / C_Nα_total
```

**Stability Margin:**
```
SM = (X_CP - X_CG) / d    [calibers]
```

**Barrowman limitations:** Subsonic only (Ma < ~0.8), small AoA (< ~10°), no canards.

### 3.4 Static Pitching Moment Coefficient

```
C_mα = -C_Nα · (X_CP - X_CG) / d
```
Negative C_mα = statically stable (CP aft of CG).

### 3.5 Pitch Damping Coefficient (C_mq)

Defined as: `C_mq = ∂C_m/∂(q·d/2V)` where q is pitch rate [rad/s].

**Physical origin:** As the rocket pitches at rate q, a fin section at distance x from CG experiences additional AoA:
```
Δα(x) = q · (x - X_CG) / V
```

**Estimation (integrated fin contribution):**
```
C_mq ≈ -2/V · Σ_fins [(C_Nα)_fin · (x_fin - X_CG)²] · (1/(A_ref · d))
```

**Typical values:** C_mq ≈ -10 to -50 rad⁻¹ (negative = damping).

---

## 4. Aerodynamic Moments Summary

| Moment | Coefficient | Physical Source | FAA Relevance |
|--------|------------|----------------|---------------|
| Static pitching moment | C_mα · α | Normal force offset from CG | Determines if rocket is stable |
| Pitch damping | C_mq · (q̄d/2V) | Fins/body opposing pitch rate | Controls oscillation amplitude |
| Roll forcing | C_lf · δ | Fin cant angle | Usually zero for HPR |
| Roll damping | C_ld · ω_roll | Fins opposing spin | Decoupled for axisymmetric rockets |

Total pitch moment about CG:
```
M_pitch = q̄ · A_ref · d · [C_mα · α + C_mq · (ω_pitch · d / 2V)]
```

---

## 5. Tumbling Body Ballistics (Most Critical for Multi-Stage)

### 5.1 Why Tumbling Matters

A spent rocket stage after separation typically:
- Has net upward velocity
- Has no active stabilization
- May have CP forward of CG (unstable: CG = heavy nozzle end)

Result: Stage tumbles (alternates nose-first / base-first), dramatically increasing effective drag.

### 5.2 Two Modes of Tumbling (Martins 2017)

**Oscillatory Mode (OM):** Rocket oscillates around equilibrium AoA.
- Unstable config (CP forward): equilibrium at α = 90° (broadside)

**Full Rotation Mode (FRM) / Tumbling:** Continuous end-over-end rotation. Occurs when initial angular velocity exceeds the restoring moment, or when the rocket is statically unstable.

**Key finding:** CP–CG sign is the primary determinant. Initial AoA and angular velocity determine which mode is entered.

### 5.3 Effective Drag of a Tumbling Body

| Configuration | C_D | A_ref |
|---------------|-----|-------|
| Nose-forward (streamlined) | 0.3–0.6 | π·d²/4 |
| Broadside (α = 90°) | 1.0–1.3 | L·d |
| Full tumble (time-average) | ~0.8–1.0 | L·d (recommended) |

**Conservative engineering approximation for FAA hazard zone:**
```
F_drag_tumble = ½ · ρ · V² · C_D_eff · A_broadside
A_broadside = L_body · d_body
C_D_eff ≈ 0.8–1.0 (on broadside area)
```

This is approximately 3–5× higher drag than the same rocket flying nose-first.

### 5.4 Terminal Velocity

```
V_terminal = sqrt(2·m·g / (ρ · C_D_eff · A_eff))
```

**Example (typical HPR two-stage first stage):**
- m = 0.5 kg, L = 0.6 m, d = 0.076 m
- A_broadside = 0.046 m²
- At sea level, V_terminal ≈ 18 m/s (~40 mph)

### 5.5 FAA-Conservative Model for Spent Stage

**Recommended procedure for multi-stage hazard zone calculator:**

1. At stage separation, capture: position (x,y,z), velocity vector (vx,vy,vz), stage mass
2. From rocket geometry: compute L_stage, d_stage
3. Simulate ballistic descent with tumbling drag:
   ```
   A_eff = L_stage × d_stage    (broadside area)
   C_D = 1.0 (nominal) with ±30% Monte Carlo uncertainty
   F_drag = ½ · ρ(h) · V² · C_D · A_eff
   ```
4. Apply wind drift during descent (wind × time_of_flight)
5. Output: hazard ellipse for spent stage (separate from main rocket)

**Key insight:** A tumbling spent stage may land *closer* to the launch site than the main rocket (due to high drag), but with greater wind-driven uncertainty because it spends more time aloft.

---

## 6. 3-DOF vs 6-DOF for FAA Hazard Analysis

### 6.1 What 3-DOF Cannot Model

| Capability | 3-DOF | 6-DOF |
|-----------|-------|-------|
| Translational trajectory | Yes | Yes |
| Weathercocking into wind | No (or empirical) | Yes |
| Pitch/yaw oscillations | No | Yes |
| Stability margin assessment | No | Yes |
| Tumbling spent stage | No | Approximate |
| Unstable flight detection | No | Yes |

### 6.2 Accuracy Impact on Landing Zone

**RocketPy documented result:** 3-DOF achieves ~1.5% error in apogee and range for a stable rocket in moderate wind.

**Cases where 6-DOF diverges significantly from 3-DOF:**

| Scenario | 3-DOF Error | Notes |
|----------|-------------|-------|
| Stable rocket, calm conditions | < 2% | 3-DOF is adequate |
| Stable rocket, strong wind (>15 mph) | 5–15% | Weathercocking shifts impact |
| Marginally stable (SM < 1 caliber) | Large | 3-DOF misses oscillation growth |
| Spent stage (tumbling) | Cannot model | Separate model required |

### 6.3 Recommendation for FAA Hazard Zone Calculator

**The main rocket:** 3-DOF with Monte Carlo wind variation is adequate for hazard zone bounds. The ~5–15% accuracy improvement from 6-DOF is not significant relative to other uncertainties.

**Spent stages:** 3-DOF with tumbling drag model is the priority gap. This is not an accuracy improvement — it is a fundamentally different physics regime that 3-DOF cannot handle at all.

---

## 7. Implementation Architecture (Multi-Stage FAA Calculator)

```
STAGE 1 ACTIVE PHASE (powered + coast to separation):
  → Current 3-DOF model with wind Monte Carlo
  → Outputs: separation (x,y,z,vx,vy,vz) for each trial

SPENT STAGE 1 (post-separation):
  → New: tumbling ballistics module
  → 3-DOF + tumbling drag (C_D = 1.0 on broadside area)
  → Wind drift during descent
  → Monte Carlo over C_D uncertainty (±30%)
  → Output: Stage 1 hazard ellipse (SEPARATE from Stage 2)

STAGE 2 ACTIVE PHASE:
  → Current 3-DOF model, starting from separation state
  → Output: Stage 2 impact hazard ellipse

COMBINED FAA HAZARD ZONE:
  → Union of Stage 1 tumbling zone + Stage 2 impact zone
  → Apply 1500 ft AGL floor rule (per §101.25(g))
```

### Additional Inputs Required for 6-DOF

| Parameter | How to Obtain |
|-----------|--------------|
| C_Nα | Barrowman equations |
| X_CP | Barrowman equations |
| C_mq | Estimated from fin geometry |
| I_xx = I_yy | Geometric calculation (cylinders/cones stack) |
| I_zz | Geometric calculation (small) |

---

## 8. Key References

1. **Barrowman, J.S. (1967).** *The Practical Calculation of the Aerodynamic Characteristics of Slender Finned Vehicles.* NASA/NTRS Record 20010047838.

2. **Niskanen, S. (2013).** *OpenRocket Technical Documentation v13.05.* https://openrocket.sourceforge.net/techdoc.pdf. Complete 6-DOF simulation: quaternions, pitch damping (§3.2.3), tumbling bodies (§3.5).

3. **Box, S., Bishop, C.M., Hunt, H. (2009).** *Estimating the Dynamic and Aerodynamic Parameters of Passively Controlled High Power Rockets.* https://cambridgerocket.sourceforge.net/AerodynamicCoefficients.pdf.

4. **RocketPy Team (2024).** *Equations of Motion v0.* https://docs.rocketpy.org/en/latest/technical/equations_of_motion.html.

5. **Martins, J.T. (2017).** *On the Trajectory of a Tumbling Body.* IST Lisboa. https://fenix.tecnico.ulisboa.pt/downloadFile/844820067125395/ExtendedAbstract.pdf.

6. **Cornell MAE 5070.** *Dynamical Equations for Flight Vehicles.* https://courses.cit.cornell.edu/mae5070/DynamicEquations.pdf.

7. **14 CFR Part 417, Appendix C.** FAA requirements for unguided suborbital vehicle flight safety analysis.

---

## 9. Quick-Reference Equation Card

### 6-DOF State Equations
```
Position:   dx/dt = vx,  dy/dt = vy,  dz/dt = vz
Velocity:   dv/dt = (1/m)·[T(q)·F_body] - [0,0,g]ᵀ
Quaternion: de₀/dt = -(1/2)(ω₁e₁ + ω₂e₂ + ω₃e₃)
            de₁/dt =  (1/2)(ω₁e₀ + ω₃e₂ - ω₂e₃)
            de₂/dt =  (1/2)(ω₂e₀ - ω₃e₁ + ω₁e₃)
            de₃/dt =  (1/2)(ω₃e₀ + ω₂e₁ - ω₁e₂)
Angular:    dω₁/dt = (M₁ - (I₂₂-I₃₃)ω₂ω₃) / I₁₁
            dω₂/dt = (M₂ - (I₃₃-I₁₁)ω₁ω₃) / I₂₂
            dω₃/dt = (M₃ - (I₁₁-I₂₂)ω₁ω₂) / I₃₃
```

### Tumbling Drag
```
A_broadside = L_body · d_body
C_D_tumble ≈ 0.8–1.0  (on A_broadside)
V_terminal = sqrt(2·m·g / (ρ·C_D·A_eff))
FAA conservative: use C_D = 1.0 with ±30% Monte Carlo
```

---

*Last updated: 2026-04-22. Research by background agent (session 9), written by main agent due to permission constraints on subagent writes.*
