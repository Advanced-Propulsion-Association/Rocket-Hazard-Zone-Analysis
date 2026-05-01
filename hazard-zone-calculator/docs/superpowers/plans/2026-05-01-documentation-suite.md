# Documentation Suite Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Write `docs/manual.md`, `docs/developer.md`, an updated `README.md`, `docs/pdf/waiver-template.md`, and `docs/pdf/build.sh` — a complete documentation suite for the FAA Hobby Rocket Hazard Zone Calculator.

**Architecture:** Two source Markdown files are the single source of truth. Three derived outputs (GitHub README, methodology PDF, per-waiver PDF) are produced from them via Pandoc. All documents live in the `hazard-zone-calculator/` git repo.

**Tech Stack:** Markdown, Pandoc (for PDF output), bash script for build automation.

---

## Files to Create / Modify

| File | Action | Purpose |
|------|--------|---------|
| `docs/manual.md` | Create | Complete user + methodology manual |
| `docs/developer.md` | Create | Developer + contributor guide |
| `README.md` | Create | Condensed GitHub summary |
| `docs/pdf/waiver-template.md` | Create | Per-waiver FAA fill-in template |
| `docs/pdf/build.sh` | Create | Pandoc PDF build script |

Project root: `C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator\`

---

## Task 1: Write `docs/manual.md` — §1 Overview + §2 Getting Started

**Files:**
- Create: `docs/manual.md`

- [ ] **Step 1: Write §1 and §2**

Create `docs/manual.md` with the following exact content:

````markdown
# FAA Hobby Rocket Hazard Zone Calculator — User & Methodology Manual

**Version:** see `package.json`
**Organization:** Advanced Propulsion Association
**Document type:** User Manual and Methodology Reference

---

## Table of Contents

1. [Overview](#1-overview)
2. [Getting Started](#2-getting-started)
3. [Tier 1: Apogee-Only Analysis](#3-tier-1-apogee-only-analysis)
4. [Tier 2: Basic Simulation](#4-tier-2-basic-simulation)
5. [Tier 3: Full Barrowman Analysis](#5-tier-3-full-barrowman-analysis)
6. [Results Interpretation](#6-results-interpretation)
7. [Regulatory Context](#7-regulatory-context)
8. [Technical Reference](#8-technical-reference)

---

## 1. Overview

### 1.1 What This Tool Does

The FAA Hobby Rocket Hazard Zone Calculator computes the minimum safe exclusion radius around a hobby rocket launch site. Given a rocket's geometry, propulsion data, and launch conditions, it simulates the rocket's trajectory across a sweep of worst-case launch angles and returns the maximum downrange distance any piece of the rocket could travel from the launch pad. That distance is the **hazard zone radius** — the area that must be kept clear of uninvolved persons during flight.

This tool was developed to replace the FAA's legacy TAOS (Trajectory Analysis for Orbital Safing) tool, a 1995 Sandia National Laboratories program that is no longer publicly distributed and requires outdated hardware to run. The hazard zone calculator replicates TAOS's conservative point-mass trajectory approach in a modern web interface, producing results consistent with FAA Order 8900.1 Volume 3 Chapter 6 methodology.

### 1.2 When to Use Each Tier

| Tier | When to use | Required inputs |
|------|-------------|-----------------|
| **Tier 1** | Quick estimate; low-power rockets; no motor data | Expected apogee only |
| **Tier 2** | Standard analysis; rocket geometry and motor are known | Body dimensions, motor, mass |
| **Tier 3** | High-power; FAA waiver applications; M-class and above | Full geometry including nose cone, fins, staging |

For FAA §101.25 waiver applications, **Tier 3 is recommended** for all high-power rockets. Tier 1 is a conservative upper bound suitable for preliminary planning. Tier 2 is appropriate for mid-power rockets where detailed fin geometry is not available.

### 1.3 Conservative Assumptions

The tool deliberately overestimates hazard zone size. Every assumption is chosen to produce a **larger** exclusion radius, not a smaller one:

- The rocket is assumed to remain nose-forward throughout descent (less drag = more range than a tumbling rocket).
- Launch angles from 0° (vertical) to 20° from vertical are all simulated; the worst case is used.
- A 20 MPH headwind is applied throughout flight (consistent with NAR/Tripoli site safety rules).
- Subsonic drag uses the lowest plausible coefficient for the rocket's geometry.

These assumptions ensure the computed hazard zone is never smaller than the actual danger area.

### 1.4 Limitations

- **3-DOF point-mass model.** The simulation does not model pitch, roll, or yaw. The rocket is treated as a particle with aerodynamic drag.
- **Standard atmosphere only.** Density, temperature, and pressure follow the 1976 US Standard Atmosphere. Site-specific weather (humidity, temperature inversion) is not modeled.
- **Constant headwind.** Wind speed is applied as a constant horizontal velocity offset. Wind shear, gusts, and crosswinds are not modeled.
- **Single-axis trajectory.** All simulations are 2D (downrange × altitude). Lateral dispersion is not computed.

---

## 2. Getting Started

### 2.1 Accessing the Tool

The calculator is a web application hosted at the Advanced Propulsion Association's GitHub Pages deployment. No installation is required — open the URL in any modern browser.

**Local setup (for contributors):**

```bash
git clone https://github.com/Advanced-Propulsion-Association/Hobby-Rocket-Hazard-Zone-Analysis.git
cd hazard-zone-calculator
npm install
npm run dev
```

Open `http://localhost:5173` in your browser.

### 2.2 Choosing Your Tier

Start at the Tier Selector panel. If you have an OpenRocket `.ork` file for your rocket, upload it — the tool will parse it and pre-fill all available fields, then suggest the appropriate tier based on what data was found.

If you are entering data manually, work through the tier decision table in §1.2.

### 2.3 Uploading an OpenRocket File

Click **Upload .ork File** and select your OpenRocket design file. The parser extracts:
- Body diameter and length
- Nose cone type
- Fin geometry (span, root chord, tip chord)
- Motor selection (matched against ThrustCurve.org database)
- Propellant and dry mass
- Nozzle exit diameter

After upload, review all pre-filled fields before running the simulation. Motor data in particular should be verified — if the motor in your `.ork` file is not in the tool's database, you will need to select a substitute manually.

### 2.4 Browser Compatibility

