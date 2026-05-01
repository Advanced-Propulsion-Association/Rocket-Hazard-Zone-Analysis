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

**Step 5:** Add the option to the nose cone type selector in `Tier2Form.tsx`.

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
  totalMassKg: number;
  propellantMassKg: number;
  diameterMm: number;
  lengthMm: number;
  thrustCurve: Array<{ time: number; thrust: number }>;
  nozzleExitAreaM2?: number;
}
```

The thrust curve is an array of `{ time, thrust }` pairs in seconds and Newtons, matching the RASP `.eng` file format from ThrustCurve.org.

### 6.2 Adding a Motor

1. Download the `.eng` file from ThrustCurve.org for your motor.
2. Use `parseRaspEng(engText)` from `motor.ts` to parse it into a `Motor` object, or construct the object manually.
3. Add the object to the exported array in `src/motors/thrustcurve.ts`.
4. Run `npm run build` to confirm no TypeScript errors.

### 6.3 How Motors Are Used in Simulation

`motor.ts` exports:
- `thrustAt(motor, t)` — interpolates thrust at time `t` from the thrust curve array.
- `thrustCorrected(motor, t, alt_m, pressureAtAlt)` — altitude-corrected thrust including nozzle exit pressure correction.
- `totalImpulse(motor)` — sum of thrust × time intervals across the thrust curve.
- `burnTime(motor)` — time of last non-zero thrust point.

These are called inside `derivs()` in `trajectory.ts` at every RK4 sub-step.

---

## 7. Batch Stress Test

### 7.1 What It Does

`../openrocket/batch_test.mjs` runs the hazard zone calculator against a corpus of IREC 2026 competition rocket design files and compares the computed apogee against the OpenRocket reference apogee for each rocket. This validates the drag model across a wide range of rocket sizes, motor classes, and geometries.

**Success threshold:** 100% of rockets within ±20% apogee error; target ≥80% within ±10%.

### 7.2 Prerequisites

- Node 18+
- `.ork` files in the batch test directory (not committed to the repo — obtain from the IREC 2026 design file archive)
- A `batch_rockets.csv` file listing the rockets and their OR apogees

### 7.3 Running the Test

```bash
cd ../openrocket
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

For rockets with unusual geometry that causes systematic apogee error (e.g., extreme fineness ratio), a `cd_override` can be added to `batch_overrides.json`:

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
