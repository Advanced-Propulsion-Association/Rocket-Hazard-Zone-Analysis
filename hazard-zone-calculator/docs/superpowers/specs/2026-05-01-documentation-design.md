# Documentation Suite Design

**Date:** 2026-05-01
**Status:** Approved

---

## Problem

The FAA hazard zone calculator has no user-facing documentation. Operators using the tool to support FAA waiver applications have no reference explaining what the tool computes, what assumptions it makes, or how to interpret results. FAA/FSDO reviewers have no methodology document to validate against. New contributors have no onboarding guide or architectural reference.

---

## Solution

Two Markdown source documents (`docs/manual.md`, `docs/developer.md`) serve as the single source of truth. Three derived outputs are produced from them: a condensed GitHub README, a methodology PDF for FAA submittal, and a per-waiver fill-in template.

---

## Document 1: `docs/manual.md` — User & Methodology Manual

**Audience:** Rocket club operators, range safety officers, FAA/FSDO reviewers.

**Tone:** Accessible for non-engineers in user-facing sections; rigorous and citation-backed in the Technical Reference appendix.

### Table of Contents

#### 1. Overview
- What this tool is and what problem it solves
- Relationship to FAA Order 8900.1 and the legacy TAOS (Trajectory Analysis for Orbital Safing) tool developed by Sandia Labs (1995)
- When to use each tier (Tier 1 / Tier 2 / Tier 3) — decision table
- Limitations and assumptions (3-DOF, point mass, no wind shear, standard atmosphere)

#### 2. Getting Started
- Accessing the tool (hosted URL and local setup)
- Choosing your input tier
- Uploading an OpenRocket `.ork` file vs. manual entry
- Browser compatibility notes

#### 3. Tier 1: Apogee-Only Analysis
- Input fields: expected apogee (ft AGL), launch site elevation
- How the hazard zone radius is computed from apogee alone
- When Tier 1 is sufficient (low-power, no motor data available)

#### 4. Tier 2: Basic Simulation
- Input fields: body diameter, body length, dry mass, motor selection (ThrustCurve.org), launch angle, headwind
- Multi-stage configuration: booster + sustainer inputs
- Reading the results: hazard radius, trajectory sweep plot, NAR/Tripoli ¼-altitude comparison

#### 5. Tier 3: Full Barrowman Analysis
- Additional inputs: nose cone type (ogive, conical, parabolic, Haack), fin geometry (span, root chord, tip chord, sweep), nozzle exit diameter
- OpenRocket cross-validation workflow: upload `.ork` file, compare simulated apogee vs. OR reference
- When Tier 3 is required (high-power, M-class and above, FAA waiver applications)

#### 6. Results Interpretation
- Hazard zone radius: definition (maximum downrange distance across all simulated trajectories)
- Conservative assumptions baked in: 20 MPH headwind, 0–20° launch angle sweep
- Trajectory sweep visualization: what each line represents
- Exporting results: print view, PDF output

#### 7. Regulatory Context
- FAA waiver process overview (14 CFR §101.25)
- The 1500 ft AGL floor per §101.25(g)
- NAR/Tripoli ¼-altitude rule: definition and how this tool's output compares
- How to use this tool's output in a waiver application: which numbers to cite, which PDF to attach

#### 8. Technical Reference (Appendix)

##### 8.1 Coordinate System and Equations of Motion
- 3-DOF point-mass model: forces (thrust, drag, gravity), integration scheme (4th-order Runge-Kutta)
- State vector: position (x, y), velocity (vx, vy), mass (variable during burn)
- Thrust vector: aligned with velocity direction; thrust angle correction for non-vertical launches

##### 8.2 Atmosphere Model
- US Standard Atmosphere 1976: density, pressure, temperature vs. altitude
- Speed of sound vs. altitude (used for Mach number calculation)

##### 8.3 Drag Model

###### 8.3.1 Subsonic Baseline (Barrowman Component Buildup)
- Skin friction coefficient (turbulent flat plate, Reynolds number dependent)
- Nose pressure drag (shape-dependent; ogive sinφ = 0 per OpenRocket convention)
- Base drag (boat-tail correction)
- Fin interference and profile drag
- Reference: Barrowman (1967), OpenRocket Technical Documentation

