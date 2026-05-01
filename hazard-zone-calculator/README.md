# FAA Rocket Hazard Zone Calculator

A web-based tool for computing FAA-compliant launch exclusion radii for rockets. Replaces the legacy TAOS (Sandia Labs, 1995) tool with a modern browser interface running a 3-DOF RK4 trajectory simulation with Barrowman-based drag.

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
