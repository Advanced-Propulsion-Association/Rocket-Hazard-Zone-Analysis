# Validation Test Cases

This folder contains OpenRocket design files (`.ork`) and batch validation tooling used to verify the accuracy of the FAA Hazard Zone Calculator's drag model.

## What's in here

**`.ork` files** — OpenRocket design files for 136 rockets submitted to the 2026 Intercollegiate Rocket Engineering Competition (IREC). Each file includes the rocket's full geometry, motor selection, and OpenRocket's simulated apogee. These serve as the reference dataset for validating the calculator's trajectory simulation.

**`batch_test.mjs`** — Runs all `.ork` files through the hazard zone calculator and compares computed apogee against the OpenRocket reference for each rocket. Reports how many fall within ±10% and ±20% error bounds.

**`batch_investigate.mjs`** — Deep-dive tool for individual outliers. Run with a specific filename to get a full drag breakdown and trajectory telemetry.

**`batch_overrides.json`** — CD overrides for rockets with unusual geometry (e.g. extreme fineness ratio) that cause systematic error in the Barrowman drag model.

## Running the validation

```bash
cd test-cases
node batch_test.mjs
```

Requires Node 18+. See `docs/developer.md §7` in the main project for full instructions.

## Current results

| Threshold | Pass rate |
|-----------|-----------|
| Within ±20% | 100% |
| Within ±10% | ~73% |

The ±20% threshold is the acceptance criterion. The ±10% cohort reflects well-characterized rockets with tangent ogive noses and standard proportions.