The tool requires a modern browser with JavaScript enabled. Tested on Chrome 120+, Firefox 121+, Safari 17+, and Edge 120+. Internet Explorer is not supported.
````

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/manual.md
git commit -m "docs: add manual §1 Overview + §2 Getting Started"
```

---

## Task 2: Write `docs/manual.md` — §3 Tier 1 + §4 Tier 2

**Files:**
- Modify: `docs/manual.md` (append)

- [ ] **Step 1: Append §3 and §4**

Append the following to `docs/manual.md`:

````markdown
---

## 3. Tier 1: Apogee-Only Analysis

### 3.1 Input Fields

| Field | Description | Units |
|-------|-------------|-------|
| Expected Apogee | Peak altitude above ground level | feet AGL |
| Site Elevation | Launch site elevation above sea level | feet MSL |

The expected apogee is the only required input. Use the apogee from your OpenRocket simulation, RASAero II prediction, or motor manufacturer's stated altitude for your airframe.

### 3.2 How the Hazard Zone Is Computed

Tier 1 applies a quarter-altitude rule: the hazard zone radius is set to one quarter of the expected apogee. This is the formula used by NAR and Tripoli for site safety planning, and it is intentionally conservative — it assumes the rocket travels horizontally for a full quarter of its apogee altitude before impacting the ground.

For very high apogees (above 50,000 ft AGL), Tier 1 results should be treated as preliminary estimates only. At those altitudes, aerodynamic and atmospheric effects dominate in ways that a simple altitude-fraction rule does not capture well. Use Tier 2 or Tier 3 instead.

### 3.3 When Tier 1 Is Sufficient

Tier 1 is appropriate when:
- The rocket is low-power (A through D motors) and the site is a standard hobby club field.
- Motor data is not yet available (preliminary site assessment).
- A quick conservative upper bound is needed for initial planning.

Tier 1 is **not** appropriate for FAA waiver applications involving high-power rockets. For those, use Tier 3.

---

## 4. Tier 2: Basic Simulation

### 4.1 Input Fields

**Body geometry:**

| Field | Description | Units |
|-------|-------------|-------|
| Body Diameter | Maximum outer diameter of airframe | inches |
| Body Length | Total length from nose tip to nozzle exit | inches |
| Dry Mass | Airframe mass without propellant | lbs |

**Motor:**

Select from the built-in ThrustCurve.org database. The tool supports RASP format thrust curves. Propellant mass, total impulse, and burn time are loaded automatically from the selected motor.

**Launch conditions:**

| Field | Description | Default |
|-------|-------------|---------|
| Launch Angle | Degrees from vertical | 0° (vertical) |
| Headwind | Surface wind speed opposing flight | 0 MPH |
| Site Elevation | Launch pad altitude MSL | 0 ft |
| Site Temperature | Ambient temperature at launch | 59°F (288 K) |

**Note on headwind:** The tool simulates the headwind you enter **plus** the worst-case wind from the angle sweep. You do not need to enter 20 MPH manually — entering your actual wind condition produces a conservative result for your specific launch day. See §8.4 for how the sweep works.

### 4.2 Multi-Stage Configuration

Toggle **Multi-Stage** to enable two-stage input. Provide booster and sustainer parameters separately:
- Booster: body dimensions, motor, propellant mass
- Sustainer: body dimensions, motor, ignition delay after booster burnout
- The tool computes separate impact footprints for the booster (tumbling descent) and sustainer (nose-forward descent) and returns the maximum of the two.

### 4.3 Reading the Results

**Hazard zone radius:** The worst-case impact distance from the launch pad across all simulated trajectories. This is the exclusion radius you report to the FAA.

**Trajectory sweep plot:** Each line in the plot represents a single simulated trajectory at a specific launch angle (0°–20° in 1° steps). The outermost line's endpoint is the hazard zone radius.

**NAR/Tripoli comparison:** The results panel displays the NAR/Tripoli quarter-altitude estimate alongside the simulation result. If the simulation result exceeds the quarter-altitude estimate, the simulation result governs.
````

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/manual.md
git commit -m "docs: add manual §3 Tier 1 + §4 Tier 2"
```

---

## Task 3: Write `docs/manual.md` — §5 Tier 3 + §6 Results

**Files:**
- Modify: `docs/manual.md` (append)

- [ ] **Step 1: Append §5 and §6**

Append the following to `docs/manual.md`:

````markdown
---

## 5. Tier 3: Full Barrowman Analysis

### 5.1 Additional Inputs

Tier 3 adds detailed geometry on top of all Tier 2 inputs:

**Nose cone:**

| Field | Options |
|-------|---------|
| Nose Cone Type | Tangent Ogive, Conical, Parabolic, Von Kármán (Haack) |
| Nose Length | Length of nose cone from tip to shoulder | inches |

The nose cone type affects the drag model. Tangent ogive noses use a physics-based wave drag correction at transonic speeds (see §8.3.3). Conical noses include a pressure drag term. Parabolic and Haack noses use the standard Mach correction.

**Fins:**

| Field | Description | Units |
|-------|-------------|-------|
| Number of Fins | Typically 3 or 4 | — |
| Root Chord | Length of fin at body junction | inches |
| Tip Chord | Length of fin at outer edge | inches |
| Semi-Span | Distance from body to fin tip | inches |

**Motor (extended):**

| Field | Description |
|-------|-------------|
| Nozzle Exit Diameter | Nozzle exit diameter for thrust correction | inches |

The nozzle exit diameter enables ambient pressure thrust correction: at altitude, the nozzle operates at lower ambient pressure than at sea level, increasing effective thrust. For most hobby rockets this correction is small (1–3%) but it is included for completeness.

### 5.2 OpenRocket Cross-Validation Workflow

Tier 3 includes an OpenRocket apogee validation field. Enter the apogee from your OpenRocket simulation. After running the Tier 3 analysis, the results panel shows the percent difference between the tool's simulated apogee and the OpenRocket reference.

A difference within ±10% indicates the tool's drag model is well-calibrated to your rocket. A larger difference suggests the rocket has unusual geometry (very high fineness ratio, unusual nose shape, or clustering) that may require a manual drag override.

The tool's batch validation against 136 IREC 2026 competition rockets achieves 100% within ±20% and approximately 73% within ±10%. M-class and O-class rockets with tangent ogive noses typically achieve ±5–8%.

### 5.3 When Tier 3 Is Required

Use Tier 3 when:
- Filing an FAA §101.25 waiver application for a high-power rocket.
- The rocket is M-class or above.
- Multi-stage flight is involved.
- The launch site requires a formal hazard analysis document.

---

## 6. Results Interpretation

### 6.1 Hazard Zone Radius

The hazard zone radius is the single output number the tool is designed to produce. It is defined as:

> **The maximum straight-line distance from the launch pad to any simulated impact point, across all launch angles from 0° to 20° from vertical, with a headwind applied.**

This number is the **exclusion radius**: all uninvolved persons must be outside this radius from the launch pad during flight.

Report this number in feet. For FAA waiver applications, include it in the analysis section of your waiver package alongside the methodology PDF (see §7.3).

### 6.2 What the Trajectory Plot Shows

Each curve in the trajectory sweep plot is one simulated flight at a specific launch angle. The horizontal axis is downrange distance (feet); the vertical axis is altitude AGL (feet). The cluster of curves sweeping outward from the origin represents the full range of worst-case trajectories.

The outermost curve's landing point defines the hazard zone radius. Note that vertical launches (0°) achieve the highest apogee but land close to the pad; shallow launches (15°–20°) have lower apogees but longer horizontal range — the hazard radius is typically set by the 15°–20° trajectories for high-thrust rockets.

### 6.3 Exporting Results

**Print view:** Click **Print / Export PDF** to open a formatted two-page report. The first page shows the hazard zone summary, rocket parameters, and regulatory comparison. The second page shows the trajectory sweep plot. Print to PDF using your browser's print dialog.

