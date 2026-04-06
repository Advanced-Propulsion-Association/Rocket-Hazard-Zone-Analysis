# Minimum Inputs Required to Determine a Hobby Rocket Hazard Zone
### A Practical Framework for FAA AST and the Rocketry Community

---

## What Is a Hazard Zone?

A hazard zone is the **worst-case ballistic impact radius** from the launch pad — the maximum distance a rocket could travel assuming total recovery system failure (no parachute deploys) and the rocket descends on a ballistic trajectory. It is expressed as a **circle** centered on the launch pad, using the maximum possible impact range in any direction to account for variable wind direction and launch azimuth. It defines the area that must be cleared of people, property, and aircraft before a launch.

---

## Existing Rules Already Bound the Worst Case

NAR and Tripoli safety codes impose operational limits that directly cap the worst-case scenario and must be satisfied before any launch is approved:

| Rule | Value | Effect on Hazard Zone |
|---|---|---|
| Maximum launch angle from vertical | **20°** | Limits downrange component of powered trajectory |
| Maximum sustained surface wind | **20 MPH** | Bounds worst-case drift during coast and descent |
| Launch direction | **Always into the wind** | Prevents additive compounding of wind and launch angle |
| Minimum static stability margin | **≥ 1 caliber** | Ensures near-zero angle of attack during powered flight |
| Minimum clear zone radius | **Altitude ÷ 4** | NAR/Tripoli baseline — our calculator validates and extends this |

> **These constraints mean the FAA does not need to optimize over all possible launch conditions.** The worst-case scenario is fixed: 20° launch angle, 20 MPH headwind, no recovery. All legal launches fall within this envelope.

---

## Why the Current FAA TAOS Requirement Is Mismatched

The current FAA AST process (via TAOS) requires full aerodynamic coefficient tables — CA, CN, CL as a function of **both Mach number and angle of attack from 0° to 180°**. This is appropriate for guided missiles but not for hobby rockets because:

1. **Not producible by hobbyists** — No standard hobby tool outputs AoA tables from 0–180°
2. **Not necessary for the constrained case** — A stable rocket under NAR/Tripoli rules flies at near-zero AoA during powered flight; ballistic descent is drag-dominated
3. **TAOS itself is broken** — The software is 1990s-era (Windows 95/NT), restricted to government contractors, and no longer operationally accessible

The tools hobbyists already use — **OpenRocket**, **RASAero II**, and **RocketPy** — solve the same physics problem with better aerodynamic accuracy and full public availability.

---

## The Physics (Summary — See Appendix for Full Derivation)

A **3-DOF point-mass model** is the appropriate level of fidelity for this problem. It is what TAOS used, and it produces conservative (larger) hazard zone estimates compared to 6-DOF because it assumes the rocket flies nose-forward during descent (lower drag, longer range) rather than tumbling (higher drag, shorter range).

**Forces modeled:** Thrust (altitude-corrected), aerodynamic drag, gravity  
**Atmosphere:** 1976 US Standard Atmosphere, anchored to launch site elevation and temperature  
**Drag:** CD as a function of Mach number — derivable from rocket geometry or estimated from fineness ratio  
**Wind:** Constant at surface for V1; NOAA sounding profile for high-altitude flights (V2)

---

## The NAR/Tripoli Quarter-Altitude Rule — Validated

The existing NAR/Tripoli rule (clear zone = altitude ÷ 4) holds well for lower-altitude flights but becomes less conservative as altitude increases:

| Max Apogee | 1/4 Rule | Physics-Based Estimate (20°, 20 MPH) | Status |
|---|---|---|---|
| 1,000 ft | 250 ft | ~200–350 ft | ✓ Conservative |
| 5,000 ft | 1,250 ft | ~900–1,500 ft | ✓ Conservative |
| 10,000 ft | 2,500 ft | ~1,800–3,000 ft | ~ Borderline |
| 30,000 ft | 7,500 ft | ~6,000–10,000 ft | ⚠ May underestimate |

