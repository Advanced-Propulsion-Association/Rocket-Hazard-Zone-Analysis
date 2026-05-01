"""
FAA Hazard Zone Calculator — Systematic Validation Script
Tests Tier 1 and Tier 2 across a wide range of inputs.
Flags results outside expected bounds.
"""

import sys
import math
import traceback

sys.path.insert(0, r'C:\Users\bsoltes\FAA Hazard analysis')
from simulation_engine import (
    make_boxcar_motor, RocketConfig, compute_hazard_zone,
    tier1_hazard_zone, HazardZoneResult
)

M_TO_FT = 3.28084
IN_TO_M = 0.0254
LB_TO_KG = 0.453592

results_table = []

def check(label, result: HazardZoneResult, apogee_ft=None):
    hz_ft = result.hazard_radius_ft
    ap_ft = result.max_apogee_ft if apogee_ft is None else apogee_ft
    ratio = hz_ft / ap_ft if ap_ft > 0 else float('inf')

    status = 'OK'
    flags = []
    if math.isnan(hz_ft) or math.isinf(hz_ft):
        status = 'FAIL'; flags.append('NaN/Inf hazard radius')
    elif hz_ft < 0:
        status = 'FAIL'; flags.append('negative hazard radius')
    elif hz_ft < 50:
        status = 'FAIL'; flags.append('hazard radius < 50ft (implausibly small)')
    elif ratio < 0.10:
        status = 'WARN'; flags.append(f'ratio={ratio:.2f} < 0.10 (suspiciously short)')
    elif ratio > 0.60:
        status = 'WARN'; flags.append(f'ratio={ratio:.2f} > 0.60 (suspiciously large)')

    results_table.append({
        'label': label, 'apogee_ft': ap_ft, 'hazard_ft': hz_ft,
        'quarter_ft': ap_ft / 4, 'ratio': ratio, 'status': status, 'flags': flags,
        'quarter_conservative': result.quarter_rule_conservative
    })
    flag_str = '  <-- ' + '; '.join(flags) if flags else ''
    print(f"[{label:<10}] apogee={ap_ft:>8,.0f}ft  hazard={hz_ft:>8,.0f}ft  "
          f"apogee/4={ap_ft/4:>7,.0f}ft  ratio={ratio:.2f}  [{status}]{flag_str}")


# ─── TIER 1 TESTS ─────────────────────────────────────────────────────────────
print("=" * 90)
print("TIER 1: APOGEE-ONLY MODE")
print("=" * 90)

tier1_cases = [
    ('T1-A',   500, 0),
    ('T1-B',  1000, 0),
    ('T1-C',  2500, 0),
    ('T1-D',  5000, 0),
    ('T1-E', 10000, 0),
    ('T1-F', 20000, 0),
    ('T1-G', 35000, 0),
    ('T1-H', 50000, 0),
    ('T1-E2',10000, 5000),
    ('T1-F2',20000, 8000),
]

for label, apogee_ft, site_ft in tier1_cases:
    try:
        r = tier1_hazard_zone(apogee_ft, site_elevation_ft=site_ft)
        check(label, r, apogee_ft=apogee_ft)
    except Exception as e:
        print(f"[{label:<10}] CRASH: {e}")
        traceback.print_exc()

# ─── TIER 2: MOTOR CLASS SWEEP ───────────────────────────────────────────────
print()
print("=" * 90)
print("TIER 2: MOTOR CLASS SWEEP  (3in dia, 36in long, 2 lb total)")
print("=" * 90)

dia_m  = 3.0 * IN_TO_M
len_m  = 36.0 * IN_TO_M
# Total mass includes motor mass; we'll keep dry mass fixed at ~1 lb and add prop mass
BASE_DRY_KG = 1.0 * LB_TO_KG   # 0.454 kg dry rocket

motor_cases = [
    ('T2-C',   9,    9, 1.0, 0.015),
    ('T2-F',  80,   40, 2.0, 0.060),
    ('T2-G2',160,   80, 2.0, 0.100),
    ('T2-H', 320,  160, 2.0, 0.200),
    ('T2-I', 640,  320, 2.0, 0.350),
    ('T2-J',1000,  400, 2.5, 0.500),
    ('T2-K',2560,  640, 4.0, 1.000),
    ('T2-L',5000, 1000, 5.0, 2.000),
    ('T2-M',9000, 1800, 5.0, 3.500),
]

