#!/usr/bin/env node
/**
 * batch_investigate.mjs — Deep-dive investigation of apogee discrepancy outliers
 *
 * Reads batch_results.csv, finds files where |apogee_diff_pct| > THRESHOLD,
 * deeply analyzes each .ork file to identify root causes, and writes
 * batch_overrides.json with per-file corrections.
 *
 * Run AFTER batch_test.mjs:
 *   node batch_investigate.mjs [--threshold=5] [--max=50]
 *
 * Then re-run batch_test.mjs to apply corrections and reassess.
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join, basename, dirname } from 'path';
import { fileURLToPath } from 'url';
import { unzipSync } from 'fflate';
import { DOMParser } from '@xmldom/xmldom';

// ─── Config ───────────────────────────────────────────────────────────────────
const ORK_DIR       = dirname(fileURLToPath(import.meta.url)); // .ork files live alongside this script
const RESULTS_FILE  = './batch_results_tier3.csv';
const OVERRIDE_FILE = './batch_overrides.json';
const REPORT_FILE   = './investigate_report.txt';

// Parse CLI args
const args = Object.fromEntries(
  process.argv.slice(2)
    .filter(a => a.startsWith('--'))
    .map(a => { const [k, v] = a.slice(2).split('='); return [k, v ?? 'true']; })
);
const THRESHOLD = parseFloat(args.threshold ?? '5.0');
const MAX_FILES = parseInt(args.max ?? '999', 10);
// --no-remove: preserve existing cd_override entries — prevents silent deletion
// of manually-tuned overrides when batch_investigate rewrites a file's entry.
const NO_REMOVE = args['no-remove'] === 'true';

// ─── Unit conversions ─────────────────────────────────────────────────────────
const M_TO_FT = 3.28084;
const M_TO_IN = 1 / 0.0254;
const IN_TO_M = 0.0254;
const KG_TO_LB = 2.20462;

// ─── CSV parser ───────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split('\n');
  if (lines.length < 2) return [];
  const headers = splitCSVRow(lines[0]);
  return lines.slice(1).map(line => {
    const vals = splitCSVRow(line);
    const obj = {};
    headers.forEach((h, i) => { obj[h.trim()] = (vals[i] ?? '').trim(); });
    return obj;
  });
}

function splitCSVRow(line) {
  const cells = [];
  let cur = '', inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQuotes && line[i + 1] === '"') { cur += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (c === ',' && !inQuotes) {
      cells.push(cur); cur = '';
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells;
}

// ─── .ork decompressor ────────────────────────────────────────────────────────
function isZip(buf)  { return buf.length >= 4 && buf[0] === 0x50 && buf[1] === 0x4b; }
function isGzip(buf) { return buf.length >= 2 && buf[0] === 0x1f && buf[1] === 0x8b; }

async function decompressGzip(buf) {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(buf); writer.close();
  const chunks = [];
  const reader = ds.readable.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0; for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}

async function extractXml(buf) {
  if (isZip(buf)) {
    const files = unzipSync(buf);
    const entries = Object.entries(files);
    if (!entries.length) throw new Error('Empty ZIP');
    const [, data] = entries.find(([n]) => n.endsWith('.ork') || n === 'rocket.ork') ?? entries[0];
    return new TextDecoder().decode(data);
  }
  if (isGzip(buf)) return new TextDecoder().decode(await decompressGzip(buf));
  return new TextDecoder().decode(buf);
}

// ─── XML helpers ──────────────────────────────────────────────────────────────
function getText(el, tag) {
  if (!el) return '';
  const child = el.getElementsByTagName(tag)[0];
  return child ? (child.textContent ?? '') : '';
}
function getNum(el, tag) {
  const n = parseFloat(getText(el, tag)); return isFinite(n) ? n : 0;
}
function parseRadiusStr(txt) {
  const t = txt.trim().toLowerCase().replace(/^auto\s*/, '');
  const n = parseFloat(t); return isFinite(n) && n > 0 ? n : 0;
}
function getRadius(el) {
  if (!el) return 0;
  for (const tag of ['radius', 'outerradius', 'outsideradius', 'aftradius']) {
    const child = el.getElementsByTagName(tag)[0];
    if (child) { const r = parseRadiusStr(child.textContent ?? ''); if (r > 0) return r; }
  }
  const attr = el.getAttribute('radius');
  if (attr) { const r = parseRadiusStr(attr); if (r > 0) return r; }
  return 0;
}

