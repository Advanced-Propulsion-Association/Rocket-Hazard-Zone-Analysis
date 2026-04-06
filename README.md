# Hobby Rocket Hazard Zone Analysis

A web-based replacement for the FAA TAOS (Trajectory Analysis for Orbital Safing) tool used to compute hazard zones for hobby rocket launches. TAOS was developed by Sandia National Laboratories in 1995 and is no longer functional on modern Windows systems. This tool replicates its conservative ballistic methodology in a browser-based calculator.

## What It Does

Given rocket parameters, the calculator simulates a 3-DOF point-mass trajectory with worst-case assumptions (0–20° launch angle sweep, 20 MPH headwind) and returns the maximum downrange hazard radius. Three input tiers are available:

- **Tier 1 (Operator Mode):** Enter only the expected apogee. Good for quick estimates up to 50,000 ft AGL.
- **Tier 2 (Basic Mode):** Enter body geometry and motor data. Runs a full 3-DOF RK4 simulation.
- **Tier 3 (Full Mode):** Tier 2 plus nose cone type, fin geometry, nozzle diameter, and staging.

Output includes hazard zone radius, trajectory sweep plot, NAR/Tripoli quarter-altitude rule comparison, and optional OpenRocket apogee comparison.

## Repository Layout

```
/
├── hazard-zone-calculator/   # React/TypeScript web app (run this)
├── simulation_engine.py      # Python reference implementation (same physics)
├── test_validation.py        # 28 validation test cases
├── Hazard_Zone_One_Pager.md  # Methodology summary and input definitions
└── *.txt                     # Reference material (TAOS, OpenRocket, RASAero II)
```

## Running Locally

### Prerequisites

- [Node.js](https://nodejs.org/) v18 or later
- A modern browser (Chrome, Firefox, Edge)

### Setup

```bash
# 1. Clone the repository
git clone https://github.com/Advanced-Propulsion-Association/Hobby-Rocket-Hazard-Zone-Analysis.git
cd Hobby-Rocket-Hazard-Zone-Analysis

# 2. Install dependencies
cd hazard-zone-calculator
npm install

# 3. Start the development server
npm run dev
```

The app will be available at `http://localhost:5173` in your browser.

### Build for Production

```bash
npm run build
```

Output goes to `hazard-zone-calculator/dist/`. The contents of that folder can be served by any static web host (Netlify, GitHub Pages, S3, etc.).

## Python Validation Engine

The `simulation_engine.py` script runs the same physics model as the web app and can be used to validate results or run batch analysis from the command line.

```bash
# Requires Python 3.8+, no external dependencies
python simulation_engine.py
```

Run the test suite:

```bash
python test_validation.py
```

All 28 test cases should pass.

## Why 3-DOF and Not 6-DOF

A 6-DOF simulation models both translational motion (x, y, z) and rotational motion (pitch, yaw, roll). It can predict where a rocket actually goes — accounting for fin stabilization, gyroscopic effects, and attitude dynamics. Tools like OpenRocket and RASAero II use 6-DOF or high-fidelity approximations of it.

This tool deliberately uses 3-DOF (translation only, point-mass). Here's why that's the right choice for hazard zone analysis:

**1. The goal is a worst-case bound, not a best-guess trajectory.**
A 6-DOF sim models a rocket that is flying correctly — stable, well-trimmed, behaving as designed. A hazard zone calculation needs to answer: *if something goes wrong, how far could this rocket travel?* A point-mass with no attitude dynamics is inherently more pessimistic because it doesn't get credit for fin stabilization or aerodynamic self-correction.

**2. 6-DOF requires data you don't have at launch time.**
Accurate 6-DOF needs moments of inertia, aerodynamic moment coefficients, damping derivatives, and center-of-pressure as a function of angle of attack. These are hard to measure and rarely available for hobby rockets. 3-DOF only needs geometry and thrust — inputs that are realistic to collect.

**3. It matches the regulatory precedent.**
The original FAA TAOS tool (Sandia National Laboratories, 1995) that this calculator replaces was a 3-DOF point-mass simulation. Using the same methodology keeps results directly comparable to the existing FAA baseline and avoids introducing new assumptions that would need regulatory justification.

**4. Simplicity is a feature for safety tools.**
A simpler model is easier to audit, validate, and explain to a launch official or FAA inspector. The conservative assumptions (20 MPH headwind, CD intentionally low, angle sweep to 20°) are explicit and defensible. A complex 6-DOF model can obscure whether the result is conservative or optimistic.

In short: 6-DOF is better for predicting where your rocket goes. 3-DOF is better for predicting the boundary of where it *could* go. For a hazard zone tool, that distinction matters.

## Physics Model

| Parameter | Value |
|---|---|
| Integrator | RK4, adaptive timestep (0.02 s burn / 0.1 s coast) |
| Atmosphere | 1976 US Standard Atmosphere, anchored to site elevation |
| Drag model | `CD = 0.35 + 3.0 / fineness²` + Mach correction |
| Wind | Constant 20 MPH headwind (worst case) |
| Launch angles | 0°–20° sweep (5° increments) |
| Stability correction | SM < 1 caliber → CD ×1.5; SM < 0 → CD ×2.0 |

All assumptions are intentionally conservative to produce a bounding hazard zone.

## License

See [LICENSE](LICENSE) if present, or contact the Advanced Propulsion Association.