###### 8.3.2 Mach Correction — Standard Shapes
- Subsonic (M < 0.87): flat, no correction
- Transonic (0.87 ≤ M ≤ 1.30): quadratic ramp peaking at 1.20× at M = 1.0
- Supersonic (M > 1.30): power-law decay (1.055 × M^−0.561 Van Driest skin friction)
- Calibration: matched to OpenRocket session 8 data

###### 8.3.3 Mach Correction — Tangent Ogive Noses (Wave Drag)
- Physics basis: OpenRocket bug #2998 (sinφ = 0 → zero wave drag subsonic, correct)
- Wave drag onset at M = 0.85 (Prandtl-Glauert critical Mach)
- Linear ramp to peak ΔC_D = 0.025 at M = 1.05 (referenced to body cross-section)
- Transonic plateau 0.025 for 1.05 ≤ M < 1.20
- Ackeret 1/M supersonic decay for M ≥ 1.20
- Source: NACA free-flight data, Stoney (1954), aerodynamics_reference.md §12.1

##### 8.4 Worst-Case Trajectory Sweep
- Launch angle sweep: 0° (vertical) to 20° (maximum allowed by FAA for hobby rockets) in 1° steps
- Headwind: 20 MPH applied as a constant opposing horizontal velocity component
- Hazard radius: maximum apogee-to-impact distance across all simulated trajectories

##### 8.5 Multi-Stage Simulation
- Booster burn: full thrust curve, stage separation at burnout
- Booster ballistic: tumbling drag model post-separation
- Sustainer: ignition delay, coast, second burn, ballistic descent
- Hazard radius: maximum across booster and sustainer impact footprints

##### 8.6 Cited Sources
- Barrowman, J.S. (1967). *The Practical Calculation of the Aerodynamic Characteristics of Slender Finned Vehicles*. MS Thesis, Catholic University of America.
- Stoney, W.E. (1954). *Collection of Zero-Lift Drag Data on Bodies of Revolution from Free-Flight Investigations*. NACA TN-3391.
- OpenRocket Technical Documentation (Niskanen, 2009).
- FAA Order 8900.1, Volume 3, Chapter 6.
- 14 CFR §101.25 — Waiver requirements for amateur rockets.
- US Standard Atmosphere, 1976 (NOAA/NASA/USAF).

---

## Document 2: `docs/developer.md` — Developer & Contributor Guide

**Audience:** Software developers and contributors to the project.

**Tone:** Direct and technical. Assumes TypeScript/React familiarity; explains domain-specific aerodynamics concepts where needed.

### Table of Contents

#### 1. Project Overview
- What the codebase does in one paragraph
- Tech stack: React 18, TypeScript, Vite, Tailwind CSS

#### 2. Dev Setup
- Prerequisites: Node 18+, npm
- Clone, `npm install`, `npm run dev`
- `npm run build` and `npm run preview`
- Linting: `npm run lint`

#### 3. Repository Layout
- `src/components/` — UI layer (Tier1Form, Tier2Form, Results, MapPanel, PrintView)
- `src/simulation/` — physics engine (trajectory, aerodynamics, barrowmanDrag, motor, atmosphere, orkParser)
- `src/types/` — shared TypeScript interfaces
- `openrocket/` — batch stress test harness (batch_test.mjs, batch_investigate.mjs)
- `docs/` — documentation (this guide, manual, superpowers specs/plans)

#### 4. Simulation Pipeline
- End-to-end data flow: Form input → `HazardZoneInput` → `computeHazardZone()` → angle sweep → `simulate()` → RK4 integrator → drag/atmosphere → `HazardZoneResult`
- Key interfaces: `SimConfig`, `HazardZoneInput`, `MultiStageHazardZoneInput`, `TrajectoryPoint`, `HazardZoneResult`
- Multi-stage flow: `computeMultiStageHazardZone()` — booster + sustainer + intermediate ballistic paths
- Tier 1 fast path: `computeTier1HazardZone()` — apogee-only, no full simulation

#### 5. Drag Model Deep Dive
- `barrowmanDrag.ts`: subsonic component breakdown, `ogiveWaveDragCD()`
- `aerodynamics.ts`: `cdMachCorrection()` (all shapes), `cdMachCorrectionOgive()` (tangent ogive only)
- `trajectory.ts`: routing — `noseconeType === 'ogive'` dispatches to `cdMachCorrectionOgive`, all others to `cdMachCorrection`
- How to add a new nose cone type: add string literal to `noseconeType` field, implement a new `cdMachCorrectionX()` function in `aerodynamics.ts`, add routing branch in `trajectory.ts`