// ─── ThrustCurve.org lookup ───────────────────────────────────────────────────
const motorCache = new Map();
async function lookupMotor(designation) {
  if (!designation) return null;
  const key = designation.toLowerCase().trim();
  if (motorCache.has(key)) return motorCache.get(key);
  try {
    const r = await fetch('https://www.thrustcurve.org/api/v1/search.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ designation, availability: 'all' }),
    });
    if (!r.ok) { motorCache.set(key, null); return null; }
    const d = await r.json();
    const results = d.results ?? [];
    if (!results.length) { motorCache.set(key, null); return null; }
    const motorId = results[0].motorId;
    // Get all matching motors to cross-check
    const allMotorIds = results.slice(0, 5).map(x => x.motorId);

    const dr = await fetch('https://www.thrustcurve.org/api/v1/download.json', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ motorIds: [motorId], data: 'samples' }),
    });
    if (!dr.ok) { motorCache.set(key, null); return null; }
    const dd = await dr.json();
    const downloads = dd.results ?? [];
    if (!downloads.length) { motorCache.set(key, null); return null; }

    const ranked = ['cert', 'mfr', 'user'];
    const best = ranked.map(s => downloads.find(d => d.source === s && d.samples?.length))
      .find(Boolean) ?? downloads.find(d => d.samples?.length) ?? downloads[0];
    const meta = downloads[0].motor ?? {};

    const motor = {
      name:             String(meta.commonName ?? motorId),
      manufacturer:     String(meta.manufacturer ?? 'Unknown'),
      diameterMm:       Number(meta.diameter ?? 0),
      propellantMassKg: Number(meta.propWeightG ?? 0) / 1000,
      totalMassKg:      Number(meta.totalWeightG ?? 0) / 1000,
      avgThrustN:       Number(meta.avgThrustN ?? 0),
      maxThrustN:       Number(meta.maxThrustN ?? 0),
      burnTimeSec:      Number(meta.burnTimeS ?? 0),
      totalImpulseNs:   Number(meta.totImpulseNs ?? 0),
      thrustCurve:      (best?.samples ?? []).map(s => ({ time: s.time, thrust: s.thrust })),
      motorId,
      allCandidateIds:  allMotorIds,
    };
    motorCache.set(key, motor);
    return motor;
  } catch {
    motorCache.set(key, null); return null;
  }
}

// ─── Deep .ork analysis ───────────────────────────────────────────────────────
/**
 * Deeply analyze a .ork file to understand what OR modeled and compare to
 * what batch_test.mjs computed. Returns a structured findings object.
 */
