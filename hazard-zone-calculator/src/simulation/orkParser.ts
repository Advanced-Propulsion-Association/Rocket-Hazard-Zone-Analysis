/**
 * OpenRocket .ork file parser
 *
 * .ork files are ZIP archives containing an XML document.
 * Older .ork files may be plain XML or gzip-compressed XML.
 */

import { unzipSync } from 'fflate';
import type { OpenRocketData } from '../types';

const M_TO_IN = 1 / 0.0254;

function isZip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 4 && bytes[0] === 0x50 && bytes[1] === 0x4b;
}

function isGzip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
  const ds = new DecompressionStream('gzip');
  const writer = ds.writable.getWriter();
  writer.write(new Uint8Array(buffer));
  writer.close();
  const reader = ds.readable.getReader();
  const chunks: Uint8Array[] = [];
  let totalLen = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    totalLen += value.length;
  }
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.length; }
  return out.buffer;
}

/** Extract XML string from .ork buffer (ZIP, gzip, or plain XML). */
async function extractXml(buffer: ArrayBuffer): Promise<string> {
  if (isZip(buffer)) {
    const files = unzipSync(new Uint8Array(buffer));
    const entries = Object.entries(files);
    if (entries.length === 0) throw new Error('Empty ZIP archive in .ork file');
    const [, data] =
      entries.find(([name]) => name.endsWith('.ork') || name === 'rocket.ork') ??
      entries[0];
    return new TextDecoder('utf-8').decode(data);
  }
  if (isGzip(buffer)) {
    const raw = await decompressGzip(buffer);
    return new TextDecoder('utf-8').decode(raw);
  }
  return new TextDecoder('utf-8').decode(buffer);
}

function getText(el: Element | null, tag: string): string {
  if (!el) return '';
  const child = el.getElementsByTagName(tag)[0];
  return child ? (child.textContent ?? '') : '';
}

function getNum(el: Element | null, tag: string): number {
  const s = getText(el, tag);
  const n = parseFloat(s);
  return isFinite(n) ? n : 0;
}

/**
 * Parse a radius string that may be:
 *   "0.028321"       → direct value
 *   "auto 0.028321"  → auto-set with an explicit value embedded
 *   "auto"           → pure auto (no explicit value) → 0
 */
function parseRadiusStr(txt: string): number {
  const t = txt.trim().toLowerCase();
  if (!t) return 0;
  const numStr = t.startsWith('auto') ? t.replace(/^auto\s*/, '') : t;
  if (!numStr) return 0;
  const n = parseFloat(numStr);
  return isFinite(n) && n > 0 ? n : 0;
}

/**
 * Get outer radius from a component element.
 * Handles "auto 0.025" format and multiple tag names across OR versions.
 */
function getRadius(el: Element | null): number {
  if (!el) return 0;
  for (const tag of ['radius', 'outerradius', 'outsideradius', 'aftradius']) {
    const child = el.getElementsByTagName(tag)[0];
    if (child) {
      const r = parseRadiusStr(child.textContent ?? '');
      if (r > 0) return r;
    }
  }
  const attr = el.getAttribute('radius');
  if (attr) {
    const r = parseRadiusStr(attr);
    if (r > 0) return r;
  }
  return 0;
}

/**
 * Parse finpoints from a <freeformfinset> element and return an equivalent
 * trapezoid approximation for Barrowman calculations.
 */
function parseFreeformFinset(el: Element): {
  rootChord_m: number; tipChord_m: number; span_m: number; sweep_m: number; numFins: number;
} | null {
  const pointEls = Array.from(el.getElementsByTagName('point'));
  const points: Array<[number, number]> = [];
  for (const pt of pointEls) {
    const x = parseFloat(pt.getAttribute('x') ?? '');
    const y = parseFloat(pt.getAttribute('y') ?? '');
    if (isFinite(x) && isFinite(y)) points.push([x, y]);
  }
  if (points.length < 2) return null;

  const maxY = Math.max(...points.map(([, y]) => y));
  if (maxY <= 0) return null;

  const rootPts = points.filter(([, y]) => y <= maxY * 0.05).map(([x]) => x);
  const rootChord_m = rootPts.length >= 2
    ? Math.max(...rootPts) - Math.min(...rootPts)
    : 0;

  const tipPts = points.filter(([, y]) => y >= maxY * 0.8).map(([x]) => x);
  const tipChord_m = tipPts.length >= 2
    ? Math.max(...tipPts) - Math.min(...tipPts)
    : 0;

  const rootLeadX = rootPts.length > 0 ? Math.min(...rootPts) : 0;
  const tipLeadX  = tipPts.length  > 0 ? Math.min(...tipPts)  : 0;
  const sweep_m = Math.max(0, tipLeadX - rootLeadX);

  const numFinsEl = el.getElementsByTagName('fincount')[0];
  const numFins = numFinsEl ? (parseInt(numFinsEl.textContent ?? '3', 10) || 3) : 3;

  return { rootChord_m, tipChord_m, span_m: maxY, sweep_m, numFins };
}