**For waiver applications:** Use the Print view output as your analysis attachment. Also attach the methodology PDF (see §7.3) as supporting documentation on first submittal to establish the tool as an acceptable analysis method.
````

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/manual.md
git commit -m "docs: add manual §5 Tier 3 + §6 Results Interpretation"
```

---

## Task 4: Write `docs/manual.md` — §7 Regulatory Context

**Files:**
- Modify: `docs/manual.md` (append)

- [ ] **Step 1: Append §7**

Append the following to `docs/manual.md`:

````markdown
---

## 7. Regulatory Context

### 7.1 FAA Waiver Requirements — 14 CFR §101.25

Hobby rockets operating at altitudes above 400 ft AGL or with motors above a certain total impulse threshold require an FAA Certificate of Waiver or Authorization (COA). The specific thresholds are defined in 14 CFR §101.25:

- **§101.25(b):** A COA is required for any rocket with a total installed impulse exceeding 30,000 N·s (roughly O-class).
- **§101.25(g):** The minimum operating radius for any waivered launch site is **1,500 ft AGL** (457 m). Even if the computed hazard zone is smaller, the exclusion area must be at least this radius.
- **FAA Order 8900.1, Volume 3, Chapter 6:** Specifies the trajectory analysis methodology acceptable to the FAA for amateur rocket operations. This tool's methodology is consistent with Order 8900.1 guidance.

**Practical rule:** Report the **greater of** the computed hazard zone radius and 1,500 ft as your exclusion radius in any waiver application.

### 7.2 NAR/Tripoli Quarter-Altitude Rule

The National Association of Rocketry (NAR) and Tripoli Rocketry Association publish site safety codes that define minimum field sizes as a function of motor class and expected altitude. The commonly used rule is:

> **Minimum field radius = Expected apogee ÷ 4**

This tool displays this value in the results panel alongside the simulation-based hazard zone. The simulation-based result is generally more precise because it accounts for actual rocket geometry, motor thrust curve, and headwind. For high-power rockets at mid-range altitudes, the two values typically agree within 10–20%.

When the simulation result is **larger** than the quarter-altitude estimate, use the simulation result — it means your rocket's aerodynamics result in a longer range than the simple fraction suggests.

### 7.3 Using This Tool's Output in a Waiver Application

A complete hazard zone analysis package for an FAA waiver application should include:

1. **Analysis results page** (from the Print view): Shows hazard zone radius, rocket parameters, motor data, and the trajectory sweep diagram. Attach as Exhibit A to your waiver application.

2. **Methodology document** (`docs/pdf/methodology.pdf` from this repository): Explains how the simulation works, what assumptions are made, and which standards it follows. Submit once to establish the tool as an acceptable methodology. Reference it by name and date in subsequent applications.

3. **Per-waiver summary template** (`docs/pdf/waiver-template.pdf`): A fill-in template specific to each launch application. Contains applicant information, rocket parameters, the computed hazard zone radius, and a certification statement.

When submitting to your local FSDO for the first time, attach all three documents. For subsequent applications at the same site with the same tool version, the analysis results page and per-waiver template are sufficient — the methodology document only needs to be resubmitted if the tool version changes significantly.

### 7.4 Coordination with Site Owners

The computed hazard zone radius defines the minimum required exclusion area. Actual launch site requirements may impose additional constraints:

- Waivered launch sites issued by the FAA have a fixed waiver radius on the COA. Your computed hazard zone must fit within the waivered radius; if it does not, you cannot fly that rocket at that site without an amended COA.
- Range safety officers (RSOs) at clubs and launches may apply additional safety margins beyond the computed radius.
- ATC coordination may be required for flights into Class E, D, C, or B airspace regardless of the ground exclusion radius.
````

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/manual.md
git commit -m "docs: add manual §7 Regulatory Context"
```

---

## Task 5: Write `docs/manual.md` — §8 Technical Reference

**Files:**
- Modify: `docs/manual.md` (append)

Key facts to use verbatim (verified against source code):
- Mach correction (standard shapes — `cdMachCorrection` in `aerodynamics.ts`): flat below M=0.87; quadratic rise 0.87→1.0 peaking at 1.20×; linear decline 1.0→1.3 to 0.91×; power-law 1.055 × M^(−0.561) above M=1.3
- Mach correction (ogive — `cdMachCorrectionOgive`): flat below M=0.85; additive wave drag 0.85→1.10; Van Driest 1.055 × M^(−0.561) above M=1.10
- Wave drag (`ogiveWaveDragCD`): 0 below M=0.85; linear 0.025×(M−0.85)/0.20 for 0.85–1.05; plateau 0.025 for 1.05–1.20; 0.025×1.20/M above 1.20
- Skin friction: Cf = max(0.004, 0.005 × (3×10⁷/Re)^0.15)
- Base drag: 0.029 / sqrt(CD_friction_body) (Hoerner)
- Fin interference factor: 1.1; fin thickness ratio t/c = 0.05
- Atmosphere: G0=9.80665 m/s², R=287.058 J/(kg·K), γ=1.4; 8 ISA layers from 0–86,000 m; sea level: T=288.15 K, P=101,325 Pa
- Wind gradient: 1/7 power law (exponent 0.14) above 10 m AGL
- RK4 integrator, dtMax=0.05 s, maxTime=600 s
- Launch angle sweep: 0°–20° in 1° steps; surface wind up to 20 MPH

- [ ] **Step 1: Append §8 Technical Reference**

Append the following to `docs/manual.md`:

````markdown
---

## 8. Technical Reference

This appendix documents the simulation methodology in sufficient detail for independent validation. All values given are the exact constants used in the current version of the code.

### 8.1 Coordinate System and Equations of Motion

The simulation uses a 2D Cartesian coordinate system:

- **x** = downrange distance (horizontal, positive downwind)
- **z** = altitude AGL (positive up)

The state vector at each time step is:

```
[x, z, vx, vz, m]
```

where `vx` and `vz` are velocity components and `m` is the instantaneous total mass (decreasing during motor burn as propellant is consumed).

**Forces acting on the rocket:**

1. **Thrust (T):** Read from the motor's thrust curve at elapsed time `t`. Applied along the thrust axis (launch angle from vertical for single-stage; adjustable for upper stages). Ambient pressure correction is applied when nozzle exit area is known:

   ```
   T_corrected = T_thrust_curve + (P_sea_level − P_ambient) × A_nozzle_exit
   ```

2. **Aerodynamic drag (D):**

   ```
   D = ½ × ρ × v_rel² × A_ref × C_D(Mach)
   ```

   where `v_rel` is velocity relative to the air (accounting for headwind), `A_ref` is the body cross-sectional area, and `C_D` is the Mach-corrected drag coefficient.

3. **Gravity:** 9.80665 m/s² downward, constant throughout flight.

**Integration scheme:** 4th-order Runge-Kutta (RK4) with maximum time step `dt_max = 0.05 s`. The step is halved automatically near motor ignition and burnout to maintain accuracy during rapid thrust changes. Maximum simulation time is 600 s.