#### 6. Adding / Updating Motors
- ThrustCurve.org RASP (`.eng`) format
- How `motor.ts` parses thrust curves and computes total impulse, burn time, average thrust
- Adding a motor manually to `motors/thrustcurve.ts`

#### 7. Batch Stress Test
- What `openrocket/batch_test.mjs` does: runs 136 IREC 2026 rockets through the simulation, compares computed apogee against OpenRocket reference values
- Prerequisites: Node 18+, `.ork` files in `openrocket/IREC_2026/`
- Running: `cd openrocket && node batch_test.mjs`
- Reading output: ±10% and ±20% cohort counts, per-rocket diff table
- `cd_overrides` in `batch_overrides.json`: when and how to add one
- `batch_investigate.mjs`: deep-dive tool for individual outlier rockets

#### 8. Contribution Workflow
- Branch from `main`, name branches `feat/`, `fix/`, `chore/`
- Commit message conventions: `feat:`, `fix:`, `chore:`, `test:`, `docs:`
- Always run `npm run build` and `npm run lint` before opening a PR
- Superpowers workflow: major changes go through brainstorming → spec → plan → subagent-driven execution
- Where specs and plans live: `docs/superpowers/specs/` and `docs/superpowers/plans/`

#### 9. Known Limitations & Future Work
- 3-DOF point-mass model (no roll, pitch, yaw)
- Non-ogive wave drag not yet modeled (conical, parabolic, Haack use generic Mach correction)
- Constant headwind (no wind shear or gusts)
- Standard atmosphere only (no site-specific weather)
- `Dual Deploy.ork` outlier: extreme fineness ratio (26:1) causes Barrowman CD overestimate — candidate for `cd_override`

---

## Derived Outputs

### GitHub README (`README.md`)
A condensed 1–2 page summary maintained by hand. Contents:
- What the tool is (2–3 sentences)
- Three tiers described in one paragraph each
- Screenshot or results example
- Links to `docs/manual.md` and `docs/developer.md`
- License and organization
- **Note:** README should include one screenshot of the results panel. Placeholder text `[INSERT SCREENSHOT]` should be left in the Markdown source until a real screenshot is added.

### Methodology PDF (`docs/pdf/methodology.pdf`)
Full `docs/manual.md` converted to PDF via Pandoc. Cover page includes tool name, version (from `package.json`), date, and organization. Command lives in `docs/pdf/build.sh`. Regenerated on each significant manual update. This is the once-submitted document establishing the tool as an acceptable FAA analysis method.

### Per-Waiver Template (`docs/pdf/waiver-template.md` → `waiver-template.pdf`)
A 3–4 page fill-in Markdown template. Sections:
- Applicant information (name, club, site, date)
- Rocket parameters (motor class, apogee, mass, diameter)
- Analysis method (reference to methodology document by name and date)
- Results (hazard zone radius, paste of results screenshot or table)
- Certification statement (operator signature line)

Built by the same `docs/pdf/build.sh` script alongside the methodology PDF.

---

## PDF Build Tooling

`docs/pdf/build.sh` — shell script using Pandoc:
```bash
# methodology PDF
pandoc docs/manual.md \
  --pdf-engine=xelatex \
  --metadata title="FAA Hobby Rocket Hazard Zone Calculator — Methodology" \
  --metadata date="$(date +%Y-%m-%d)" \
  -o docs/pdf/methodology.pdf

# per-waiver template
pandoc docs/pdf/waiver-template.md \
  --pdf-engine=xelatex \
  --metadata title="FAA §101.25 Hazard Zone Analysis — Waiver Application" \
  -o docs/pdf/waiver-template.pdf
```

Pandoc and a LaTeX engine (e.g. MiKTeX on Windows, MacTeX on macOS) are required. Instructions included in `docs/developer.md` §2 (Dev Setup). On Windows, `build.sh` must be run from Git Bash or WSL — this requirement is documented in the developer guide.

---

## Success Criteria

- `docs/manual.md` is complete, accurate, and covers all 8 sections above
- `docs/developer.md` is complete and covers all 9 sections above
- `README.md` is updated to the condensed summary format
- `docs/pdf/waiver-template.md` is complete with all fill-in sections
- `docs/pdf/build.sh` exists and produces both PDFs without error (given Pandoc installed)
- All content is technically accurate against the current codebase (no references to removed features or incorrect function names)