function mapNoseShape(shape: string): OpenRocketData['noseConeType'] {
  const s = shape.toLowerCase();
  if (s === 'ogive' || s === 'tangent' || s === 'secant') return 'ogive';
  if (s === 'conical') return 'conical';
  if (s === 'parabolic' || s === 'ellipsoid') return 'parabolic';
  if (s === 'haack' || s === 'vonkarman' || s === 'lvhaack' || s === 'power') return 'haack';
  return 'ogive';
}

export async function parseOrkFile(buffer: ArrayBuffer, clipAtApogee = true): Promise<OpenRocketData> {
  const xmlString = await extractXml(buffer);
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');

  // Rocket name
  const rocketEl = doc.getElementsByTagName('rocket')[0] ?? null;
  const rocketName = rocketEl
    ? (getText(rocketEl, 'name') || rocketEl.getAttribute('name') || undefined)
    : undefined;

  // ── Stage count ──────────────────────────────────────────────────────────────
  // Each physical stage is wrapped in a <stage> element; count equals numStages.
  const stageEls = Array.from(doc.getElementsByTagName('stage'));
  const numStagesDetected = stageEls.length > 0 ? stageEls.length : 1;

  // ── Per-stage CD overrides ────────────────────────────────────────────────────
  // OpenRocket stores explicit CD overrides as <overridecd>true</overridecd> +
  // <cd>value</cd> on a stage or body component within that stage.
  // OR lists stages sustainer-first in the XML (top of rocket first), so we
  // reverse to match our stageStates convention: index 0 = booster (fires first).
  function getStageCdOverride(stageEl: Element): number | undefined {
    const overrideEls = Array.from(stageEl.getElementsByTagName('overridecd'));
    for (const overrideEl of overrideEls) {
      const txt = overrideEl.textContent?.trim() ?? '';
      // Modern OR format: <overridecd>0.45</overridecd> (numeric directly)
      const direct = parseFloat(txt);
      if (isFinite(direct) && direct > 0) return direct;
      // Legacy OR format: <overridecd>true</overridecd> + sibling <cd>value</cd>
      if (txt.toLowerCase() === 'true') {
        const siblings = Array.from(overrideEl.parentElement?.children ?? []);
        const cdEl = siblings.find(s => s.tagName.toLowerCase() === 'cd');
        if (cdEl) {
          const v = parseFloat(cdEl.textContent ?? '');
          if (isFinite(v) && v > 0) return v;
        }
      }
    }
    return undefined;
  }
  // Reverse: OR XML order is [sustainer, ..., booster]; our index 0 = booster
  const stageDataRaw = [...stageEls].reverse().map(el => ({ cdOverride: getStageCdOverride(el) }));
  const stageData = stageDataRaw.some(s => s.cdOverride != null) ? stageDataRaw : undefined;

  // ── Nose cone ────────────────────────────────────────────────────────────────
  const noseEl = doc.getElementsByTagName('nosecone')[0] ?? null;
  const noseShape = noseEl ? (noseEl.getAttribute('shape') ?? getText(noseEl, 'shape')) : 'ogive';
  const noseLength_m = getNum(noseEl, 'length');
  const noseRadius_m = getRadius(noseEl);

  // ── Body tubes — multi-stage aware ───────────────────────────────────────────
  const allBodyEls = Array.from(doc.getElementsByTagName('bodytube'));

  let maxRadius = 0;
  for (const el of allBodyEls) {
    const r = getRadius(el);
    if (r > maxRadius) { maxRadius = r; }
  }

  const radius_m = maxRadius > 0 ? maxRadius : noseRadius_m;
  const totalBodyLength_m = allBodyEls.reduce((acc, el) => acc + getNum(el, 'length'), 0);
  const totalLength_m = noseLength_m + totalBodyLength_m;

  // ── Fins ─────────────────────────────────────────────────────────────────────
  const allTrapEls  = Array.from(doc.getElementsByTagName('trapezoidfinset'));
  const allEllipEls = Array.from(doc.getElementsByTagName('ellipticalfinset'));
  const allFreeEls  = Array.from(doc.getElementsByTagName('freeformfinset'));

  let finRoot_m = 0, finTip_m = 0, finSpan_m = 0, finSweep_m = 0;
  const trapEl  = allTrapEls.length  > 0 ? allTrapEls[allTrapEls.length - 1]   : null;
  const ellipEl = allEllipEls.length > 0 ? allEllipEls[allEllipEls.length - 1] : null;
  const freeEl  = allFreeEls.length  > 0 ? allFreeEls[allFreeEls.length - 1]   : null;

  const getFinCount = (els: Element[]): number => {
    if (els.length === 0) return 3;
    const counts = els.map(el => {
      const n = parseInt(el.getElementsByTagName('fincount')[0]?.textContent ?? '1', 10);
      return isFinite(n) && n > 0 ? n : 1;
    });
    const allSingles = counts.every(c => c === 1);
    if (allSingles) return counts.reduce((a, b) => a + b, 0);
    return counts[counts.length - 1];
  };

  let numFinsFromEls = 3;
  if (trapEl) {
    finRoot_m  = getNum(trapEl, 'rootchord');
    finTip_m   = getNum(trapEl, 'tipchord');
    finSpan_m  = getNum(trapEl, 'height');
    finSweep_m = getNum(trapEl, 'sweeplength');
    numFinsFromEls = getFinCount(allTrapEls);
  } else if (ellipEl) {
    finRoot_m  = getNum(ellipEl, 'rootchord');
    finTip_m   = getNum(ellipEl, 'tipchord');
    finSpan_m  = getNum(ellipEl, 'height');
    finSweep_m = getNum(ellipEl, 'sweeplength');
    numFinsFromEls = getFinCount(allEllipEls);
  } else if (freeEl) {
    const ff = parseFreeformFinset(freeEl);
    if (ff) {
      finRoot_m  = ff.rootChord_m;
      finTip_m   = ff.tipChord_m;
      finSpan_m  = ff.span_m;
      finSweep_m = ff.sweep_m;
    }
    numFinsFromEls = getFinCount(allFreeEls);
  }

  // ── Motor — match to default motor configuration ──────────────────────────
  const allMotorConfigEls = Array.from(doc.getElementsByTagName('motorconfiguration'));
  const defaultConfigEl =
    allMotorConfigEls.find(el => el.getAttribute('default') === 'true') ??
    allMotorConfigEls[0] ?? null;
  const defaultConfigId = defaultConfigEl?.getAttribute('configid') ?? null;

  const allMotorEls = Array.from(doc.getElementsByTagName('motor'));
  const matchingMotors = defaultConfigId
    ? allMotorEls.filter(el => el.getAttribute('configid') === defaultConfigId)
    : allMotorEls;
  const motorEl = matchingMotors.length > 0 ? matchingMotors[matchingMotors.length - 1] : null;

  const motorDesignation  = motorEl ? (getText(motorEl, 'designation') || undefined) : undefined;
  const motorManufacturer = motorEl ? (getText(motorEl, 'manufacturer') || undefined) : undefined;

  // ── Stored simulation results ─────────────────────────────────────────────
  // flightdata values are stored as XML attributes, not child elements
  let maxApogee_m: number | undefined;
  let maxVelocity_ms: number | undefined;
  let maxAcceleration_ms2: number | undefined;
  let maxMach: number | undefined;
  let timeToApogee_s: number | undefined;
  let flightTime_s: number | undefined;
  let groundHitVelocity_ms: number | undefined;
  let launchRodVelocity_ms: number | undefined;
  {
    const allSimEls = Array.from(doc.getElementsByTagName('simulation'));
    const matchingSim = defaultConfigId
      ? allSimEls.find(sim => {
          const cidEl = sim.getElementsByTagName('configid')[0];
          return cidEl?.textContent?.trim() === defaultConfigId;
        })
      : allSimEls[0];
    const fdEl = matchingSim?.getElementsByTagName('flightdata')[0] ?? null;
    if (fdEl) {
      const num = (attr: string) => {
        const v = parseFloat(fdEl.getAttribute(attr) ?? '');
        return isFinite(v) && v > 0 ? v : undefined;
      };
      maxApogee_m          = num('maxaltitude');
      maxVelocity_ms       = num('maxvelocity');
      maxAcceleration_ms2  = num('maxacceleration');
      maxMach              = num('maxmach');
      timeToApogee_s       = num('timetoapogee');
      flightTime_s         = num('flighttime');
      groundHitVelocity_ms = num('groundhitvelocity');
      launchRodVelocity_ms = num('launchrodvelocity');
    }
  }

  // ── CG, CP, and min CD from databranch ───────────────────────────────────
  // OR stores "Position of CG" and "Position of CP" as databranch columns.
  // We read the first valid datapoint (launch conditions, full propellant load).
  let cgFromNose_m: number | undefined;
  let cpFromNose_m: number | undefined;
  let orkMinCd: number | undefined;
  {
    type DataRow = { alt_m: number; cd: number };
    const branchEls = Array.from(doc.getElementsByTagName('databranch'));
    for (const branch of branchEls) {
      const typeAttr = branch.getAttribute('types') ?? '';
      const cols = typeAttr.split(',').map(s => s.trim().toLowerCase());
      const altIdx = cols.indexOf('altitude');
      const cdIdx  = cols.indexOf('drag coefficient');
      const cgIdx  = cols.findIndex(c => c.includes('position of cg') || c === 'cg location');
      const cpIdx  = cols.findIndex(c => c.includes('position of cp') || c === 'cp location');

      const datapoints = Array.from(branch.getElementsByTagName('datapoint'));
      if (datapoints.length === 0) continue;

      // CG/CP from first datapoint (t=0, fully loaded)
      if (cgFromNose_m == null && cgIdx >= 0) {
        const vals = (datapoints[0].textContent ?? '').split(',');
        const v = parseFloat(vals[cgIdx] ?? '');
        if (isFinite(v) && v > 0) cgFromNose_m = v;
      }
      if (cpFromNose_m == null && cpIdx >= 0) {
        const vals = (datapoints[0].textContent ?? '').split(',');
        const v = parseFloat(vals[cpIdx] ?? '');
        if (isFinite(v) && v > 0) cpFromNose_m = v;
      }

      if (cdIdx < 0) continue;
      const rows: DataRow[] = datapoints.map(dp => {
        const vals = (dp.textContent ?? '').split(',');
        const num = (i: number) => i >= 0 ? parseFloat(vals[i] ?? '') : NaN;
        return { alt_m: num(altIdx), cd: num(cdIdx) };
      });
      let workRows = rows;
      if (clipAtApogee && altIdx >= 0 && rows.length >= 2) {
        let maxAltIdx = 0;
        for (let i = 1; i < rows.length; i++) {
          if (isFinite(rows[i].alt_m) && rows[i].alt_m > rows[maxAltIdx].alt_m) maxAltIdx = i;
        }
        workRows = rows.slice(0, maxAltIdx + 1);
      }
      const cdVals = workRows.map(r => r.cd).filter(v => isFinite(v) && v > 0);
      if (cdVals.length > 0) orkMinCd = Math.min(...cdVals);
    }

    // Fallback: scan for a top-level <cg> element (present when mass override is set)
    if (cgFromNose_m == null) {
      cgFromNose_m = extractCGFromNose(doc);
    }
  }

  return {
    rocketName,
    numStagesDetected,
    stageData,
    bodyDiameter_in: radius_m * 2 * M_TO_IN,
    bodyLength_in:   totalLength_m * M_TO_IN,
    noseConeType:    mapNoseShape(noseShape),
    noseLength_in:   noseLength_m * M_TO_IN,
    finRootChord_in: finRoot_m * M_TO_IN,
    finTipChord_in:  finTip_m * M_TO_IN,
    finSpan_in:      finSpan_m * M_TO_IN,
    finSweep_in:     finSweep_m > 0 ? finSweep_m * M_TO_IN : undefined,
    numFins:         numFinsFromEls > 0 ? numFinsFromEls : extractNumFins(doc),
    cgFromNose_in:   cgFromNose_m != null ? cgFromNose_m * M_TO_IN : undefined,
    cpFromNose_in:   cpFromNose_m != null ? cpFromNose_m * M_TO_IN : undefined,
    motorDesignation:  motorDesignation || undefined,
    motorManufacturer: motorManufacturer || undefined,
    maxApogee_m,
    maxVelocity_ms,
    maxAcceleration_ms2,
    maxMach,
    timeToApogee_s,
    flightTime_s,
    groundHitVelocity_ms,
    launchRodVelocity_ms,
    orkMinCd,
  };
}

export function extractNumFins(doc: Document): number {
  const finEl =
    doc.getElementsByTagName('trapezoidfinset')[0] ??
    doc.getElementsByTagName('ellipticalfinset')[0] ??
    doc.getElementsByTagName('freeformfinset')[0] ??
    null;
  if (!finEl) return 3;
  const countEl = finEl.getElementsByTagName('fincount')[0];
  if (!countEl) return 3;
  const n = parseInt(countEl.textContent ?? '3', 10);
  return isFinite(n) && n > 0 ? n : 3;
}

export function extractCGFromNose(doc: Document): number | undefined {
  const cgEl = doc.getElementsByTagName('cg')[0] ?? null;
  if (cgEl) {
    const val = parseFloat(cgEl.textContent ?? '');
    if (isFinite(val) && val > 0) return val;
  }
  return undefined;
}