Our calculator validates the 1/4 rule against physics and flags when a more detailed analysis is warranted.

---

## Three-Tier Input Structure

### Tier 1 — Operator Mode
*For launch site operators who only know the maximum expected altitude of any rocket at the event.*

| Input | Notes |
|---|---|
| Maximum expected apogee (ft AGL) | Highest any rocket at the event will reach |
| Launch site elevation (ft MSL) | For atmosphere anchoring |

**Output:** Hazard zone radius using conservative physics model (CD ≈ 0.6, worst-case launch angle and wind). Validates against NAR/Tripoli 1/4 altitude rule and flags if they diverge.

---

### Tier 2 — Basic Mode
*For kit builders or any rocketeer who can read the box and weigh the rocket.*

| # | Input | Where to Find It |
|---|---|---|
| 1 | Max body diameter (in) | Kit instructions / box |
| 2 | Total rocket length (in) | Kit instructions / box |
| 3 | Total loaded weight (lbs) | Weigh it |
| 4 | Launch site elevation (ft MSL) | GPS / known |
| 5 | **Motor** — choose one: | |
| | Commercial designation (e.g., "AeroTech K1000T") | ThrustCurve.org auto-fill |
| | Average thrust (N) + burn time (sec) + propellant mass (lbs) | For custom / EX motors |

**CD** is estimated from the fineness ratio (length ÷ diameter) using an empirical model. Motor lookup auto-fills thrust curve and propellant mass from ThrustCurve.org.

---

### Tier 3 — Full Mode
*For experienced rocketeers with complete design details, and for all flights above Mach 0.8 or 18,000 ft MSL.*

All Tier 2 inputs plus:

| # | Additional Input | Notes |
|---|---|---|
| 6 | Nose cone type and length (in) | Tangent ogive is default |
| 7 | Fin geometry: root chord, tip chord, span, sweep (in) | From design / OpenRocket file |
| 8 | Nozzle exit diameter (in) | Required for altitude thrust correction |
| 9 | Surface temperature (°F) | For accurate air density |
| 10 | Number of stages | Triggers per-stage sub-calculation |

**Motor options for Tier 3:**
- Commercial motor lookup (ThrustCurve.org)
- **Upload RASP .eng file** — standard format for all three simulation tools; encodes full thrust curve, propellant mass, and motor geometry
- **Manual thrust vs. time table** — enter data points directly
- Average thrust + burn time (fallback)

**Multi-stage:** Each stage is calculated independently. The overall hazard zone is the union of all stage impact zones — the largest radius wins. Stage separation timing and per-stage mass are required.

**Stability check:** The calculator computes the static stability margin (CP − CG in calibers). If the margin is less than 1 caliber, a warning is issued and the calculation is blocked — an unstable rocket will not be approved for launch and invalidates the near-zero AoA assumption the hazard zone calculation depends on.

**Motor class validation:** Total impulse is computed from the thrust curve and the corresponding NAR/Tripoli motor class (A through O+) is displayed. Motors above Class M flag for additional FAA notification requirements.

---

## How Existing Tools Already Satisfy Tier 3

| Tool | Best For | Key Output for Hazard Zone |
|---|---|---|
| **OpenRocket** | Subsonic flights (M < 0.8), most NAR launches | Full 6-DOF simulation; ballistic mode by removing recovery device; exports trajectory CSV |
| **RASAero II** | High-altitude and supersonic flights | Native ballistic simulation mode; Run Test exports CD(Mach) table; 3-DOF with wind and weathercocking |
| **RocketPy** | Complex flights, statistical analysis (V2) | Monte Carlo dispersion analysis produces 3-sigma impact ellipse; most rigorous for V2 |

All three tools use the same underlying physics and the same motor file format (RASP .eng). A simulation file from any of these tools satisfies the Tier 3 data package.

---

## Proposed Minimum Data Package (Replacing TAOS Submission)

**For any single-stage hobby rocket (Tiers 1–2):**
- Tier 1 or Tier 2 calculator output (PDF or printable report)
- Confirmation of NAR/Tripoli safety code compliance