async function analyzeOrk(filePath, batchRow) {
  const filename = basename(filePath);
  const findings = {
    filename,
    issues: [],          // array of { severity: 'HIGH'|'MEDIUM'|'LOW', field, ours, ork, fix, notes }
    proposedOverride: null,
  };

  let xmlString;
  try {
    const buf = new Uint8Array(readFileSync(filePath));
    xmlString = await extractXml(buf);
  } catch (err) {
    findings.issues.push({ severity: 'HIGH', field: 'parse', ours: null, ork: null,
      fix: null, notes: `Cannot read file: ${err.message}` });
    return findings;
  }

  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');

  // ── 1. Nose cone type ───────────────────────────────────────────────────────
  const noseEl = doc.getElementsByTagName('nosecone')[0] ?? null;
  let parsedNoseShape = 'ogive';
  if (noseEl) {
    const shapeEl  = noseEl.getElementsByTagName('shape')[0];
    const shapeAttr = noseEl.getAttribute('shape');
    const shapeRaw = shapeEl ? (shapeEl.textContent ?? '') : (shapeAttr ?? '');
    parsedNoseShape = shapeRaw.trim().toLowerCase() || 'ogive';
  }
  const ourNoseShape = batchRow.nosecone_type || 'ogive';
  if (parsedNoseShape !== ourNoseShape) {
    findings.issues.push({
      severity: 'LOW', field: 'nosecone_type',
      ours: ourNoseShape, ork: parsedNoseShape,
      fix: parsedNoseShape,
      notes: `OR XML says "${parsedNoseShape}", we used "${ourNoseShape}"`,
    });
  }
  // Note whether it's conical (higher drag) vs ogive (lower drag)
  if (parsedNoseShape === 'conical') {
    findings.issues.push({
      severity: 'LOW', field: 'nosecone_pressure_drag',
      ours: 'included', ork: 'conical nose has ~2-5% higher CD',
      fix: null, notes: 'Conical nose adds pressure drag — check if Barrowman CD reflects this',
    });
  }

  // ── 2. Diameter / radius ────────────────────────────────────────────────────
  const bodyEls  = Array.from(doc.getElementsByTagName('bodytube'));
  const noseRad  = noseEl ? getRadius(noseEl) : 0;
  let maxRad = 0;
  const allRadii = [];
  for (const el of bodyEls) {
    const r = getRadius(el);
    allRadii.push(r);
    if (r > maxRad) maxRad = r;
  }
  if (maxRad === 0) maxRad = noseRad;
  const orkDiam_in = maxRad * 2 * M_TO_IN;
  const ourDiam_in = parseFloat(batchRow.diameter_in) || 0;
  if (Math.abs(orkDiam_in - ourDiam_in) > 0.1 && ourDiam_in > 0) {
    findings.issues.push({
      severity: 'MEDIUM', field: 'diameter_in',
      ours: ourDiam_in.toFixed(3), ork: orkDiam_in.toFixed(3),
      fix: orkDiam_in.toFixed(2),
      notes: `Diameter mismatch — ORK max body radius=${(maxRad*M_TO_IN).toFixed(3)}" nose_r=${(noseRad*M_TO_IN).toFixed(3)}" all_body_radii=${allRadii.map(r=>(r*M_TO_IN).toFixed(2)).join('/')}`,
    });
  }

  // ── 3. Length ────────────────────────────────────────────────────────────────
  const noseLen_m = noseEl ? getNum(noseEl, 'length') : 0;
  const bodyLen_m = bodyEls.reduce((s, el) => s + getNum(el, 'length'), 0);
  const totalLen_m = noseLen_m + bodyLen_m;
  const orkLen_in  = totalLen_m * M_TO_IN;
  const ourLen_in  = parseFloat(batchRow.length_in) || 0;
  if (Math.abs(orkLen_in - ourLen_in) > 1.0 && ourLen_in > 0) {
    findings.issues.push({
      severity: 'MEDIUM', field: 'length_in',
      ours: ourLen_in.toFixed(2), ork: orkLen_in.toFixed(2),
      fix: orkLen_in.toFixed(2),
      notes: `Length mismatch — nose=${(noseLen_m*M_TO_IN).toFixed(2)}" body=${(bodyLen_m*M_TO_IN).toFixed(2)}" total=${orkLen_in.toFixed(2)}"`,
    });
  }

  // ── 4. Mass ──────────────────────────────────────────────────────────────────
  // Check databranch t=0 mass
  const branchEls = Array.from(doc.getElementsByTagName('databranch'));
  let databranch_mass_kg = null, databranch_mass_source = null;
  for (const branch of branchEls) {
    const types = (branch.getAttribute('types') ?? '').split(',').map(s => s.trim().toLowerCase());
    const massIdx = types.findIndex(c => c === 'mass');
    if (massIdx < 0) continue;
    const dps = Array.from(branch.getElementsByTagName('datapoint'));
    if (!dps.length) continue;
    const vals = (dps[0].textContent ?? '').split(',');
    const v = parseFloat(vals[massIdx] ?? '');
    if (isFinite(v) && v >= 0.5 && v <= 2000) {
      databranch_mass_kg = v;
      databranch_mass_source = 'databranch_t0';
      break;
    }
  }

  // Component mass sum
  const allMassEls = doc.getElementsByTagName('mass');
  let compMass_kg = 0;
  const compMasses = [];
  for (let i = 0; i < allMassEls.length; i++) {
    const v = parseFloat(allMassEls[i].textContent ?? '');
    if (isFinite(v) && v > 0) { compMasses.push(v); compMass_kg += v; }
  }

  // Override mass elements (can be misleadingly high/low due to sub-component overrides)
  const overrideMassEls = doc.getElementsByTagName('overridemass');
  const overrideMasses = [];
  for (let i = 0; i < overrideMassEls.length; i++) {
    const v = parseFloat(overrideMassEls[i].textContent ?? '');
    if (isFinite(v) && v > 0) overrideMasses.push(v);
  }

  const ourMass_lb  = parseFloat(batchRow.mass_lb) || 0;
  const ourMass_kg  = ourMass_lb * 0.453592;
  const ourMassSrc  = batchRow.mass_source || 'unknown';
  const dbMass_lb   = databranch_mass_kg != null ? databranch_mass_kg * KG_TO_LB : null;

  if (databranch_mass_kg != null && Math.abs(databranch_mass_kg - ourMass_kg) / databranch_mass_kg > 0.05) {
    const massNote = overrideMasses.length > 0
      ? ` (${overrideMasses.length} override-mass elements found: ${overrideMasses.map(m=>m.toFixed(3)+'kg').join(', ')} — may indicate sub-component overrides)`
      : '';
    findings.issues.push({
      severity: 'HIGH', field: 'mass_lb',
      ours: ourMass_lb.toFixed(3), ork: (databranch_mass_kg * KG_TO_LB).toFixed(3),
      fix: (databranch_mass_kg * KG_TO_LB).toFixed(3),
      notes: `Mass mismatch >5%: our=${ourMass_kg.toFixed(3)}kg (${ourMassSrc}) OR_databranch=${databranch_mass_kg.toFixed(3)}kg comp_sum=${compMass_kg.toFixed(3)}kg${massNote}`,
    });
  }

  // No databranch — check if component sum looks reasonable
  if (databranch_mass_kg == null && compMass_kg > 0) {
    findings.issues.push({
      severity: 'MEDIUM', field: 'mass_source',
      ours: ourMassSrc, ork: 'no_databranch',
      fix: null,
      notes: `No databranch mass — using component sum ${compMass_kg.toFixed(3)}kg=${( compMass_kg*KG_TO_LB).toFixed(2)}lb. Check if overrides needed.`,
    });
  }

  // ── 5. Motor designation comparison ─────────────────────────────────────────
  // Extract motor designations from all motor configs in the file
  const allMotorEls = Array.from(doc.getElementsByTagName('motor'));
  const motorConfigs = Array.from(doc.getElementsByTagName('motorconfiguration'));
  const defConfig = motorConfigs.find(e => e.getAttribute('default') === 'true') ?? motorConfigs[0];
  const defConfigId = defConfig?.getAttribute('configid') ?? null;

  const matchMotors = defConfigId
    ? allMotorEls.filter(e => e.getAttribute('configid') === defConfigId)
    : allMotorEls;

  const allDesigs = matchMotors.map(e => getText(e, 'designation')).filter(Boolean);
  const primaryDesig = allDesigs[allDesigs.length - 1] || null; // last = sustainer
  const ourMotorDesig = batchRow.motor_designation || null;

  if (primaryDesig && ourMotorDesig && primaryDesig !== ourMotorDesig) {
    findings.issues.push({
      severity: 'MEDIUM', field: 'motor_designation',
      ours: ourMotorDesig, ork: primaryDesig,
      fix: primaryDesig,
      notes: `Motor designation differs — OR XML has "${primaryDesig}", we matched "${ourMotorDesig}"`,
    });
  }

  // All motor designations in default config (for multi-stage visibility)
  if (allDesigs.length > 1) {
    findings.issues.push({
      severity: 'MEDIUM', field: 'multi_stage_motors',
      ours: ourMotorDesig, ork: allDesigs.join(' | '),
      fix: null,
      notes: `Multiple motors in default config: [${allDesigs.join(', ')}] — simulated as single-stage with "${primaryDesig}"`,
    });
  }

  // ── 6. Motor performance comparison (if we can look it up) ─────────────────
  if (ourMotorDesig && batchRow.motor_found === 'yes') {
    const tcMotor = await lookupMotor(ourMotorDesig).catch(() => null);
    if (tcMotor) {
      // Compare total impulse to what OR would have used
      const orSimEls = Array.from(doc.getElementsByTagName('simulation'));
      const matchSim = defConfigId
        ? orSimEls.find(s => s.getElementsByTagName('configid')[0]?.textContent?.trim() === defConfigId)
        : orSimEls[0];
      const fdEl = matchSim?.getElementsByTagName('flightdata')[0] ?? null;
      // OR stores flight time; compare burn time from our TC data
      const orFlightTime = fdEl ? parseFloat(fdEl.getAttribute('maxtime') ?? '') : NaN;
      const tcBurnTime   = tcMotor.burnTimeSec;
      if (!isNaN(orFlightTime) && tcBurnTime > 0 && orFlightTime > 0) {
        const flightVsBurn = orFlightTime / tcBurnTime;
        // Very rough sanity: flight time should be 2-10x burn time
        if (flightVsBurn < 1.5) {
          findings.issues.push({
            severity: 'MEDIUM', field: 'motor_burn_vs_flight',
            ours: `TC burn=${tcBurnTime.toFixed(1)}s`, ork: `OR flight=${orFlightTime.toFixed(1)}s`,
            fix: null,
            notes: `Flight time barely exceeds burn time — motor may be very different from TC version`,
          });
        }
      }
    }
  }

  // ── 7. Stored OR apogee vs our apogee ────────────────────────────────────────
  const orApogee_ft = parseFloat(batchRow.or_apogee_ft) || 0;
  const ourApogee_ft = parseFloat(batchRow.our_apogee_ft) || 0;
  const diffPct = parseFloat(batchRow.apogee_diff_pct) || 0;

  // Check if OR simulation was actually run (sometimes it's just a placeholder)
  const allSimEls = Array.from(doc.getElementsByTagName('simulation'));
  const matchSim = defConfigId
    ? allSimEls.find(s => s.getElementsByTagName('configid')[0]?.textContent?.trim() === defConfigId)
    : allSimEls[0];
  const fdEl = matchSim?.getElementsByTagName('flightdata')[0] ?? null;
  const orHasSimData = fdEl != null && parseFloat(fdEl.getAttribute('maxaltitude') ?? '') > 0;

  if (!orHasSimData && orApogee_ft === 0) {
    findings.issues.push({
      severity: 'HIGH', field: 'or_simulation',
      ours: ourApogee_ft.toFixed(0), ork: 'no_sim_data',
      fix: null,
      notes: 'OR has no simulation results stored — cannot compare apogees',
    });
  }

  // ── 8. Fin geometry check ─────────────────────────────────────────────────
  const trapEls  = Array.from(doc.getElementsByTagName('trapezoidfinset'));
  const ellipEls = Array.from(doc.getElementsByTagName('ellipticalfinset'));
  const freeEls  = Array.from(doc.getElementsByTagName('freefinset'));
  const finEl    = trapEls[trapEls.length - 1] ?? ellipEls[ellipEls.length - 1] ?? freeEls[freeEls.length - 1] ?? null;

  if (!finEl) {
    findings.issues.push({
      severity: 'MEDIUM', field: 'fins',
      ours: null, ork: 'no_fins',
      fix: null,
      notes: 'No fin element found — CP calculation fallback to nose-only (unstable assumption)',
    });
  } else {
    const finType   = finEl.tagName;
    const finRoot   = getNum(finEl, 'rootchord') * M_TO_IN;
    const finTip    = getNum(finEl, 'tipchord')  * M_TO_IN;
    const finSpan   = getNum(finEl, 'height')    * M_TO_IN;
    const finSweep  = getNum(finEl, 'sweeplength') * M_TO_IN;
    const finCountE = finEl.getElementsByTagName('fincount')[0];
    const finCount  = finCountE ? parseInt(finCountE.textContent ?? '3', 10) : 3;
    findings.issues.push({
      severity: 'INFO', field: 'fin_geometry',
      ours: null, ork: `${finType} n=${finCount} root=${finRoot.toFixed(2)}" tip=${finTip.toFixed(2)}" span=${finSpan.toFixed(2)}" sweep=${finSweep.toFixed(2)}"`,
      fix: null,
      notes: 'Fin geometry for reference',
    });

    // Unusual fin geometry that might distort drag
    if (finRoot > orkLen_in * 0.7) {
      findings.issues.push({
        severity: 'MEDIUM', field: 'fin_root_too_large',
        ours: finRoot.toFixed(2), ork: orkLen_in.toFixed(2),
        fix: null,
        notes: `Fin root chord (${finRoot.toFixed(2)}") is >70% of rocket length — geometry may be unusual (delta wing?)`,
      });
    }
  }

  // ── 9. Transitions / boat-tails (extra drag components) ──────────────────
  const transitionEls = Array.from(doc.getElementsByTagName('transition'));
  if (transitionEls.length > 0) {
    const sizes = transitionEls.map(e =>
      `fwd=${getRadius(e)*2*M_TO_IN}"/aft=${(getNum(e,'aftradius')||getRadius(e))*2*M_TO_IN}"`
    );
    findings.issues.push({
      severity: 'LOW', field: 'transitions',
      ours: 'not modeled', ork: `${transitionEls.length} transition(s)`,
      fix: null,
      notes: `${transitionEls.length} transition/boattail element(s) found — add drag that our model ignores: ${sizes.join(', ')}`,
    });
  }

  // ── 10. Launch lugs / rail buttons (minor drag) ───────────────────────────
  const lugEls = [
    ...Array.from(doc.getElementsByTagName('launchlug')),
    ...Array.from(doc.getElementsByTagName('railbutton')),
  ];
  if (lugEls.length > 0) {
    findings.issues.push({
      severity: 'LOW', field: 'launch_lugs',
      ours: 'not modeled', ork: `${lugEls.length} lug/button(s)`,
      fix: null,
      notes: `${lugEls.length} launch lug/rail button(s) — minor extra drag (~0.01-0.03 CD) not in our model`,
    });
  }

  // ── 11. Parachute / recovery (should not affect powered ascent) ───────────
  const chuteEls = [
    ...Array.from(doc.getElementsByTagName('parachute')),
    ...Array.from(doc.getElementsByTagName('streamer')),
  ];
  // Recovery doesn't affect apogee — just note presence

  // ── Summarize and build proposed override ────────────────────────────────
  const highIssues   = findings.issues.filter(i => i.severity === 'HIGH');
  const medIssues    = findings.issues.filter(i => i.severity === 'MEDIUM');
  const fixableIssues = findings.issues.filter(i => i.fix != null);

  if (fixableIssues.length > 0) {
    const override = {};
    for (const issue of fixableIssues) {
      if (issue.field === 'nosecone_type')      override.nosecone_type      = issue.fix;
      if (issue.field === 'diameter_in')        override.diameter_in        = parseFloat(issue.fix);
      if (issue.field === 'length_in')          override.length_in          = parseFloat(issue.fix);
      if (issue.field === 'mass_lb')            override.mass_lb            = parseFloat(issue.fix);
      if (issue.field === 'motor_designation')  override.motor_designation  = issue.fix;
    }
    const reasons = fixableIssues.map(i => `${i.field}: ${i.notes}`);
    override.notes = reasons.slice(0, 3).join(' | ');
    override.apogee_diff_pct_before = batchRow.apogee_diff_pct;
    findings.proposedOverride = override;
  }

  return findings;
}

