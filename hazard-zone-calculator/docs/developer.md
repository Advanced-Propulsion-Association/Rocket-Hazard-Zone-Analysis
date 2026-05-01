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