for label, impulse_Ns, avg_N, burn_s, prop_kg in motor_cases:
    try:
        total_kg = BASE_DRY_KG + prop_kg
        motor = make_boxcar_motor(avg_N, burn_s, prop_kg, total_kg, name=label)
        cfg = RocketConfig(
            body_diameter_m=dia_m, body_length_m=len_m, total_mass_kg=total_kg,
            motor=motor, site_elevation_m=0, site_temperature_K=288.15,
            surface_wind_ms=8.94,  # 20 MPH
        )
        r = compute_hazard_zone(cfg)
        check(label, r)
    except Exception as e:
        print(f"[{label:<10}] CRASH: {e}")
        traceback.print_exc()

# ─── TIER 2: GEOMETRY SWEEP ──────────────────────────────────────────────────
print()
print("=" * 90)
print("TIER 2: GEOMETRY SWEEP  (all using H motor: 320 N·s, 160N avg, 2s burn, 200g prop)")
print("=" * 90)

H_motor_prop = 0.200
def make_H():
    return make_boxcar_motor(160, 2.0, H_motor_prop, H_motor_prop + 0.454, name='H-boxcar')

geo_cases = [
    ('T2-micro',   1.5, 12,  0.25),
    ('T2-small',   2.0, 24,  0.75),
    ('T2-mid',     3.0, 36,  2.0),
    ('T2-large',   4.0, 60,  5.0),
    ('T2-xlarge',  6.0, 96, 15.0),
]

for label, dia_in, len_in, mass_lb in geo_cases:
    try:
        total_kg = mass_lb * LB_TO_KG + H_motor_prop  # naive: add prop mass
        motor = make_H()
        cfg = RocketConfig(
            body_diameter_m=dia_in * IN_TO_M,
            body_length_m=len_in * IN_TO_M,
            total_mass_kg=total_kg,
            motor=motor,
            site_elevation_m=0, site_temperature_K=288.15,
            surface_wind_ms=8.94,
        )
        r = compute_hazard_zone(cfg)
        check(label, r)
    except Exception as e:
        print(f"[{label:<10}] CRASH: {e}")
        traceback.print_exc()

# ─── TIER 2: EDGE CASES ──────────────────────────────────────────────────────
print()
print("=" * 90)
print("TIER 2: EDGE CASES")
print("=" * 90)

# Zero-thrust motor
print("Edge: zero-thrust motor (should not crash, should return ~0 or small range)")
try:
    zero_motor = make_boxcar_motor(0.001, 0.01, 0.0, 0.454, name='ZeroThrust')
    cfg = RocketConfig(
        body_diameter_m=3.0*IN_TO_M, body_length_m=36.0*IN_TO_M,
        total_mass_kg=0.454, motor=zero_motor,
        site_elevation_m=0, site_temperature_K=288.15, surface_wind_ms=8.94,
    )
    r = compute_hazard_zone(cfg)
    print(f"  hazard={r.hazard_radius_ft:.0f}ft  apogee={r.max_apogee_ft:.0f}ft")
except Exception as e:
    print(f"  CRASH: {e}")
    traceback.print_exc()

# High elevation site
print("\nEdge: high-elevation site (H motor, 3in x 36in, 2lb, site=5000ft)")
try:
    motor = make_boxcar_motor(160, 2.0, 0.200, 0.654, name='H-highsite')
    cfg = RocketConfig(
        body_diameter_m=3.0*IN_TO_M, body_length_m=36.0*IN_TO_M,
        total_mass_kg=0.654, motor=motor,
        site_elevation_m=5000*0.3048, site_temperature_K=288.15,
        surface_wind_ms=8.94,
    )
    r = compute_hazard_zone(cfg)
    check('T2-highsite', r)
except Exception as e:
    print(f"  CRASH: {e}")
    traceback.print_exc()

