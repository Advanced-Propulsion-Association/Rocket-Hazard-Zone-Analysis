import zipfile, xml.etree.ElementTree as ET, math

def parse_radius(txt):
    if not txt: return 0
    t = txt.strip().lower()
    s = t[4:].strip() if t.startswith('auto') else t
    try:
        v = float(s)
        return v if v > 0 else 0
    except:
        return 0

def tube_mass(dens, r, t, L):
    if t <= 0 or t >= r or L <= 0: return 0
    ri = r - t
    return dens * math.pi * (r*r - ri*ri) * L

ORKFILE = 'C:/Users/bsoltes/Open Rocket Files/42_ORK_PR2.ork'
with zipfile.ZipFile(ORKFILE) as z:
    root = ET.fromstring(z.read('rocket.ork'))

items = []

for tag in ['bodytube', 'innertube']:
    for el in root.iter(tag):
        has_override = (el.get('overridemass') == 'true' or
                        el.find('mass') is not None or
                        el.find('overridemass') is not None)
        mat = el.find('material')
        dens = float(mat.get('density','0')) if mat is not None else 0
        r_txt = el.findtext('radius') or el.findtext('outerradius') or ''
        r = parse_radius(r_txt)
        t2 = float(el.findtext('thickness') or 0)
        L = float(el.findtext('length') or 0)
        m = tube_mass(dens, r, t2, L) if not has_override else 0
        items.append((tag, (el.findtext('name') or '?')[:30], dens, r, t2, L, m, has_override, ''))

for el in root.iter('nosecone'):
    has_override = (el.get('overridemass') == 'true' or
                    el.find('mass') is not None or
                    el.find('overridemass') is not None)
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    r = parse_radius(el.findtext('aftradius') or el.findtext('radius') or '')
    t2 = float(el.findtext('thickness') or 0)
    L = float(el.findtext('length') or 0)
    if r > 0 and t2 > 0 and L > 0:
        slant = math.sqrt(L*L + r*r)
        m = dens * math.pi * r * slant * t2
    else:
        m = 0
    items.append(('nosecone_body', (el.findtext('name') or '?')[:30], dens, r, t2, L,
                  m if not has_override else 0, has_override, ''))
    sL = float(el.findtext('aftshoulderlength') or 0)
    sR = float(el.findtext('aftshoulderradius') or 0)
    sT = float(el.findtext('aftshoulderthickness') or 0)
    sm = tube_mass(dens, sR, sT, sL) if not has_override else 0
    items.append(('nosecone_shoulder', (el.findtext('name') or '?')[:30], dens, sR, sT, sL, sm, has_override, ''))

for el in root.iter('tubecoupler'):
    has_override = (el.get('overridemass') == 'true' or
                    el.find('mass') is not None or
                    el.find('overridemass') is not None)
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    r_txt = el.findtext('outerradius') or el.findtext('radius') or ''
    r = parse_radius(r_txt)
    t2 = float(el.findtext('thickness') or 0)
    L = float(el.findtext('length') or 0)
    is_bare_auto = (r == 0 and r_txt.strip().lower() == 'auto')
    items.append(('TUBECOUPLER-MISSING', (el.findtext('name') or '?')[:30], dens, r, t2, L,
                  0, has_override, 'bare_auto' if is_bare_auto else ''))

for el in root.iter('bulkhead'):
    has_override = (el.get('overridemass') == 'true' or
                    el.find('mass') is not None or
                    el.find('overridemass') is not None)
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    r_txt = el.findtext('outerradius') or el.findtext('radius') or ''
    ro = parse_radius(r_txt)
    ri = parse_radius(el.findtext('innerradius') or '')
    t2 = float(el.findtext('length') or 0)
    m = dens * math.pi * (ro*ro - ri*ri) * t2 if ro > 0 and t2 > 0 and not has_override else 0
    is_bare_auto = (ro == 0 and r_txt.strip().lower() == 'auto')
    items.append(('bulkhead', (el.findtext('name') or '?')[:30], dens, ro, t2, 0, m, has_override,
                  'bare_auto_ZERO' if is_bare_auto else ''))

for el in root.iter('centeringring'):
    has_override = (el.get('overridemass') == 'true' or
                    el.find('mass') is not None or
                    el.find('overridemass') is not None)
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    ro_txt = el.findtext('outerradius') or el.findtext('radius') or ''
    ri_txt = el.findtext('innerradius') or ''
    ro = parse_radius(ro_txt)
    ri = parse_radius(ri_txt)
    t2 = float(el.findtext('length') or 0)
    m = dens * math.pi * (ro*ro - ri*ri) * t2 if ro > 0 and t2 > 0 and not has_override else 0
    flags = []
    if ro == 0 and ro_txt.strip().lower() == 'auto': flags.append('bare_ro')
    if ri == 0 and ri_txt.strip().lower() == 'auto': flags.append('bare_ri')
    items.append(('centeringring', (el.findtext('name') or '?')[:30], dens, ro, t2, 0, m, has_override,
                  '+'.join(flags) if flags else ''))

