import zipfile, xml.etree.ElementTree as ET, sys

with zipfile.ZipFile('C:/Users/bsoltes/Open Rocket Files/206_ORK_PR2.ork') as z:
    root = ET.fromstring(z.read('rocket.ork'))

# Find all elements with a direct <overridemass> child
# and show whether the overridemass attribute is active
print('=== Elements with <overridemass> CHILD (not attribute) ===')
for el in root.iter():
    om_child = el.find('overridemass')
    if om_child is None: continue
    # Is the override ACTIVE? In OR, active = overridemass attribute on the element == "true"
    active_attr = el.get('overridemass', '')
    om_val = om_child.text or ''
    mat = el.find('material')
    dens = float(mat.get('density','0')) if mat is not None else 0
    print(f'  <{el.tag}> name="{el.findtext("name","?")}" overridemass_attr="{active_attr}" child_val={om_val} density={dens:.0f}')

print()
print('=== Body tubes/innertubes blocked by overridemass child ===')
import math
def parse_r(txt):
    if not txt: return 0
    t=txt.strip().lower(); s=t[4:].strip() if t.startswith('auto') else t
    try: v=float(s); return v if v>0 else 0
    except: return 0

def tube_mass(d,r,t,L):
    if t<=0 or t>=r or L<=0: return 0
    return d*math.pi*(r*r-(r-t)**2)*L

for tag in ['bodytube','innertube','nosecone']:
    for el in root.iter(tag):
        om_child = el.find('overridemass')
        om_attr = el.get('overridemass','')
        if om_child is None: continue
        # Currently blocked — what would geometry give?
        mat = el.find('material'); dens = float(mat.get('density','0')) if mat is not None else 0
        r = parse_r(el.findtext('radius') or el.findtext('outerradius') or el.findtext('aftradius') or '')
        t2 = float(el.findtext('thickness') or 0)
        L = float(el.findtext('length') or 0)
        if tag == 'nosecone' and r > 0 and t2 > 0 and L > 0:
            slant = math.sqrt(L*L+r*r)
            geom_m = dens * math.pi * r * slant * t2
        elif r > 0:
            geom_m = tube_mass(dens, r, t2, L)
        else:
            geom_m = 0
        override_active = (om_attr == 'true')
        print(f'  <{tag}> "{el.findtext("name","?")}" active={override_active} om_child={om_child.text} geom={geom_m:.3f}kg dens={dens:.0f} r={r:.4f}')