// ─── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  if (!existsSync(RESULTS_FILE)) {
    console.error(`Error: ${RESULTS_FILE} not found. Run batch_test.mjs first.`);
    process.exit(1);
  }

  const csvText = readFileSync(RESULTS_FILE, 'utf8');
  const rows = parseCSV(csvText);
  console.log(`Loaded ${rows.length} rows from ${RESULTS_FILE}`);

  // Filter to outliers with available OR apogee and our apogee
  const outliers = rows.filter(r => {
    const diff = parseFloat(r.apogee_diff_pct);
    return !isNaN(diff) && Math.abs(diff) > THRESHOLD;
  }).slice(0, MAX_FILES);

  // Also collect rows where OR apogee exists but we have no apogee (couldn't simulate)
  const noSimRows = rows.filter(r =>
    r.or_apogee_ft && !r.our_apogee_ft && r.tier_run && !r.tier_run.startsWith('tier1') && !r.tier_run.startsWith('skip')
  ).slice(0, Math.max(0, MAX_FILES - outliers.length));

  console.log(`\nOutliers (|diff| > ${THRESHOLD}%): ${outliers.length}`);
  console.log(`Failed simulations with OR apogee: ${noSimRows.length}`);

  // Summary table of outliers
  if (outliers.length > 0) {
    console.log('\n── Outlier table ─────────────────────────────────────────────────────');
    console.log(`${'filename'.padEnd(60)} ${'tier'.padEnd(8)} ${'or_ft'.padEnd(8)} ${'our_ft'.padEnd(8)} ${'diff%'.padEnd(8)}`);
    for (const r of outliers) {
      console.log(`${r.filename.padEnd(60)} ${r.tier_run.padEnd(8)} ${r.or_apogee_ft.padEnd(8)} ${r.our_apogee_ft.padEnd(8)} ${r.apogee_diff_pct}`);
    }
  }

  // Load existing overrides
  let existingOverrides = {};
  if (existsSync(OVERRIDE_FILE)) {
    try { existingOverrides = JSON.parse(readFileSync(OVERRIDE_FILE, 'utf8')); }
    catch (err) { console.warn(`Warning: existing overrides file invalid: ${err.message}`); }
  }

  // Investigate each outlier
  const allToInvestigate = [...outliers, ...noSimRows];
  const newOverrides = { ...existingOverrides };
  const reportLines = [
    `batch_investigate.mjs report`,
    `Generated: ${new Date().toISOString()}`,
    `Threshold: ${THRESHOLD}%  |  Files analyzed: ${allToInvestigate.length}`,
    ``,
  ];

  let overrideCount = 0;
  for (let i = 0; i < allToInvestigate.length; i++) {
    const batchRow = allToInvestigate[i];
    const filePath = join(ORK_DIR, batchRow.filename);
    const diffStr  = batchRow.apogee_diff_pct ? `${batchRow.apogee_diff_pct}%` : 'N/A';
    process.stdout.write(`[${i + 1}/${allToInvestigate.length}] ${batchRow.filename} (diff=${diffStr})...`);

    if (!existsSync(filePath)) {
      console.log(' FILE NOT FOUND');
      reportLines.push(`\n### ${batchRow.filename}`);
      reportLines.push(`  ERROR: File not found at ${filePath}`);
      continue;
    }

    const findings = await analyzeOrk(filePath, batchRow);
    const highN    = findings.issues.filter(i => i.severity === 'HIGH').length;
    const medN     = findings.issues.filter(i => i.severity === 'MEDIUM').length;
    const fixN     = findings.issues.filter(i => i.fix != null).length;
    console.log(` HIGH=${highN} MEDIUM=${medN} fixable=${fixN}`);

    reportLines.push(`\n### ${batchRow.filename}`);
    reportLines.push(`  apogee_diff: ${diffStr}  tier: ${batchRow.tier_run}  or_apogee: ${batchRow.or_apogee_ft}ft  our_apogee: ${batchRow.our_apogee_ft}ft`);
    for (const issue of findings.issues) {
      if (issue.severity === 'INFO') continue;
      reportLines.push(`  [${issue.severity}] ${issue.field}: ${issue.notes}`);
      if (issue.fix != null) reportLines.push(`    → FIX: set ${issue.field} = ${issue.fix}`);
    }

    if (findings.proposedOverride) {
      const proposed = findings.proposedOverride;
      // --no-remove: if an existing entry already has a cd_override, keep it —
      // batch_investigate never had visibility into manual CD tuning, so it
      // would otherwise silently drop the field when rewriting the entry.
      if (NO_REMOVE) {
        const existing = existingOverrides[batchRow.filename];
        if (existing?.cd_override != null) {
          proposed.cd_override = existing.cd_override;
          reportLines.push(`  [no-remove] preserved cd_override=${existing.cd_override} for ${batchRow.filename}`);
        }
      }
      newOverrides[batchRow.filename] = proposed;
      overrideCount++;
      reportLines.push(`  OVERRIDE WRITTEN for ${batchRow.filename}`);
    }

    // Flush overrides periodically
    if ((i + 1) % 5 === 0) {
      writeFileSync(OVERRIDE_FILE, JSON.stringify(newOverrides, null, 2));
      writeFileSync(REPORT_FILE, reportLines.join('\n'));
    }
  }

  // Final flush
  writeFileSync(OVERRIDE_FILE, JSON.stringify(newOverrides, null, 2));
  writeFileSync(REPORT_FILE, reportLines.join('\n'));

  // Final summary
  console.log('\n─── Investigation Summary ────────────────────────────────────────────');
  console.log(`Files analyzed:     ${allToInvestigate.length}`);
  console.log(`Overrides written:  ${overrideCount}`);
  console.log(`Existing overrides: ${Object.keys(existingOverrides).length}`);
  console.log(`Total overrides:    ${Object.keys(newOverrides).length}`);
  console.log(`\nFiles saved:`);
  console.log(`  ${OVERRIDE_FILE}`);
  console.log(`  ${REPORT_FILE}`);
  console.log(`\nNext step: re-run batch_test.mjs to apply corrections.`);

  // Print high-level diff distribution
  const diffs = rows
    .map(r => parseFloat(r.apogee_diff_pct))
    .filter(d => !isNaN(d));
  if (diffs.length > 0) {
    const sorted = [...diffs].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    const p5  = sorted[Math.floor(sorted.length * 0.05)];
    const p95 = sorted[Math.floor(sorted.length * 0.95)];
    const gt5  = diffs.filter(d => Math.abs(d) > 5).length;
    const gt10 = diffs.filter(d => Math.abs(d) > 10).length;
    const gt20 = diffs.filter(d => Math.abs(d) > 20).length;
    console.log('\n─── Apogee Diff Distribution ─────────────────────────────────────────');
    console.log(`  Median: ${median.toFixed(1)}%  P5: ${p5.toFixed(1)}%  P95: ${p95.toFixed(1)}%`);
    console.log(`  |diff| > 5%:  ${gt5}/${diffs.length} files`);
    console.log(`  |diff| > 10%: ${gt10}/${diffs.length} files`);
    console.log(`  |diff| > 20%: ${gt20}/${diffs.length} files`);
  }
}

main().catch(err => { console.error('Fatal:', err); process.exit(1); });
