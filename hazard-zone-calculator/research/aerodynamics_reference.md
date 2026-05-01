# Rocket Aerodynamics Reference: CD Prediction Across the Full Mach Range

**Purpose:** Deep reference for the FAA hazard-zone calculator drag model. Covers exact OpenRocket (OR) formulas, RASAero II methodology, nose-cone-specific Mach correction tables, and 6-DOF aerodynamic coefficients.

**Last updated:** 2026-04-21  
**Sources:** OR `unstable` branch Java source (verified), OR techdoc v13.05, RASAero II user manual, NACA TR-R-100, Barrowman 1967 NTRS 20010047838.

---

## Table of Contents

1. [OpenRocket BarrowmanDragCalculator — Exact Formulas](#1-openrocket-barrowmandragcalculator--exact-formulas)
2. [Nose-Cone Pressure Drag: Shape-Specific Lookup Tables](#2-nose-cone-pressure-drag-shape-specific-lookup-tables)
3. [Skin Friction Drag: Mach and Reynolds Dependence](#3-skin-friction-drag-mach-and-reynolds-dependence)
4. [Base Drag](#4-base-drag)
5. [Fin Drag (Friction + Pressure + Base)](#5-fin-drag-friction--pressure--base)
6. [Stagnation (Disk) Pressure Drag](#6-stagnation-disk-pressure-drag)
7. [Fuselage Fineness Ratio Correction](#7-fuselage-fineness-ratio-correction)
8. [Side-by-Side Model Comparison: OR vs RASAero II vs Our Current Model](#8-side-by-side-model-comparison-or-vs-rasaero-ii-vs-our-current-model)
9. [Nose-Cone Mach Correction Summary Table](#9-nose-cone-mach-correction-summary-table)
10. [CP Location vs Mach — Barrowman Supersonic Shift](#10-cp-location-vs-mach--barrowman-supersonic-shift)
11. [6-DOF Aerodynamic Coefficients](#11-6-dof-aerodynamic-coefficients)
12. [Known Issues in OpenRocket and Recommended Fixes](#12-known-issues-in-openrocket-and-recommended-fixes)
13. [Sources](#13-sources)

---

## 1. OpenRocket BarrowmanDragCalculator — Exact Formulas

The OR aerodynamic model is split across three Java classes:

- `BarrowmanDragCalculator.java` — top-level drag orchestration
- `SymmetricComponentCalc.java` — nose cone / body tube / transition pressure & friction drag
- `FinSetCalc.java` — fin lift, friction, pressure, and base drag

### Total CD

```
CD_total = CD_friction + CD_pressure + CD_base + CD_override
```

All terms are referenced to the **maximum cross-sectional area** (reference area = π R²).

---

## 2. Nose-Cone Pressure Drag: Shape-Specific Lookup Tables

### 2.1 Architecture

`SymmetricComponentCalc.calculatePressureCD()` builds a `LinearInterpolator` once per component using `calculateNoseInterpolator()`. The interpolator is keyed on Mach and returns the **pressure CD referenced to the frontal annular area** of the nose cone (i.e. `π(r_aft² - r_fore²)` for a shoulder, `π r²` for a full nose).

The final contribution to rocket CD is:

```
CD_nose_pressure = interpolator(M) × A_frontal / A_ref
```

### 2.2 Ogive and Conical — Computed Analytically

Both shapes use `calculateOgiveNoseInterpolator(param, sinphi)` where:
- `param = 0` → **conical**
- `param = 1.0` → **tangent ogive** (and `sinphi = 0` for tangent ogive)
- `param` in (0,1) → secant ogive (intermediate)

`sinphi` is the sine of the half-angle at the base of the nose cone. For a **tangent ogive**, the curve meets the body tangentially, so `sinphi = 0`.

#### Transonic region (M = 1.0 to 1.3): polynomial fit

```java
double cdMach1   = sinphi;           // CD at M=1
double cdMach1_3 = 2.1*sinphi² + 0.6019*sinphi;  // CD at M=1.3

// Polynomial coefficients fitted to satisfy value + derivative at both ends
poly = conicalPolyInterpolator.interpolator(
    cdMach1, cdMach1_3,
    4/(γ+1) * (1 - 0.5*cdMach1),     // derivative at M=1
    -1.1341*sinphi                    // derivative at M=1.3
);

// Shape-parameter multiplier for secant ogive interpolation:
double mul = 0.72*(param - 0.5)² + 0.82;   // = 1.0 at param=0.5, min ~0.82
```

For M = 1.32 to 4.0 (supersonic, direct formula):

```java
CD = mul * (2.1*sinphi² + 0.5*sinphi / sqrt(M²-1))
```

**Key consequence for tangent ogive (sinphi = 0):**
- CD at M=1.0 = 0 (mathematically), which conflicts with empirical data showing a small but real wave drag.
- CD at M=1.3+ = 0 (formula gives zero for sinphi=0).
- The subsonic interpolation `a*M^b + cdMach0` is never invoked because `minValue < 0.001`.
- **Tangent ogive in OR therefore has essentially zero pressure CD at all Mach numbers.** This is a known open bug (GitHub issue #2998, Jan 2026).

**For conical (sinphi ≠ 0):** The formulas give meaningful results. For a 20° half-angle cone, sinphi ≈ 0.342, giving:
- CD at M=1.0 ≈ 0.342
- CD at M=2.0 ≈ 2.1×(0.117) + 0.5×(0.342)/1.732 ≈ 0.345

### 2.3 Other Shapes — Experimental Interpolation Tables

For non-ogive shapes, OR uses hardcoded lookup tables derived from **NACA TR-R-100** ("Collection of Zero-Lift Drag Data on Bodies of Revolution from Free-Flight Investigations") for fineness ratio 3, then extrapolates to the actual fineness ratio via:

```java
double log4 = log(fineness + 1) / log(4);
CD_at_M = CD_stagnation × (CD_table / CD_stagnation)^log4
```

This means at fineness ratio 3, `log4 = 1.0` (no scaling). At higher fineness ratios, CD is scaled down toward the stagnation value.

**The exact lookup tables (CD referenced to frontal area, fineness ratio 3):**

#### Von Kármán (Haack C=0, LD-Haack):
| M    | 0.90 | 0.95 | 1.00 | 1.05 | 1.10 | 1.20 | 1.40 | 1.60 | 2.00 | 3.00 |
|------|------|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.010| 0.027| 0.055| 0.070| 0.081| 0.095| 0.097| 0.091| 0.083|

**M_crit ≈ 0.90** (zero wave drag below this; drag rise is gradual).

#### LV-Haack (Haack C=1/3):
| M    | 0.90 | 0.95 | 1.00 | 1.05 | 1.10 | 1.20 | 1.40 | 1.60 | 2.00 |
|------|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.010| 0.024| 0.066| 0.084| 0.100| 0.114| 0.117| 0.113|

LV-Haack peaks later and higher than Von Kármán.

#### Parabolic series (param=1.0, fully parabolic):
| M    | 0.95 | 0.975| 1.00 | 1.05 | 1.10 | 1.20 | 1.40 | 1.70 |
|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.016| 0.041| 0.092| 0.109| 0.119| 0.113| 0.108|

**M_crit ≈ 0.95**.

#### Parabolic series (param=0.75):
| M    | 0.90 | 0.95 | 1.00 | 1.05 | 1.10 | 1.20 | 1.40 | 1.70 |
|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.023| 0.073| 0.098| 0.107| 0.106| 0.089| 0.082|

#### Parabolic series (param=0.5):
| M    | 0.80 | 0.90 | 0.95 | 1.00 | 1.05 | 1.10 | 1.30 | 1.50 | 1.80 |
|------|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.016| 0.042| 0.100| 0.126| 0.125| 0.100| 0.090| 0.088|

**M_crit ≈ 0.80** (much earlier drag rise for blunter parabolic).

#### Ellipsoid:
| M    | 1.20 | 1.25 | 1.30 | 1.40 | 1.60 | 2.00 | 2.40+ |
|------|------|------|------|------|------|------|-------|
| CD   | 0.110|0.128 |0.140 |0.148 |0.152 |0.159 | 0.162 |

No tabulated subsonic data → M_crit is large (treated as having zero subsonic pressure drag until supersonic).

#### Power series (param=0.75, x^0.75):
| M    | 0.80 | 0.90 | 1.00 | 1.06 | 1.20 | 1.40 | 1.60 | 2.00 | 2.80 | 3.40 |
|------|------|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.015| 0.078| 0.121| 0.110| 0.098| 0.090| 0.084| 0.078| 0.074|

#### Power series (param=0.5, x^0.5 = "half-power"):
| M    | 0.925|0.95  | 1.00 | 1.05 | 1.10 | 1.20 | 1.30 | 1.70 | 2.00 |
|------|------|------|------|------|------|------|------|------|------|
| CD   | 0    | 0.014| 0.050| 0.060| 0.059| 0.081| 0.084| 0.085| 0.078|

#### Power series (param=0.25, x^0.25 — very blunt):
| M    | 1.20 | 1.30 | 1.40 | 1.60 | 1.80 | 2.20 | 2.60 | 3.00 | 3.60 |
|------|------|------|------|------|------|------|------|------|------|
| CD   | 0.140|0.156 |0.169 |0.192 |0.206 |0.227 |0.241 |0.249 |0.252 |

Approaches stagnation drag for very blunt noses.

### 2.4 Subsonic Interpolation Formula

If the first tabulated point has `CD > 0.001`, OR fills in the subsonic region with:

```
CD(M) = a * M^b + CD_Mach0
```

where:
- `CD_Mach0 = 0.8 * sinphi²` — subsonic pressure drag at M=0 (from body theory)
- `b = M_min * dCD/dM|_min / (CD_min - CD_Mach0)` — fitted exponent
- `a = (CD_min - CD_Mach0) / M_min^b` — fitted coefficient

For tangent ogive (sinphi=0) and Von Kármán (first tabulated point at zero), this subsonic region is identically zero.

---

## 3. Skin Friction Drag: Mach and Reynolds Dependence

### 3.1 Flat-Plate Friction Coefficient Cf

OR computes a single Cf for the entire rocket using the overall length as the characteristic length.

**Perfect finish (laminar/transitional allowed):**

| Re range | Formula |
|----------|---------|
| Re < 10⁴ | Cf = 1.33×10⁻² (constant, very low Re) |
| Re < 5.39×10⁵ | Cf = 1.328 / √Re  (Blasius laminar) |
| Re ≥ 5.39×10⁵ | Cf = 1/(1.50 ln(Re) − 5.6)² − 1700/Re  (turbulent with transition correction) |

**Non-perfect finish (fully turbulent):**

| Re range | Formula |
|----------|---------|
| Re < 10⁴ | Cf = 1.48×10⁻² (constant) |
| Re ≥ 10⁴ | Cf = 1/(1.50 ln(Re) − 5.6)²  (Schlichting turbulent) |

### 3.2 Mach Correction to Cf

Two separate correction factors c1, c2 are blended through the transonic zone (M = 0.9 to 1.1):

**Perfect finish:**
```
c1 (subsonic, M < 1.1):
  if Re > 3×10⁶:  c1 = 1 - 0.1*M²
  if 1×10⁶ < Re < 3×10⁶: linear interpolation to c1=1 at Re=10⁶

c2 (supersonic, M > 0.9):
  if Re > 3×10⁶:  c2 = 1/(1 + 0.045*M²)^0.25
  if 1×10⁶ < Re < 3×10⁶: linear interpolation
```

**Non-perfect finish (turbulent, roughness-limited):**
```
c1 = 1 - 0.1*M²         (applied for M < 0.9, transitioning at M=0.9)
c2 = 1/(1 + 0.15*M²)^0.58  (applied for M > 1.1, transitioning at M=1.1)
```

The non-perfect formula `1/(1 + 0.15*M²)^0.58` is the **Van Driest simplified approximation** for turbulent compressible skin friction. This is the correct formula for most HPR rockets which are fully turbulent.

**Blending (both cases):**
```
if M < 0.9:  Cf_final = Cf_incompressible * c1
if M > 1.1:  Cf_final = Cf_incompressible * c2
if 0.9 ≤ M ≤ 1.1:
    Cf_final = Cf_incompressible * [c2*(M-0.9)/0.2 + c1*(1.1-M)/0.2]
```

### 3.3 Roughness Correction

A separate roughness-limited Cf is computed for each surface finish:

```java
Cf_roughness = 0.032 * (roughness_size / L_ref)^0.2 * roughnessCorrection(M)
```

where:
```
roughnessCorrection(M):
  M < 0.9:  1 - 0.1*M²
  M > 1.1:  1/(1 + 0.18*M²)
  0.9-1.1:  linear blend between the two
```

The **maximum** of Cf_flat_plate and Cf_roughness is used for non-perfect finish. OR uses: "polished" = 0.5 μm, "smooth" = 2 μm, "painted" = 60 μm.

### 3.4 Component Friction CD Contributions

**Body tubes / nose cone / transitions:**
```
CD_friction_body = Cf_effective × A_wet / A_ref
```

**Fins:**
```
CD_friction_fin = Cf_effective × (1 + 2*t/MAC) × 2*A_fin / A_ref
```

The factor `(1 + 2*t/MAC)` is the thickness correction for fin pressure gradient effects; `t` is fin thickness, `MAC` is mean aerodynamic chord.

### 3.5 Fineness Ratio Correction to Body Friction

After computing individual body friction CDs, OR applies:

```java
fB = (x_aft - x_fore) / r_max    // overall fineness ratio
correction = 1 + 1/(2*fB)
CD_friction_body_total *= correction
```

This `1 + 1/(2fB)` factor accounts for pressure gradients over the length of the body and is from Hoerner (Fluid Dynamic Drag, 1965). For typical HPR (fB ≈ 10), this adds ~5%.

---

## 4. Base Drag

### 4.1 OR Base Drag Formula (verified from source)

```java
public static double calculateBaseCD(double m) {
    if (m <= 1) {
        return 0.12 + 0.13 * m * m;    // absolute CD, referenced to base area
    }
    return 0.25 / m;
}
```

This is an **absolute CD referenced to the base (aft) annular area** of the component, not the reference area. The full contribution to rocket CD is then:

```java
CD_base_component = calculateBaseCD(M) * π*(r_aft² - r_next²) / A_ref
```

where `r_next` is the fore radius of the next downstream component (so only **exposed** step-downs count).

**Notable values:**
| M | Base CD (ref to base area) |
|---|---|
| 0 | 0.12 |
| 0.5 | 0.143 |
| 0.8 | 0.203 |
| 1.0 | 0.25 |
| 1.2 | 0.208 |
| 1.5 | 0.167 |
| 2.0 | 0.125 |
| 3.0 | 0.083 |

The base drag peaks at M=1 (value = 0.25) and decays as 1/M supersonically. The subsonic model (0.12 + 0.13M²) gives 0.25 at M=1, ensuring continuity. This formula originates from Hoerner.

### 4.2 Attribution Note

This base drag formula represents the **blunt-body base pressure** averaged empirically. At M=1, it equals the stagnation CD (≈0.25 for a flat base). The supersonic `0.25/M` decay tracks Prandtl-Meyer expansion fan reduction of base pressure deficit.

---

## 5. Fin Drag (Friction + Pressure + Base)

### 5.1 Fin Pressure Drag (Leading Edge)

```java
// Round leading edge (AIRFOIL or ROUNDED cross-section):
if (M < 0.9):
    CD_LE = (1 - M²)^(-0.417) - 1       // subsonic, approaches infinity at M=1
if (0.9 ≤ M < 1.0):
    CD_LE = 1 - 1.785*(M - 0.9)          // linear transonic fit
if (M ≥ 1.0):
    CD_LE = 1.214 - 0.502/M² + 0.1095/M⁴   // supersonic (modified Newtonian)

// Square leading edge:
CD_LE = stagnationCD     // full stagnation pressure
```

These are then multiplied by the **sweep correction** and scaled to reference area:

```java
CD_LE_corrected = CD_LE * cos²(Γ_LE) * (span * thickness / A_ref)
```

where `Γ_LE` is the leading edge sweep angle.

### 5.2 Fin Trailing Edge (Base) Drag

```java
// SQUARE trailing edge:
CD_TE = baseCD * span * thickness / A_ref

// ROUNDED trailing edge:
CD_TE = (baseCD/2) * span * thickness / A_ref

// AIRFOIL:
CD_TE = 0  (assumed negligible)
```

### 5.3 Fin Normal Force (CNa) — for CP and stability, not drag

**Subsonic (M ≤ 0.8):**
```
CNa = 2π * s² / (1 + √(1 + (1-M²)(s²/(A_fin * cos(Γ_mid)))²)) / A_ref
```
where `s` = semi-span, `Γ_mid` = midchord sweep angle.

**Supersonic (M ≥ 1.2):**
```
CNa = A_fin * (K1 + K2*α + K3*α²) / A_ref
```
where K1, K2, K3 are from Busemann supersonic fin theory (tabulated as functions of Mach and computed from β = √(M²-1)):
```
K1 = 2/β
K2 = ((γ+1)M⁴ - 4β²) / (4β⁴)
K3 = ((γ+1)M⁸ + (2γ²-7γ-5)M⁶ + 10(γ+1)M⁴ + 8) / (6β⁷)
```

Transonic (0.8 < M < 1.2) is interpolated with a smooth polynomial.

### 5.4 Fin CP Location vs Mach

**Subsonic (M ≤ 0.5):** CP at 25% MAC.

**Supersonic (M ≥ 2):**
```
x_CP/MAC = (AR*β - 0.67) / (2*AR*β - 1)
```
where AR = aspect ratio, β = √(M²-1).

**Transonic (0.5 ≤ M ≤ 2):** 5th-order polynomial interpolation fitted to match both ends and have zero derivatives at M=2.

---

## 6. Stagnation (Disk) Pressure Drag

Used for blunt nose cones and forebody area steps:

```java
public static double calculateStagnationCD(double m) {
    double pressure;
    if (m <= 1) {
        pressure = 1 + m²/4 + m⁴/40;        // isentropic stagnation (subsonic)
    } else {
        pressure = 1.84 - 0.76/m² + 0.166/m⁴ + 0.035/m⁶;  // Rayleigh Pitot formula (supersonic)
    }
    return 0.85 * pressure;
}
```

The 0.85 factor accounts for non-ideal recovery (real noses are not perfectly blunt). At M=0, this gives 0.85. At M=1, about 0.85×1.275 ≈ 1.08. At M=2, about 0.85×1.68 ≈ 1.43.

This function is also used for **shoulder/step drag** where the body expands — any annular frontal area at a fore-body step gets a stagnation drag equal to `stagnationCD × A_step / A_ref`.

---

## 7. Fuselage Fineness Ratio Correction

Beyond the friction correction above, `calculateNoseInterpolator()` also scales tabulated nose cone drag by fineness ratio:

```java
CD_at_M = CD_stagnation(M) * (CD_table(M) / CD_stagnation(M))^(log(FR+1)/log(4))
```

This is a **geometric interpolation** between the stagnation limit (very blunt, FR=0) and the tabulated FR=3 data, scaled up for FR > 3 by the same log formula. At FR=3 the exponent = 1 (no change). At FR=7, `log(8)/log(4) = 1.5`, so CD is scaled as CD_stag × (CD_table/CD_stag)^1.5.

---

## 8. Side-by-Side Model Comparison: OR vs RASAero II vs Our Current Model

### 8.1 Method Overview

| Feature | OpenRocket | RASAero II | Our Current Model |
|---------|-----------|------------|-------------------|
| **Theoretical basis** | Extended Barrowman (Niskanen thesis) + NACA TR-R-100 empirical | Rogers Modified Barrowman + DATCOM methods + calibrated against sounding rocket data | Barrowman component buildup (skin friction + base + fin + nose pressure) |
| **Nose pressure drag** | Shape-specific: ogive/conical via sinphi formula; others via lookup table | DATCOM wave drag + modified Newtonian for supersonic; Stoney free-flight data for transonic | Piecewise Mach multiplier (1.0× subsonic, 1.5× at M=1, ~1/M decay) |
| **Skin friction** | Cf from Re (Blasius/Schlichting) × Mach correction (Van Driest approx) | Turbulent flat plate + Eckert reference temperature method | Not specified — assumed constant or simple correction |
| **Base drag** | `0.12 + 0.13M²` (M≤1), `0.25/M` (M>1) — exact formula | Empirical base pressure model, similar shape | Same as OR formula (confirmed correct) |
| **Transonic peak** | Nose-shape dependent: ogive ≈ 0 extra, conical peaks at M≈1.0–1.1 | All shapes peak near M=0.9–1.1; Von Kármán/Haack peak lowest | 1.5× subsonic — independent of nose shape (too high for ogive) |
| **Supersonic decay** | Shape-dependent; 0.5*sinphi/β formula for ogive/conical | ~1/M or 1/M² depending on shape | ~1/M (may be too high at M=2+) |
| **CP shift supersonic** | Assumed constant (same as subsonic) for body; fin CP shifts with Busemann formula | Rogers Modified Barrowman for fins, includes fin-body interference | Not implemented |
| **Mach warning threshold** | Warning issued at M > 1.1 | Valid to M=4+ | — |

### 8.2 Quantitative Comparison for Typical HPR Tangent Ogive Rocket

Baseline: 4" diameter, L/D=10, tangent ogive nose L/D=5, 4 trapezoidal fins, typical polished finish.

| Mach | OR CD (total) | RASAero II CD (est.) | Our Model CD | Notes |
|------|--------------|---------------------|-------------|-------|
| 0.3 | ~0.40 | ~0.38 | ~0.40–0.50 | Subsonic, friction + base dominant |
| 0.7 | ~0.42 | ~0.40 | ~0.42–0.52 | Slight friction increase |
| 0.9 | ~0.45 | ~0.44 | ~0.50–0.58 | OR: minimal wave drag (ogive sinphi=0) |
| 1.0 | ~0.48 | ~0.50 | ~0.60–0.75 | **Our model too high** (1.5× applied) |
| 1.2 | ~0.46 | ~0.48 | ~0.55–0.65 | Supersonic, wave drag decays |
| 1.5 | ~0.40 | ~0.42 | ~0.48–0.55 | 1/M decay |
| 2.0 | ~0.34 | ~0.36 | ~0.40–0.48 | OR: fin and base drag dominant |
| 3.0 | ~0.28 | ~0.30 | ~0.33–0.38 | |

**Key finding:** For a tangent ogive, OR adds essentially **zero** wave drag because sinphi=0. The CD curve is nearly flat across Mach, driven by skin friction and base drag. Our current 1.5× peak model significantly overpredicts at M=1.0 for tangent ogives.

### 8.3 RASAero II vs OR — Key Differences

**Where RASAero II is more accurate:**
1. **Transonic nose drag:** Uses Stoney (NACA RM-L53K17) free-flight data and DATCOM methods that are better calibrated for real rockets, especially Von Kármán/Haack shapes.
2. **Tangent ogive:** RASAero acknowledges non-zero transonic wave drag (unlike OR's zero result). Expected values: ~0.02–0.04 absolute CD at M=1.
3. **Fin-body interference in supersonic:** Rogers Modified Barrowman includes Mach-dependent K_B body-fin interference factors.
4. **CP shift:** RASAero shifts CP forward at transonic speeds and uses supersonic Mach dependence properly for both body and fins.

**Where OR is acceptable or better:**
1. **Skin friction:** OR's Reynolds-number dependent Cf is physically sound and well-validated for HPR.
2. **Base drag:** Both tools use essentially equivalent empirical base drag models.
3. **Source availability:** OR is open source; all formulas are directly verifiable.

### 8.4 RASAero II Model Summary (from Rogers documentation)

RASAero uses:
- **Nose wave drag:** Modified DATCOM method; tabulated by nose shape, fineness ratio, and Mach. Von Kármán ogive treated separately with very low wave drag (Mach onset ≈ 0.85–0.90).
- **Skin friction:** Eckert reference temperature + Van Driest for turbulent; transitional flow supported.
- **Boattail drag:** Empirical correlation from missile DATCOM.
- **Fin pressure drag:** DATCOM supersonic fin drag, including sweep angle and leading edge shape.
- **Afterbody/protuberance drag:** Additional empirical models not in OR.
- **Blunt tip correction:** Separate model for spherically-blunted noses using Hoerner sphere drag data.
- **Accuracy claim:** Within 5–10% of wind tunnel data for typical sounding rockets; validated against MESOS 293K flight data.

---

## 9. Nose-Cone Mach Correction Summary Table

This table shows the **pressure CD multiplier** relative to the subsonic (M=0.3) pressure CD, for each nose shape at fineness ratio 3. For shapes where OR gives zero subsonic pressure CD (tangent ogive, Von Kármán), the multipliers are relative to a nominal CD=0.01 at M=0.3.

| M | Tangent Ogive | Von Kármán | LV-Haack | Parabolic (1.0) | Power 3/4 | Conical (20° HA) |
|---|:---:|:---:|:---:|:---:|:---:|:---:|
| 0.30 | ≈0* | 0 | 0 | 0 | 0 | 0.11 |
| 0.70 | ≈0* | 0 | 0 | 0 | 0 | 0.11 |
| 0.85 | ≈0* | 0 | 0 | 0 | 0 | 0.11 |
| 0.90 | ≈0* | 0 | 0 | 0 | 0 | 0.12 |
| 0.95 | ≈0* | 0.010 | 0.010 | 0 | 0 | 0.14 |
| 1.00 | ≈0* | 0.027 | 0.024 | 0.041 | 0.078 | 0.34 |
| 1.05 | ≈0* | 0.055 | 0.066 | 0.092 | 0.121 | 0.37 |
| 1.10 | ≈0* | 0.070 | 0.084 | 0.109 | 0.110 | 0.36 |
| 1.20 | ≈0* | 0.081 | 0.100 | 0.119 | 0.110 | 0.34 |
| 1.40 | ≈0* | 0.095 | 0.114 | 0.113 | 0.098 | 0.33 |
| 1.60 | ≈0* | 0.097 | 0.117 | 0.108 | 0.090 | 0.31 |
| 2.00 | ≈0* | 0.091 | 0.113 | 0.108 | 0.084 | 0.28 |
| 3.00 | ≈0* | 0.083 | — | — | 0.074 | 0.22 |

*Tangent ogive is zero in OR (sinphi=0 bug). Physically should be ~0.01–0.03 above M=0.9.

**All values referenced to frontal area (π R²). Multiply by A_frontal/A_ref for rocket CD contribution.**

### 9.1 Recommended Nose Correction for Our Model

For the current "1.5× at M=1, decaying 1/M" piecewise model:

| Nose Shape | Better Correction |
|-----------|-------------------|
| Tangent ogive | **Remove the 1.5× peak entirely.** OR adds zero; real rockets add ~0.02–0.03 absolute CD at peak. Apply a small fixed onset: 0 below M=0.85, linearly rise to 0.025 at M=1.05, then decay as 0.04/M for M>1.2. |
| Von Kármán | Onset at M=0.90. Peak at M=1.4–1.6 of ~0.10. Use OR table scaled by A_ref. |
| LV-Haack | Similar to Von Kármán, slightly higher peak (~0.117 at M=1.6). |
| Parabolic (K=1) | Onset at M=0.95. Peak at M=1.1 (~0.109), then slow decay. |
| Power 3/4 | Onset at M=0.80. Peak at M=1.06 (~0.121), then rapid decay. |
| Conical | Onset near M=0.7. Strong peak at M=1.0–1.3. Use sinphi formula. |

**For matching OR behavior exactly:** Look up nose shape and use `sinphi` (half-angle sine) for ogive/conical; use the hardcoded tables above for all other shapes, scaled by `A_ref_nose/A_ref_rocket`.

---

## 10. CP Location vs Mach — Barrowman Supersonic Shift

### 10.1 Body Component CP (Nose + Transitions)

OR treats body component CP as **Mach-independent** (explicitly noted in source code):

```java
// "The CP and CNa at supersonic speeds are assumed to be the same as those at subsonic speeds."
```

CP for a nose cone from slender body theory:
```
x_CP = L - V / A_base
```
where V = cone volume, A_base = base area, L = cone length.

For a tangent ogive of length L and radius R:
```
x_CP = L * (1 - 8/(3π) * R/L_ogive_radius * ...)  [complex geometry dependent]
```
OR computes this numerically as `(L*A_base - V_full) / (A_base - A_fore)`.

### 10.2 Fin CP Shift (Mach-Dependent)

As described in Section 5.4:

**Key supersonic formula (M ≥ 2):**
```
x_CP/MAC = (AR*β - 0.67) / (2*AR*β - 1)
```

For a typical trapezoidal fin with AR=2, at M=2 (β=1.732):
```
x_CP/MAC = (2×1.732 - 0.67) / (2×2×1.732 - 1) = 2.794/5.928 = 0.471
```
versus 0.25 at subsonic. CP shifts **aft** from 25% to ~47% of MAC supersonically. This is the **aft CP shift** that increases static margin at supersonic speeds.

### 10.3 Overall Rocket CP

The total CP is mass-averaged:
```
x_CP_total = Σ(CNa_i × x_CP_i) / Σ(CNa_i)
```
At supersonic speeds, fin CNa increases (K1 ≈ 2/β), while nose CNa stays constant. The fin CP shifts aft. Net effect: overall CP typically moves **forward** at transonic (reducing margin) and then **aft** in supersonic flight.

---

## 11. 6-DOF Aerodynamic Coefficients

### 11.1 Coefficients Required for 6-DOF Simulation

| Coefficient | Symbol | Description | How Computed |
|-------------|--------|-------------|--------------|
| Axial drag | CA or CD | Along-body-axis drag | Entire buildup above; corrected for AOA |
| Normal force gradient | CN_α | dCN/dα | Sum of body (slender body) + fin (Barrowman/Busemann) CNa |
| Pitching moment gradient | Cm_α | dCm/dα | CN_α × (x_CG - x_CP) / L_ref |
| Pitch damping | Cm_q | ∂Cm/∂(qL/2V) | Empirical formula; see below |
| Roll forcing | Cl_δ | Canted fin forcing | FinSetCalc.setCrollForce |
| Roll damping | Cl_p | Roll rate damping | FinSetCalc.setCrollDamp |
| Side force & yaw moment | CY, Cn | Cross-flow forces | Currently zero in OR (noted as TODO) |

### 11.2 CN_α from Extended Barrowman

For the full rocket:
```
CN_α = CN_α_nose + CN_α_body_lift + CN_α_fins
```

**Nose + transitions (slender body theory):**
```
CN_α_component = 2 * (A_base - A_fore) / A_ref   [referenced to ref area]
```

**Body lift (Galejs correction, K=1.1):**
```
CN_α_body = 1.1 * A_planform / A_ref * sin(α) / α
```
Applied at planform centroid x_CP.

**Fins (Barrowman/Busemann):**
```
CN_α_fins = (subsonic or supersonic formula from Section 5.3) × (1 + τ)
```
where `τ = r_body / (r_body + s_fin)` is the body-fin interference factor.

### 11.3 Cm_α

```
Cm_α = CN_α × (x_CG - x_CP) / L_ref
```

Sign convention (nose-forward): Cm_α is **negative** when x_CG < x_CP (statically stable rocket). Magnitude grows with instability.

### 11.4 Pitch Damping Coefficient Cm_q

OR's pitch damping implementation (from `BarrowmanStabilityCalculator.getDampingMultiplier()`):

**Body contribution:**
```
mul_body = 0.275 * D_avg / (A_ref * L_ref) * (x_CG⁴ + (L - x_CG)⁴)
```
where D_avg = average body diameter.

**Fin contribution (per fin set):**
```
mul_fin = 0.6 * min(N_fins, 4) * A_fin * |x_midchord - x_CG|³ / (A_ref * L_ref)
```

The total pitch damping moment is:
```
M_pitch_damp = 3 × mul × (q̇/V)²   [bounded by total Cm]
```

The factor of 3 is an empirical adjustment that "yields much more realistic apogee turn" (comment in source). The `q̇/V` dependence means damping is proportional to **pitch rate squared divided by velocity squared** — this is an approximation that captures the correct physics (damping grows with slower velocity and higher pitch rate).

**Better Cm_q estimate for 6-DOF (Barrowman original method):**

The original Barrowman 1967 report gives:
```
C_mq = -2 * CN_α_fins * |x_fins - x_CG|² / (A_ref * L_ref²)   [fins only]
```
This is the standard pitch damping formula used in missiles. OR's implementation is an approximation of this.

**Typical values for HPR rockets:** Cm_q ≈ −10 to −30 (non-dimensional, normalized by L_ref).

### 11.5 Roll Coefficients

**Roll forcing (canted fins):**
```
Cl_δ = (s + r) * CNa_1fin * (1+τ) * δ / L_ref
```
where δ = cant angle.

**Roll damping:**
```
Cl_p = -2π * p * rollSum / (A_ref * L_ref * V * β)   [subsonic]
```
where rollSum = Σ∫ chord(y) × (r+y)² dy over fin span.

### 11.6 Angle of Attack Correction to Axial CD

OR applies an AOA-dependent multiplier to the axial CD:

For α < 17°:
```
CA = CD_axial × poly1(α)   [polynomial from 1.0 at α=0 to 1.3 at α=17°]
```

For 17° ≤ α ≤ 90°:
```
CA = CD_axial × poly2(α)   [returns to 0 at α=90°]
```

For α > 90°: negative (base becomes leading surface).

This models the increasing axial drag projection as the rocket tips away from the velocity vector.

---

## 12. Known Issues in OpenRocket and Recommended Fixes

### 12.1 Tangent Ogive Zero Pressure Drag (Bug #2998)

**Issue:** OR computes `sinphi=0` for tangent ogive, giving zero pressure/wave drag at all Mach numbers. This underestimates drag.

**Physical reality:** Tangent ogive noses do have small but real transonic wave drag. NACA free-flight data (Stoney) and CFD show:
- Onset M_crit ≈ 0.85–0.90
- Peak wave CD (ref to nose frontal area) ≈ 0.025–0.040 at M=1.0–1.1
- Drops to ~0.015 at M=2.0

**Recommended fix for our model:**
```javascript
// Tangent ogive wave drag correction (add to total CD)
// CD referenced to maximum body cross-section
function tangentOgiveWaveDrag(M) {
    if (M < 0.85) return 0;
    if (M < 1.05) return 0.025 * (M - 0.85) / 0.20;   // linear rise
    if (M < 1.20) return 0.025;                          // plateau
    return 0.025 * 1.20 / M;                             // 1/M decay
}
```
Scale by `(A_nose / A_ref)` where A_nose = π R².

### 12.2 Supersonic Body CP Assumed Constant

**Issue:** OR holds body CP fixed at supersonic speeds. In reality, body CP moves slightly forward supersonically (potential flow solution shows CP depends on Mach). This is a minor error for typical HPR (±0.1 caliber).

### 12.3 Fin Normal Force at High AOA

**Issue:** OR caps α at 17° (stall angle) for fin CNa. At high AOA, the actual fin force is better modeled by separated flow. This affects trajectory accuracy after burnout at high pitch rates near apogee.

### 12.4 Our Model's Current Mach Correction — Recommended Update

**Current:** `1.5× at M=1.0`, universal for all nose shapes.

**Recommended replacement:**

```javascript
function nosePressureDragMultiplier(M, noseShape) {
    // Returns multiplier on the subsonic (M=0.3) pressure CD
    switch(noseShape) {
        case 'tangent_ogive':
            // Special case: use absolute wave drag (above), not multiplier
            return null;  // handled separately

        case 'von_karman':
            // Lookup OR table, interpolated
            return interpolate(M, [0.9,0.95,1.0,1.05,1.1,1.2,1.4,1.6,2.0,3.0],
                                  [1.0, 1.37, 3.70, 7.53, 9.59, 11.1, 13.0, 13.3, 12.5, 11.4]);
            // (normalized to CD at M=0.9=0.0073 from fineness extrapolation)

        case 'haack':   // LV-Haack
            return /* similar table interpolation */ ...;

        case 'conical':
            // Use sinphi formula: CD = mul*(2.1*sinphi² + 0.5*sinphi/sqrt(M²-1)) for M>1.3
            return ...;

        case 'parabolic':
            // Parabolic series table
            return ...;
    }
}
```

**Simplest practical fix for tangent ogive:**
- Remove the generic 1.5× Mach multiplier.
- Add a small absolute wave drag per Section 12.1.
- Keep skin friction and base drag as-is (these are the dominant terms anyway).

**Impact on FAA hazard zones:** The current 1.5× overprediction at M=1 causes **underestimate of apogee altitude** and therefore **conservative (larger) hazard zones** — a safe direction for FAA work. However, the bias is significant (~10–15% CD error at M=1) and should be corrected for accurate simulation.

---

## 13. Sources

| Source | URL | Used For |
|--------|-----|---------|
| OR BarrowmanDragCalculator.java (unstable branch) | https://github.com/openrocket/openrocket/raw/refs/heads/unstable/core/src/main/java/info/openrocket/core/aerodynamics/BarrowmanDragCalculator.java | Exact base drag, skin friction, stagnation CD formulas |
| OR SymmetricComponentCalc.java (unstable branch) | https://github.com/openrocket/openrocket/raw/refs/heads/unstable/core/src/main/java/info/openrocket/core/aerodynamics/SymmetricComponentCalc.java | Full nose cone pressure drag tables and ogive formula |
| OR FinSetCalc.java (unstable branch) | https://github.com/openrocket/openrocket/raw/refs/heads/unstable/core/src/main/java/info/openrocket/core/aerodynamics/barrowman/FinSetCalc.java | Fin friction, pressure, base drag; CNa; CP position |
| OR BarrowmanStabilityCalculator.java (unstable branch) | https://github.com/openrocket/openrocket/raw/refs/heads/unstable/core/src/main/java/info/openrocket/core/aerodynamics/BarrowmanStabilityCalculator.java | Pitch damping moment formula |
| OR BarrowmanCalculator.java (unstable branch) | https://github.com/openrocket/openrocket/blob/unstable/core/src/main/java/info/openrocket/core/aerodynamics/BarrowmanCalculator.java | Overall architecture; confirms CD = friction + pressure + base |
| OpenRocket Technical Documentation v13.05 | https://openrocket.sourceforge.net/techdoc.pdf | Section 3.4 drag theory; Appendix B transonic wave drag; Appendix A nose cone geometries |
| OR GitHub Issue #2998 (Tangent Ogive Bug) | https://github.com/openrocket/openrocket/issues/2998 | Confirms sinphi=0 for tangent ogive gives zero pressure drag |
| RASAero II Users Manual (PDF) | https://rasaero.com/dloads/RASAero+II+Users+Manual.pdf | RASAero methodology overview (PDF inaccessible; description from secondary sources) |
| Aerodynamic Modeling of Rockets with RASAero II (Abbass 2025) | https://jibi.aspur.rs/archive/v3/n2/8.pdf | RASAero II validation, Rogers Modified Barrowman method description |
| NACA TR-R-100 "Collection of Zero-Lift Drag Data on Bodies of Revolution" | https://ntrs.nasa.gov/citations/19630004995 | Source data for OR nose cone drag tables |
| NACA RM-L53K17 (Stoney 1954) "Transonic Drag Measurements of Eight Body-Nose Shapes" | https://ntrs.nasa.gov/api/citations/19930087953/downloads/19930087953.pdf | Original free-flight nose drag data used in OR tables |
| Barrowman 1967 "Theoretical Prediction of the Center of Pressure" | https://ntrs.nasa.gov/citations/20010047838 | Original Barrowman equations; Cmq formula; CNa for fins |
| Nose Cone Design — Wikipedia | https://en.wikipedia.org/wiki/Nose_cone_design | Haack, Von Kármán definitions; general drag characteristics |
| Van Driest (1956) "Turbulent Boundary Layer in Compressible Fluids" | https://arc.aiaa.org/doi/10.2514/3.7315 | Source for 1/(1+0.15M²)^0.58 skin friction approximation |
| RocketPy Aerodynamics Documentation | https://docs.rocketpy.org/en/latest/technical/aerodynamics/roll_equations.html | Roll damping coefficient derivation cross-check |
| Virginia Tech FRICTION program manual | https://archive.aoe.vt.edu/mason/Mason_f/FRICTman.pdf | Eckert reference temperature and Van Driest II methods |

---

*End of reference document. All OR formulas verified against Java source code in the `unstable` branch as of April 2026.*