# Hot day
print("\nEdge: hot day 110°F (H motor, 3in x 36in, 2lb)")
try:
    motor = make_boxcar_motor(160, 2.0, 0.200, 0.654, name='H-hot')
    T_hot = (110 - 32) * 5/9 + 273.15
    cfg = RocketConfig(
        body_diameter_m=3.0*IN_TO_M, body_length_m=36.0*IN_TO_M,
        total_mass_kg=0.654, motor=motor,
        site_elevation_m=0, site_temperature_K=T_hot,
        surface_wind_ms=8.94,
    )
    r = compute_hazard_zone(cfg)
    check('T2-hot', r)
except Exception as e:
    print(f"  CRASH: {e}")
    traceback.print_exc()

# Cold day
print("\nEdge: cold day 0°F (H motor, 3in x 36in, 2lb)")
try:
    motor = make_boxcar_motor(160, 2.0, 0.200, 0.654, name='H-cold')
    T_cold = (0 - 32) * 5/9 + 273.15
    cfg = RocketConfig(
        body_diameter_m=3.0*IN_TO_M, body_length_m=36.0*IN_TO_M,
        total_mass_kg=0.654, motor=motor,
        site_elevation_m=0, site_temperature_K=T_cold,
        surface_wind_ms=8.94,
    )
    r = compute_hazard_zone(cfg)
    check('T2-cold', r)
except Exception as e:
    print(f"  CRASH: {e}")
    traceback.print_exc()

# Zero wind
print("\nEdge: zero wind (H motor, 3in x 36in, 2lb)")
try:
    motor = make_boxcar_motor(160, 2.0, 0.200, 0.654, name='H-nowind')
    cfg = RocketConfig(
        body_diameter_m=3.0*IN_TO_M, body_length_m=36.0*IN_TO_M,
        total_mass_kg=0.654, motor=motor,
        site_elevation_m=0, site_temperature_K=288.15,
        surface_wind_ms=0.0,
    )
    r = compute_hazard_zone(cfg)
    check('T2-nowind', r)
except Exception as e:
    print(f"  CRASH: {e}")
    traceback.print_exc()

# ─── SUMMARY ─────────────────────────────────────────────────────────────────
print()
print("=" * 90)
print("SUMMARY")
print("=" * 90)

warns  = [r for r in results_table if r['status'] == 'WARN']
fails  = [r for r in results_table if r['status'] == 'FAIL']
ok     = [r for r in results_table if r['status'] == 'OK']

print(f"  Total cases: {len(results_table)}  |  OK: {len(ok)}  |  WARN: {len(warns)}  |  FAIL: {len(fails)}")

if warns:
    print("\n  WARNINGS:")
    for r in warns:
        print(f"    [{r['label']}] ratio={r['ratio']:.3f}  hazard={r['hazard_ft']:,.0f}ft  apogee={r['apogee_ft']:,.0f}ft")
        for f in r['flags']:
            print(f"      -> {f}")

if fails:
    print("\n  FAILURES:")
    for r in fails:
        print(f"    [{r['label']}] {r['flags']}")

print("\n  Quarter-rule check (is physics result < apogee/4?):")
for r in results_table:
    qc = "physics <= 1/4 rule" if r['quarter_conservative'] else "physics > 1/4 rule (1/4 rule underestimates!)"
    print(f"    [{r['label']:<10}] {r['hazard_ft']:>8,.0f}ft vs 1/4={r['quarter_ft']:>7,.0f}ft  -> {qc}")

# ─── KNOWN DISCREPANCY: Python Tier 1 vs TypeScript Tier 1 ────────────────────
print()
print("=" * 90)
print("NOTE: Python vs TypeScript Tier 1 discrepancy")
print("=" * 90)
print("""
  Python tier1_hazard_zone(): creates a synthetic motor to simulate FULL trajectory
    (ascent + descent). Uses back-calculated impulse to reach target apogee.
    CD=0.60 throughout (both ascent and descent).

  TypeScript computeTier1HazardZone(): DESCENT-FROM-APOGEE + geometric ascent offset.
    Simulates only the fall from apogee. Adds apogee*tan(20°)*0.4 for ascent.
    CD=0.60 for descent only.

  These will give different results. The TS approach directly controls the apogee
  (it always starts at exactly the stated altitude), while the Python approach
  reaches an ESTIMATED apogee that may differ from the requested value.

  To compare, run: python simulation_engine.py  (shows built-in validation)
""")

print("Script complete.")