**Mass flow:** Propellant mass decreases linearly with instantaneous thrust during the burn:

```
dm/dt = −m_propellant × T(t) / I_total
```

where `I_total` is the total motor impulse (N·s).

### 8.2 Atmosphere Model

The tool uses the 1976 US Standard Atmosphere (ISA) with 8 piecewise layers. Sea-level reference conditions: T₀ = 288.15 K, P₀ = 101,325 Pa. Physical constants: g₀ = 9.80665 m/s², R = 287.058 J/(kg·K), γ = 1.400.

| Layer | Base alt (m) | Lapse rate (K/m) | Base T (K) | Base P (Pa) |
|-------|-------------|-----------------|------------|------------|
| Troposphere | 0 | −0.0065 | 288.15 | 101,325.0 |
| Tropopause | 11,000 | 0.0000 | 216.65 | 22,632.1 |
| Stratosphere 1 | 20,000 | +0.0010 | 216.65 | 5,474.89 |
| Stratosphere 2 | 32,000 | +0.0028 | 228.65 | 868.019 |
| Stratopause | 47,000 | 0.0000 | 270.65 | 110.906 |
| Mesosphere 1 | 51,000 | −0.0028 | 270.65 | 66.939 |
| Mesosphere 2 | 71,000 | −0.0020 | 214.65 | 3.956 |
| Mesopause | 86,000 | 0.0000 | 186.87 | 0.373 |

Temperature at altitude `h` within a layer: `T(h) = T_base + lapse × (h − h_base) + ΔT_site`

where `ΔT_site` is the offset between the actual site temperature and the ISA sea-level value (allows the tool to account for hot or cold launch days).

Pressure at altitude `h`:
- If lapse ≠ 0: `P(h) = P_base × (T_base / T(h))^(g₀ / (R × lapse))`
- If lapse = 0 (isothermal): `P(h) = P_base × exp(−g₀ × Δh / (R × T_base))`

Air density: `ρ = P / (R × T)`

Speed of sound: `a = sqrt(γ × R × T)` = 340.3 m/s at sea level ISA.

**Wind gradient:** Surface wind speed `W_s` is scaled with altitude using a 1/7 power law:

```
W(z) = W_s × (z / 10)^0.14   for z > 10 m
W(z) = W_s                    for z ≤ 10 m
```

### 8.3 Drag Model

#### 8.3.1 Subsonic Baseline — Barrowman Component Buildup

For Tier 3 inputs, the subsonic drag coefficient is computed from first-principles component contributions referenced to the body cross-sectional area A_ref = π(D/2)².

**Skin friction (turbulent flat plate):**

```
C_f = max(0.004,  0.005 × (3×10⁷ / Re_L)^0.15)
```

where the reference Reynolds number is `Re_L = v_ref × L / ν` with kinematic viscosity `ν = 1.5×10⁻⁵ m²/s`. The reference velocity is estimated as `v_ref = I_total / (m_total × 2)`.

Total skin friction drag:
```
C_D,friction = C_f × (A_wet,nose + A_wet,body) / A_ref
```

Nose cone wetted area is approximated as a cone slant surface. Body tube wetted area is the lateral surface of a cylinder.

**Base drag (Hoerner empirical correlation):**
```
C_D,base = 0.029 / sqrt(C_D,friction,body)
```

where `C_D,friction,body` is the skin friction contribution from the body tube only (excluding nose).

**Fin drag:**
```
C_D,fins = N_fins × (2 × A_fin / A_ref) × C_f × (1 + 2t/c) × 1.1
```

where `t/c = 0.05` (5% fin thickness ratio, typical plywood/fibreglass) and the 1.1 factor is Hoerner's fin-body interference correction.

**Nose cone pressure drag (subsonic only):**
- Tangent ogive, Von Kármán (Haack): `C_D,nose = 0` (smooth pressure recovery)
- Parabolic: `C_D,nose = 0.01` (slight blunt-tip correction)
- Conical: `C_D,nose = min(2 sin²θ_half, 0.05)` where `θ_half = arctan(R / L_nose)`

**Parasitic drag** (launch lugs, surface joints): constant `C_D,parasitic = 0.02`.

**Total subsonic CD:**
```
C_D,sub = C_D,friction + C_D,base + C_D,fins + C_D,nose + C_D,parasitic
```

For Tier 1 and Tier 2 (no detailed geometry), the subsonic CD is estimated from fineness ratio:
```
C_D,sub = 0.35 + 3.0 / (L/D)²
```

#### 8.3.2 Mach Correction — All Shapes Except Tangent Ogive

The following piecewise correction is applied to the subsonic CD for all nose cone types except tangent ogive:

| Mach range | Formula | Notes |
|-----------|---------|-------|
| M < 0.87 | `C_D = C_D,sub` | Subsonic baseline |
| 0.87 ≤ M < 1.0 | `C_D = C_D,sub × (1 + 0.20 × t²)` where `t = (M−0.87)/0.13` | Quadratic transonic rise |
| 1.0 ≤ M < 1.3 | `C_D = C_D,sub × (1.20 − 0.29 × t)` where `t = (M−1.0)/0.3` | Linear decline |
| M ≥ 1.3 | `C_D = C_D,sub × 1.055 × M^(−0.561)` | Van Driest supersonic decay |

Peak factor of 1.20× occurs at M = 1.0. At M = 2.0 the multiplier is approximately 0.71×.

Calibration source: OpenRocket session 8 data; aerodynamics_reference.md §12.1–12.4.

#### 8.3.3 Mach Correction — Tangent Ogive Noses (Wave Drag Model)