**For Tier 3 / high-altitude flights:**
- Tier 3 calculator output
- OpenRocket (.ork) or RASAero II (.CDX1) simulation file
- Ballistic simulation run (no recovery configured) — exported CSV or screenshot
- Motor RASP designation or .eng file

**Note on custom / EX motors:** Tripoli Research and NAR EX certified motors with custom thrust curves are fully supported via RASP .eng file upload or manual entry.

---

## Winds Aloft Consideration

Surface wind (≤ 20 MPH) is the required input and the binding launch constraint for V1. For flights above ~5,000 ft AGL, winds aloft can exceed surface winds significantly.

- **V1:** Uses surface wind input; applies a standard wind gradient model (`U(z) = U_surface × (z/10m)^0.14`) to estimate wind at altitude
- **V2:** Integrates NOAA atmospheric sounding data (weather balloon profiles) for the nearest station to the launch site, giving actual wind speed and direction at each altitude layer

---

## The Bottom Line

The FAA's current requirement asks for missile-grade aerodynamic data that hobby tools don't produce and hobbyists can't generate. The actual physics problem — worst-case ballistic range under NAR/Tripoli constraints — is simpler. OpenRocket, RASAero II, and RocketPy already solve it with validated accuracy. The minimum input is **2 parameters** for a site operator and **5 parameters** for a basic rocket — all of which any rocketeer already knows.

A simple web-based calculator using this tiered input structure, the 1976 US Standard Atmosphere, and the 3-DOF point-mass equations can replicate TAOS's hazard zone output — more accurately, more accessibly, and at zero cost.

---

*Prepared in support of FAA AST hobby rocket hazard zone analysis | April 2026*
*Tools referenced: OpenRocket v13.05, RASAero II v1.0.2.0, RocketPy v1.11.0, TAOS 1995 User Manual (Sandia National Labs)*

---

## Appendix: Physics and Governing Equations

### Coordinate System and Assumptions
- Flat Earth (valid for hobby rocket altitudes)
- Launch site at origin; positive z = up; wind along x-axis
- Rocket treated as point mass (3-DOF); attitude not tracked
- Stable rocket assumed at near-zero angle of attack during powered flight

### Equations of Motion (3-DOF Point Mass)
```
dV/dt    = [T(t,h) − D(V,h)] / m(t)  −  g · sin(γ)
V·dγ/dt  =                            −  g · cos(γ)
dx/dt    = V · cos(γ)
dh/dt    = V · sin(γ)
dm/dt    = −ṁ   (from thrust curve)
```

### Forces
- **Thrust (altitude-corrected):** T(h) = T_SL(t) + (P_SL − P(h)) × A_nozzle
- **Drag:** D = ½ · ρ(h) · V² · A_ref · CD(Mach)
- **Gravity:** g = 9.80665 m/s²
- **Reference area:** A_ref = π · (D/2)²

### Atmosphere (1976 US Standard, anchored to launch site)
- Air density, pressure, and temperature computed at each altitude step
- Launch site elevation and temperature override the standard sea-level values

### Drag Coefficient Estimation (Tier 2)
CD estimated from fineness ratio fB = L/D using empirical relationship:
- Typical hobby rockets: fB = 10–20, CD(subsonic) ≈ 0.35 + 3.0/fB²
- Conservative default if fineness ratio unavailable: CD = 0.6

### Motor Class Reference
| Total Impulse (N·s) | Class | | Total Impulse (N·s) | Class |
|---|---|---|---|---|
| 0–2.5 | A | | 640–1,280 | J |
| 2.5–5 | B | | 1,280–2,560 | K |
| 5–10 | C | | 2,560–5,120 | L |
| 10–20 | D | | 5,120–10,240 | M |
| 20–40 | E | | 10,240–20,480 | N |
| 40–80 | F | | 20,480–40,960 | O |
| 80–160 | G | | | |
| 160–320 | H | | | |
| 320–640 | I | | | |