for el in root.iter('freeformfinset'):
    has_override = (el.get('overridemass') == 'true' or
                    el.find('mass') is not None or
                    el.find('overridemass') is not None)
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    nFins = int(el.findtext('fincount') or 3)
    t2 = float(el.findtext('thickness') or 0)
    tabH = float(el.findtext('tabheight') or 0)
    tabL_val = float(el.findtext('tablength') or 0)
    fp = el.find('finpoints')
    pts = []
    if fp is not None:
        for p in fp:
            pts.append((float(p.get('x',0)), float(p.get('y',0))))
    area = 0
    if len(pts) >= 3:
        for j in range(len(pts)):
            x1,y1 = pts[j]
            x2,y2 = pts[(j+1) % len(pts)]
            area += x1*y2 - x2*y1
    fin_area = abs(area)/2
    tab_area = tabH * tabL_val
    m_no_tab = dens * fin_area * t2 * nFins if not has_override else 0
    m_tab_extra = dens * tab_area * t2 * nFins if not has_override else 0
    items.append(('freeform_fin_area', (el.findtext('name') or '?')[:30], dens, fin_area, t2, nFins,
                  m_no_tab, has_override, ''))
    items.append(('freeform_tab-MISSING', (el.findtext('name') or '?')[:30], dens, tab_area, t2, nFins,
                  m_tab_extra, has_override, 'tab_not_included'))

for el in root.iter('shockcord'):
    has_override = (el.get('overridemass') == 'true' or
                    el.find('mass') is not None or
                    el.find('overridemass') is not None)
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    cord = float(el.findtext('cordlength') or 0)
    m = dens * cord if not has_override else 0
    items.append(('SHOCKCORD-MISSING', (el.findtext('name') or '?')[:30], dens, 0, 0, cord, m, has_override, ''))

print('=== COMPONENT_SUM (mass/overridemass tags) ===')
total_sum = 0
for el in root.iter():
    if el.tag in ('mass', 'overridemass'):
        try:
            v = float(el.text or '0')
            if v > 0:
                print(f'  {el.tag}: {v:.4f} kg')
                total_sum += v
        except:
            pass
print(f'  TOTAL: {total_sum:.4f} kg')

print()
print(f"{'Component':<28} {'Name':<32} {'dens':>6} {'r':>7} {'t':>8} {'L':>7} {'mass':>8}  flag")
total_geom_captured = 0
total_geom_missed = 0
for tag, name, dens, r, t2, L, m, override, note in items:
    if override:
        continue
    is_missed = 'MISSING' in tag or 'MISSING' in note
    marker = ' <--MISSED' if is_missed else ''
    print(f'{tag:<28} {name:<32} {dens:>6.0f} {r:>7.4f} {t2:>8.5f} {L:>7.4f} {m:>8.4f}  {note}{marker}')
    if is_missed:
        total_geom_missed += m
    else:
        total_geom_captured += m

print()
print(f'Geometry captured (current): {total_geom_captured:.4f} kg')
print(f'Geometry missed:             {total_geom_missed:.4f} kg  (NOTE: tubecouplers show 0 - bare_auto radius)')
print(f'Component sum:               {total_sum:.4f} kg')
print(f'Total currently computed:    {total_sum + total_geom_captured:.4f} kg  (dry, no motor)')
print()
print('Tubecoupler mass with resolved parent inner radius:')
r_c = 0.07366
t_c = 0.003175
L_c = 0.3302
dens_c = 1850.0
m_c = tube_mass(dens_c, r_c, t_c, L_c)
print(f'  Each coupler (r={r_c:.5f}, t={t_c:.6f}, L={L_c:.4f}): {m_c:.4f} kg')
print(f'  2 couplers total: {2*m_c:.4f} kg')
print()
print('Centering rings with resolved radii:')
r_o = 0.07366
r_i = 0.05207
dens_cr = 2700.0
t_cr = 0.01905
m_cr = dens_cr * math.pi * (r_o**2 - r_i**2) * t_cr
print(f'  Each ring (ro={r_o}, ri={r_i}, t={t_cr}): {m_cr:.4f} kg')
print(f'  2 rings total: {2*m_cr:.4f} kg')
print()
print('Bulkheads with resolved radii (solid disk, ri=0):')
r_bh = 0.07366
dens_bh = 1850.0
t_bh = 0.00508
m_bh = dens_bh * math.pi * r_bh**2 * t_bh
print(f'  Each bulkhead (ro={r_bh}, ri=0, t={t_bh}): {m_bh:.4f} kg')
print(f'  5 bulkheads total: {5*m_bh:.4f} kg')
print()
total_with_fixes = (total_sum + total_geom_captured + total_geom_missed +
                    2*m_c + 2*m_cr + 5*m_bh)
print(f'GRAND TOTAL with all fixes (dry, no motor): {total_with_fixes:.4f} kg')
print(f'  vs currently computed (dry):              {total_sum + total_geom_captured:.4f} kg')
delta = total_with_fixes - (total_sum + total_geom_captured)
print(f'  Delta (missing mass):                     +{delta:.4f} kg')