Tangent ogive noses produce near-zero subsonic pressure drag (the Barrowman sinφ = 0 result, confirmed by OpenRocket source, bug #2998). At transonic speeds, however, a real ogive nose generates wave drag that is independent of skin friction magnitude. The standard multiplicative correction mis-predicts this behavior, so a separate physics-based model is used.

**Wave drag increment** (absolute, not a multiplier):

| Mach range | Wave drag ΔC_D |
|-----------|----------------|
| M < 0.85 | 0 |
| 0.85 ≤ M < 1.05 | `0.025 × (M − 0.85) / 0.20` (Prandtl-Glauert linear onset) |
| 1.05 ≤ M < 1.20 | 0.025 (transonic plateau) |
| M ≥ 1.20 | `0.025 × 1.20 / M` (Ackeret 1/M supersonic decay) |

Peak wave drag ΔC_D = 0.025, referenced to body cross-section (A_nose/A_ref = 1.0 for tangent ogive).

Source: NACA free-flight data, Stoney (1954).

**Combined ogive Mach correction:**

| Mach range | Formula |
|-----------|---------|
| M < 0.85 | `C_D = C_D,sub` |
| 0.85 ≤ M ≤ 1.10 | `C_D = C_D,sub + ΔC_D,wave` |
| M > 1.10 | `C_D = C_D,sub × 1.055 × M^(−0.561) + ΔC_D,wave` |

The transition at M = 1.10 is smooth: the Van Driest multiplier evaluates to approximately 1.000 at M = 1.10, so no discontinuity is introduced.

### 8.4 Worst-Case Trajectory Sweep

To compute the hazard zone radius without knowing the actual launch angle, the tool simulates the full family of worst-case trajectories:

- **Launch angle sweep:** 0° (vertical) to 20° from vertical, in 1° increments (21 trajectories total). 20° is the maximum angle permitted by NAR/Tripoli site safety rules for high-power launches.
- **Headwind:** The user-specified surface wind speed is applied as a constant horizontal velocity offset opposing forward motion throughout the entire trajectory.
- **Hazard radius:** The maximum of all 21 trajectory impact distances from the launch pad.

The tool also simulates a pure vertical trajectory (0°) to extract the maximum apogee for comparison with the OpenRocket reference and NAR/Tripoli quarter-altitude rule.

### 8.5 Multi-Stage Simulation

For two-stage rockets, the tool runs four separate simulations and combines their impact footprints:

1. **S1 burn:** Booster fires from launch to burnout. State at burnout (position, velocity) is recorded.
2. **Booster ballistic:** Booster body descends from burnout altitude nose-forward (conservative — less drag). Impact point is recorded.
3. **Sustainer burn:** Upper stage fires from the recorded burnout state, with a configurable ignition delay. Descends to impact.
4. **Intermediate ballistic:** If staging occurs before booster burnout (rare), an intermediate body is simulated separately.

The hazard zone radius is the maximum impact distance across all four simulations.

### 8.6 Cited Sources

- Barrowman, J.S. (1967). *The Practical Calculation of the Aerodynamic Characteristics of Slender Finned Vehicles*. Master's thesis, Catholic University of America.
- Stoney, W.E. (1954). *Collection of Zero-Lift Drag Data on Bodies of Revolution from Free-Flight Investigations*. NACA Technical Note TN-3391.
- Niskanen, S. (2009). *OpenRocket Technical Documentation*. Helsinki University of Technology.
- FAA Order 8900.1, Volume 3, Chapter 6: *Air Traffic Organization Policy — Amateur Rocket Operations*.
- 14 CFR §101.25: *Operating limitations for Class 2-High Power Rockets and Class 3-Advanced High Power Rockets*.
- US Standard Atmosphere, 1976. NOAA/NASA/USAF. Washington, D.C.
- Hoerner, S.F. (1965). *Fluid-Dynamic Drag*. Published by the author.
````

- [ ] **Step 2: Verify key numeric values against source**

Read `src/simulation/aerodynamics.ts` and `src/simulation/barrowmanDrag.ts` and confirm:
- Mach correction breakpoints match: 0.87, 1.0, 1.3 (standard); 0.85, 1.05, 1.10, 1.20 (ogive)
- Van Driest exponents: 1.055, −0.561
- Wave drag peak: 0.025
- Cf formula: 0.005 × (3e7/Re)^0.15, floor 0.004
- Base drag: 0.029 / sqrt(...)
- Fin t/c: 0.05, interference: 1.1
- Parasitic: 0.02

Read `src/simulation/atmosphere.ts` and confirm atmosphere table values match §8.2.

If any value in the manual does not match the code, fix it before committing.

- [ ] **Step 3: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/manual.md
git commit -m "docs: add manual §8 Technical Reference appendix"
```

---

## Task 6: Write `docs/developer.md` — §1–4

**Files:**
- Create: `docs/developer.md`

Before writing, read these files to get accurate names and values:
- `src/simulation/trajectory.ts` lines 1–50 (SimConfig interface, coordinate system comment)
- `src/simulation/aerodynamics.ts` (function names)
- `src/types/index.ts` (interface names)
- `package.json` (Node version requirement, scripts)

- [ ] **Step 1: Create `docs/developer.md` with §1–4**

````markdown
# FAA Hazard Zone Calculator — Developer & Contributor Guide

---

## Table of Contents

1. [Project Overview](#1-project-overview)
2. [Dev Setup](#2-dev-setup)
3. [Repository Layout](#3-repository-layout)
4. [Simulation Pipeline](#4-simulation-pipeline)
5. [Drag Model Deep Dive](#5-drag-model-deep-dive)
6. [Adding / Updating Motors](#6-adding--updating-motors)
7. [Batch Stress Test](#7-batch-stress-test)
8. [Contribution Workflow](#8-contribution-workflow)
9. [Known Limitations & Future Work](#9-known-limitations--future-work)

---

## 1. Project Overview

The FAA Hazard Zone Calculator is a browser-based tool for computing rocket launch exclusion radii, built to replace the FAA's legacy TAOS (Trajectory Analysis for Orbital Safing) tool from 1995. It simulates hobby rocket trajectories using a 3-DOF point-mass RK4 integrator with a Barrowman-based drag model, then sweeps worst-case launch angles to find the maximum downrange impact distance.

**Tech stack:** React 18, TypeScript 5, Vite 5, Tailwind CSS 4. No backend — the simulation runs entirely in the browser.

---

## 2. Dev Setup

**Prerequisites:** Node 18 or later, npm 9 or later. Check with `node --version` and `npm --version`.

```bash
# Clone and install
git clone https://github.com/Advanced-Propulsion-Association/Hobby-Rocket-Hazard-Zone-Analysis.git
cd hazard-zone-calculator
npm install

# Start dev server (hot reload)
npm run dev
# Opens http://localhost:5173

# Production build
npm run build
# Output in dist/

# Preview production build locally
npm run preview

# Lint
npm run lint
```

**PDF build (optional):** Requires Pandoc and a LaTeX engine.
- Windows: Install [Pandoc](https://pandoc.org/) and [MiKTeX](https://miktex.org/). Run `docs/pdf/build.sh` from Git Bash or WSL.
- macOS: `brew install pandoc` and [MacTeX](https://www.tug.org/mactex/).
- Linux: `apt install pandoc texlive-xetex`

Then: `bash docs/pdf/build.sh` from the project root.

---

## 3. Repository Layout

```
hazard-zone-calculator/
├── src/
│   ├── components/          # React UI layer
│   │   ├── Tier1Form.tsx    # Apogee-only input form
│   │   ├── Tier2Form.tsx    # Full simulation input form (Tier 2 + Tier 3)
│   │   ├── TierSelector.tsx # Tier selection panel
│   │   ├── Results.tsx      # Hazard zone results display
│   │   ├── MapPanel.tsx     # Geographic map interface
│   │   ├── PrintView.tsx    # Print/PDF export layout
│   │   └── ErrorBoundary.tsx
│   ├── simulation/          # Physics engine (no React dependencies)
│   │   ├── trajectory.ts    # RK4 integrator, computeHazardZone(), computeMultiStageHazardZone()
│   │   ├── aerodynamics.ts  # cdMachCorrection(), cdMachCorrectionOgive(), motorClass()
│   │   ├── barrowmanDrag.ts # barrowmanDragBreakdown(), ogiveWaveDragCD()
│   │   ├── motor.ts         # Thrust curve parsing, thrustAt(), totalImpulse()
│   │   ├── atmosphere.ts    # 1976 ISA: airDensity(), speedOfSound(), windAtAltitude()
│   │   ├── orkParser.ts     # OpenRocket .ork file parser
│   │   └── orDataParser.ts  # OpenRocket flight data parser
│   ├── motors/
│   │   └── thrustcurve.ts   # ThrustCurve.org motor database (RASP format)
│   ├── types/
│   │   └── index.ts         # Shared TypeScript interfaces
│   └── main.tsx             # App entry point
├── openrocket/
│   ├── batch_test.mjs       # Batch stress test against IREC 2026 rockets
│   ├── batch_investigate.mjs# Outlier investigation tool
│   └── IREC_2026/           # .ork files (not committed, see README)
├── docs/
│   ├── manual.md            # User & methodology manual
│   ├── developer.md         # This file
│   ├── pdf/                 # PDF outputs and build script
│   └── superpowers/         # Development specs and plans (internal)
├── public/                  # Static assets
└── package.json
```

---

## 4. Simulation Pipeline

### 4.1 End-to-End Data Flow

A Tier 3 computation follows this path:

```
Tier2Form.tsx
  → builds HazardZoneInput (or MultiStageHazardZoneInput)
  → calls computeHazardZone() [or computeMultiStageHazardZone()]
     → loops launch angles 0°–20°
     → for each angle: calls simulate(SimConfig)
        → derivs() called by RK4 each step:
           → thrustAt(motor, t)            // motor.ts
           → airDensity(), speedOfSound()  // atmosphere.ts
           → cdMachCorrection() or         // aerodynamics.ts
             cdMachCorrectionOgive()
           → drag force, gravity → ax, az
        → records TrajectoryPoint[]
     → finds max impact distance
  → returns HazardZoneResult
Tier2Form.tsx → passes result to Results.tsx → renders hazard zone
```

### 4.2 Key Interfaces

Defined in `src/types/index.ts` and `src/simulation/trajectory.ts`:

| Interface | Where defined | Purpose |
|-----------|--------------|---------|
| `SimConfig` | `trajectory.ts` | Single simulation configuration (one angle, one stage) |
| `HazardZoneInput` | `trajectory.ts` | All inputs for a single-stage hazard zone computation |
| `MultiStageHazardZoneInput` | `trajectory.ts` | Inputs for a two-stage hazard zone computation |
| `HazardZoneResult` | `types/index.ts` | Output: radius, apogee, trajectory points |
| `TrajectoryPoint` | `types/index.ts` | Single time step: position, velocity, altitude, drag |
| `Motor` | `types/index.ts` | Thrust curve data and motor metadata |
| `StageConfig` | `types/index.ts` | Per-stage geometry for multi-stage sims |

### 4.3 Tier 1 Fast Path

`computeTier1HazardZone()` in `trajectory.ts` does not run the full RK4 integrator. It applies the NAR/Tripoli quarter-altitude formula directly:

```typescript
hazardRadius_ft = apogee_ft / 4;
```

No `SimConfig` or `simulate()` call is involved. This function is nose-type-agnostic and unaffected by the Mach correction changes.
````

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/developer.md
git commit -m "docs: add developer guide §1 Overview through §4 Simulation Pipeline"
```

---

## Task 7: Write `docs/developer.md` — §5–9

**Files:**
- Modify: `docs/developer.md` (append)

Before writing, read:
- `openrocket/batch_test.mjs` lines 1–50 (to get accurate description of what it does)
- `src/simulation/motor.ts` (function names for §6)

- [ ] **Step 1: Append §5–9 to `docs/developer.md`**

````markdown
---

## 5. Drag Model Deep Dive

### 5.1 Three-Layer Architecture

The drag model is split across three files with clear responsibilities:

- **`barrowmanDrag.ts`**: Subsonic component buildup from geometry. No Mach number input. Returns `C_D,sub`. Also exports `ogiveWaveDragCD(mach)` — the absolute wave drag increment for tangent ogive noses.
- **`aerodynamics.ts`**: Mach-dependent corrections applied on top of `C_D,sub`. Exports `cdMachCorrection()` (all shapes) and `cdMachCorrectionOgive()` (tangent ogive only).
- **`trajectory.ts`**: Routes to the correct correction based on `config.noseconeType`:

```typescript
const cd = (config.noseconeType === 'ogive')
  ? cdMachCorrectionOgive(cdSub, mach)
  : cdMachCorrection(cdSub, mach);
```

### 5.2 Adding a New Nose Cone Type

If you need a new shape (e.g., elliptical), follow these steps:

**Step 1:** Add the wave drag function to `barrowmanDrag.ts`:
```typescript
export function ellipticalWaveDragCD(mach: number): number {
  // implement physics here
}
```

**Step 2:** Add the combined Mach correction to `aerodynamics.ts`:
```typescript
import { ellipticalWaveDragCD } from './barrowmanDrag';

export function cdMachCorrectionElliptical(cdSubsonic: number, mach: number): number {
  const wave = ellipticalWaveDragCD(mach);
  if (mach < 0.90) return cdSubsonic;
  if (mach <= 1.10) return cdSubsonic + wave;
  return cdSubsonic * 1.055 * Math.pow(mach, -0.561) + wave;
}
```

**Step 3:** Add the routing branch in `trajectory.ts` inside `derivs()` (and in the recording block immediately after):
```typescript
const cd = config.noseconeType === 'ogive'      ? cdMachCorrectionOgive(cdSub, mach)
         : config.noseconeType === 'elliptical'  ? cdMachCorrectionElliptical(cdSub, mach)
         : cdMachCorrection(cdSub, mach);
```

**Step 4:** Add the nose cone type to the `BarrowmanDragInput` union in `barrowmanDrag.ts` and handle any pressure drag logic in `barrowmanDragBreakdown()`.

**Step 5:** Add the option to `Tier2Form.tsx` nose cone type selector.

### 5.3 Why the Ogive Model Is Different

The standard `cdMachCorrection` is a *multiplicative* correction (multiplies `C_D,sub` by a Mach-dependent factor). This is wrong for ogive noses at transonic speeds because ogive wave drag is an *absolute* increment independent of skin friction magnitude.

Large M-class rockets have very low skin friction (smooth, long airframe) → small `C_D,sub` → the multiplicative correction underpredicts wave drag. The fix is an additive term from `ogiveWaveDragCD()` that peaks at ΔC_D = 0.025 regardless of airframe size.

See `docs/manual.md §8.3.3` for the full physics derivation.

---

## 6. Adding / Updating Motors

### 6.1 ThrustCurve.org RASP Format

Motors are stored in `src/motors/thrustcurve.ts` as an array of `Motor` objects. Each motor has:

```typescript
interface Motor {
  name: string;
  manufacturer: string;
  totalImpulse_Ns: number;
  burnTime_s: number;
  propellantMassKg: number;
  thrustCurve: Array<[number, number]>;  // [time_s, thrust_N]
  nozzleExitAreaM2?: number;
}
```

The thrust curve is an array of `[time, thrust]` pairs in seconds and Newtons, matching the RASP `.eng` file format from ThrustCurve.org.

### 6.2 Adding a Motor

1. Download the `.eng` file from ThrustCurve.org for your motor.
2. Convert to the `Motor` object format. The `thrustCurve` array is taken directly from the `.eng` data points.
3. Compute `propellantMassKg` from the total impulse and specific impulse given in the `.eng` header, or use the manufacturer's stated propellant mass.
4. Add the object to the exported array in `src/motors/thrustcurve.ts`.
5. Run `npm run build` to confirm no TypeScript errors.

### 6.3 How Motors Are Used in Simulation

`motor.ts` exports three functions:
- `thrustAt(motor, t)` — interpolates thrust at time `t` from the thrust curve array.
- `totalImpulse(motor)` — sum of thrust × time intervals across the thrust curve.
- `burnTime(motor)` — time of last non-zero thrust point.

These are called inside `derivs()` in `trajectory.ts` at every RK4 sub-step.

---

## 7. Batch Stress Test

### 7.1 What It Does

`openrocket/batch_test.mjs` runs the hazard zone calculator against a corpus of 136 IREC 2026 competition rocket design files and compares the computed apogee against the OpenRocket reference apogee for each rocket. This validates the drag model across a wide range of rocket sizes, motor classes, and geometries.

**Success threshold:** 100% of rockets within ±20% apogee error; target ≥80% within ±10%.

### 7.2 Prerequisites

- Node 18+
- `.ork` files in `openrocket/IREC_2026/` (not committed to the repo — obtain from the IREC 2026 design file archive)
- A `batch_rockets.csv` file in `openrocket/` listing the rockets and their OR apogees

### 7.3 Running the Test

```bash
cd openrocket
node batch_test.mjs
```

Output includes a per-rocket table showing:
- Rocket filename
- OR apogee (ft)
- Simulated apogee (ft)
- Percent difference
- Tier (tier3, tier1_no_motor, etc.)

Summary at the end shows ±10% and ±20% cohort counts.

### 7.4 CD Overrides

For rockets with unusual geometry that causes systematic apogee error (e.g., extreme fineness ratio), a `cd_override` can be added to `openrocket/batch_overrides.json`:

```json
{
  "Dual Deploy.ork": { "cd_override": 0.45 }
}
```

CD overrides replace the Barrowman-computed drag with a fixed value for that specific rocket. Use `batch_investigate.mjs` to diagnose outliers before adding an override.

### 7.5 batch_investigate.mjs

Run with a specific `.ork` filename to get a detailed breakdown:

```bash
node batch_investigate.mjs "Dual Deploy.ork"
```

Shows the full Barrowman drag breakdown, Mach correction values at key speeds, and trajectory telemetry. Use this to determine whether an outlier is a drag model issue, a mass parsing issue, or a motor selection mismatch.

---

## 8. Contribution Workflow

### 8.1 Branching

Branch from `main`:

```bash
git checkout -b feat/your-feature-name
```

Naming conventions:
- `feat/` — new functionality
- `fix/` — bug fixes
- `chore/` — build, deps, non-functional changes
- `docs/` — documentation only
- `test/` — test additions

### 8.2 Commit Messages

Use conventional commit format:

```
feat: add elliptical nose cone wave drag model
fix: correct ogive Mach correction at M=1.10 boundary
docs: update manual §8.3.3 with Ackeret formula
chore: bump vite to 5.2
test: add M=1.1001 boundary case to wave drag verification
```

### 8.3 Before Opening a PR

```bash
npm run build    # must succeed with no TypeScript errors
npm run lint     # must pass with no errors
```

For physics changes, run the batch stress test and include before/after ±10% and ±20% cohort counts in the PR description.

### 8.4 Superpowers Workflow

Major changes (new features, physics model changes, significant refactors) go through the superpowers planning workflow:

1. **Brainstorm** (`/brainstorm`): Design the feature collaboratively. Output: `docs/superpowers/specs/YYYY-MM-DD-feature-design.md`.
2. **Plan** (automatic after brainstorm): Implementation plan with bite-sized tasks. Output: `docs/superpowers/plans/YYYY-MM-DD-feature.md`.
3. **Execute** (subagent-driven): Each task is implemented by a fresh subagent with spec and quality review between tasks.

Specs and plans live in `docs/superpowers/` and are committed to the repo for traceability.

---

## 9. Known Limitations & Future Work

| Limitation | Impact | Notes |
|-----------|--------|-------|
| 3-DOF point-mass model | No roll/pitch/yaw; tumbling descent not modeled for sustainer | Conservative: nose-forward gives more range than tumbling |
| Non-ogive wave drag | Conical, parabolic, Haack noses use multiplicative Mach correction, not a physics-based wave drag term | Acceptable for current accuracy targets; candidate for future work |
| Constant headwind | No wind shear or gusts | Wind gradient (1/7 power law) is modeled but gust variance is not |
| Standard atmosphere only | No humidity, no temperature inversion, no site-specific profiles | Conservative for most launch conditions |
| `Dual Deploy.ork` outlier | Fineness ratio ~26:1 causes Barrowman CD overestimate | Candidate for `cd_override` in `batch_overrides.json` |
| 2D trajectory only | No lateral dispersion (crosswind landing scatter) | Adds a safety margin — actual scatter is symmetric around the downrange axis |
````

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add docs/developer.md
git commit -m "docs: add developer guide §5 Drag Model through §9 Known Limitations"
```

---

## Task 8: Update `README.md`

**Files:**
- Create: `README.md` (at project root `hazard-zone-calculator/`)

Check if `README.md` already exists at the `hazard-zone-calculator/` root — if so, read it first. The existing parent-directory `README.md` at `C:\Users\bsoltes\FAA Hazard analysis\README.md` is outside the git repo and should be left alone.

- [ ] **Step 1: Write `README.md`**

```markdown
# FAA Hobby Rocket Hazard Zone Calculator

A web-based tool for computing FAA-compliant launch exclusion radii for hobby rockets. Replaces the legacy TAOS (Sandia Labs, 1995) tool with a modern browser interface running a 3-DOF RK4 trajectory simulation with Barrowman-based drag.

**[INSERT SCREENSHOT]**
*(Screenshot of the results panel — add before publishing)*

---

## What It Does

Given your rocket's geometry and motor, the calculator simulates trajectories across all worst-case launch angles (0°–20° from vertical) with a headwind applied, and returns the maximum downrange impact distance. That distance is the **hazard zone radius** — the exclusion area required around the launch pad.

---

## Three Input Tiers

**Tier 1 — Apogee only**
Enter the expected apogee. Returns the NAR/Tripoli quarter-altitude estimate. Fast, conservative, no motor data required. Suitable for preliminary planning and low-power rockets.

**Tier 2 — Basic simulation**
Enter body diameter, body length, dry mass, and motor. Runs the full RK4 simulation with fineness-ratio-based drag. Suitable for mid-power rockets and standard club field assessments.

**Tier 3 — Full Barrowman analysis**
Add nose cone type, fin geometry, and nozzle diameter. Uses physics-based Barrowman drag buildup. Includes OpenRocket cross-validation. Recommended for high-power rockets and FAA §101.25 waiver applications.

---

## Documentation

- **[User & Methodology Manual](docs/manual.md)** — How to use the tool, results interpretation, regulatory context, and full technical reference (equations of motion, atmosphere model, drag model with citations).
- **[Developer Guide](docs/developer.md)** — Dev setup, codebase architecture, simulation pipeline, drag model deep dive, batch stress test, and contribution workflow.

---

## PDF Export

For FAA waiver applications, two PDF documents are available:

- **Methodology document** (`docs/pdf/methodology.pdf`): Explains and justifies the simulation methodology. Submit once to establish this tool as an acceptable analysis method with your FSDO.
- **Per-waiver template** (`docs/pdf/waiver-template.pdf`): Fill-in form for individual launch applications.

Build PDFs from source: `bash docs/pdf/build.sh` (requires Pandoc + LaTeX; see developer guide §2).

---

## Quick Start

```bash
npm install
npm run dev
```

Open `http://localhost:5173`.

---

## Organization

Advanced Propulsion Association — [GitHub](https://github.com/Advanced-Propulsion-Association)
```

- [ ] **Step 2: Commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
git add README.md
git commit -m "docs: add condensed README with tier descriptions and doc links"
```

---

## Task 9: Write `docs/pdf/waiver-template.md` + `docs/pdf/build.sh`

**Files:**
- Create: `docs/pdf/waiver-template.md`
- Create: `docs/pdf/build.sh`

- [ ] **Step 1: Create `docs/pdf/` directory and write `waiver-template.md`**

```markdown
---
title: "FAA §101.25 Hazard Zone Analysis — Launch Waiver Application"
---

# FAA §101.25 Hazard Zone Analysis

**Document type:** Per-Launch Hazard Zone Analysis  
**Analysis tool:** FAA Hobby Rocket Hazard Zone Calculator  
**Methodology reference:** *FAA Hobby Rocket Hazard Zone Calculator — Methodology* (Advanced Propulsion Association, see `docs/pdf/methodology.pdf`)

---

## Section 1 — Applicant Information

| Field | Value |
|-------|-------|
| Applicant name | |
| Club / Organization | |
| Launch site name | |
| Launch site location | |
| Launch date | |
| FAA waiver / COA number | |
| Submitting RSO | |

---

## Section 2 — Rocket Parameters

| Parameter | Value | Units |
|-----------|-------|-------|
| Rocket name / designation | | |
| Motor designation | | |
| Motor total impulse | | N·s |
| Motor class | | (A–O+) |
| Body diameter | | inches |
| Body length | | inches |
| Dry mass | | lbs |
| Nose cone type | | (ogive / conical / parabolic / haack) |
| Expected apogee (OpenRocket) | | feet AGL |
| Single-stage / multi-stage | | |

---

## Section 3 — Analysis Method

This hazard zone analysis was performed using the **FAA Hobby Rocket Hazard Zone Calculator**, a web-based 3-DOF point-mass trajectory simulation tool developed by the Advanced Propulsion Association. The tool's methodology is documented in the accompanying methodology document.

**Analysis tier used:** ☐ Tier 1 &nbsp;&nbsp; ☐ Tier 2 &nbsp;&nbsp; ☐ Tier 3

**Conservative assumptions applied:**
- Launch angle sweep: 0° to 20° from vertical (1° increments)
- Headwind: ______ MPH (surface value; 1/7 power-law gradient applied at altitude)
- Drag model: Barrowman component buildup, subsonic; physics-based Mach correction at transonic/supersonic speeds

---

## Section 4 — Results

| Result | Value | Units |
|--------|-------|-------|
| Computed hazard zone radius (simulation) | | feet |
| NAR/Tripoli quarter-altitude estimate | | feet |
| 1,500 ft AGL statutory floor (§101.25(g)) | | feet |
| **Reported exclusion radius (greatest of above)** | | **feet** |

**Trajectory sweep diagram:** *(attach Print View PDF from the calculator)*

---

## Section 5 — Certification

I certify that the information provided in this document is accurate and complete, and that the described rocket will be flown within the stated exclusion radius at the specified launch site on the specified date.

&nbsp;

**Applicant signature:** _____________________________ &nbsp;&nbsp; **Date:** _______________

**RSO signature:** _____________________________ &nbsp;&nbsp; **Date:** _______________
```

- [ ] **Step 2: Write `docs/pdf/build.sh`**

```bash
#!/usr/bin/env bash
# Build PDFs from Markdown source using Pandoc + XeLaTeX.
# Run from the hazard-zone-calculator/ project root.
#
# Requirements:
#   - Pandoc: https://pandoc.org/installing.html
#   - XeLaTeX: MiKTeX (Windows), MacTeX (macOS), texlive-xetex (Linux)
#   - On Windows: run from Git Bash or WSL
#
# Usage:
#   bash docs/pdf/build.sh

set -euo pipefail

OUTDIR="docs/pdf"
mkdir -p "$OUTDIR"

echo "Building methodology PDF..."
pandoc docs/manual.md \
  --pdf-engine=xelatex \
  --metadata title="FAA Hobby Rocket Hazard Zone Calculator — Methodology" \
  --metadata author="Advanced Propulsion Association" \
  --metadata date="$(date +%Y-%m-%d)" \
  --toc \
  --toc-depth=3 \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -o "$OUTDIR/methodology.pdf"
echo "  → $OUTDIR/methodology.pdf"

echo "Building per-waiver template PDF..."
pandoc docs/pdf/waiver-template.md \
  --pdf-engine=xelatex \
  --metadata author="Advanced Propulsion Association" \
  -V geometry:margin=1in \
  -V fontsize=11pt \
  -o "$OUTDIR/waiver-template.pdf"
echo "  → $OUTDIR/waiver-template.pdf"

echo "Done."
```

- [ ] **Step 3: Make build.sh executable and commit**

```bash
cd "C:\Users\bsoltes\FAA Hazard analysis\hazard-zone-calculator"
chmod +x docs/pdf/build.sh
git add docs/pdf/waiver-template.md docs/pdf/build.sh
git commit -m "docs: add per-waiver template and Pandoc PDF build script"
```

---

## Self-Review Checklist

After all tasks complete, verify:

- [ ] `docs/manual.md` covers all 8 sections (Overview, Getting Started, Tier 1–3, Results, Regulatory, Technical Reference)
- [ ] `docs/manual.md §8` numeric values (Mach breakpoints, Cf formula, Van Driest exponents, wave drag peak) match `aerodynamics.ts` and `barrowmanDrag.ts` exactly
- [ ] `docs/developer.md` covers all 9 sections
- [ ] `README.md` exists at `hazard-zone-calculator/` root with `[INSERT SCREENSHOT]` placeholder
- [ ] `docs/pdf/waiver-template.md` has all 5 sections with fill-in fields
- [ ] `docs/pdf/build.sh` is executable and contains both Pandoc commands
- [ ] `npm run build` still passes (documentation changes should not affect TypeScript build)
