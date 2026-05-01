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
