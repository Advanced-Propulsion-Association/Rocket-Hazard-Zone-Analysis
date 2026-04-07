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
    // The XML entry is typically the only file, or named *.ork / rocket.ork
    const entries = Object.entries(files);
    if (entries.length === 0) throw new Error('Empty ZIP archive in .ork file');
    // Prefer entry ending in .ork or named "rocket.ork"; fall back to first entry
    const [, data] =
      entries.find(([name]) => name.endsWith('.ork') || name === 'rocket.ork') ??
      entries[0];
    return new TextDecoder('utf-8').decode(data);
  }
  if (isGzip(buffer)) {
    const raw = await decompressGzip(buffer);
    return new TextDecoder('utf-8').decode(raw);
  }
  // Plain XML
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
 * Get outer radius from a component element.
 * OpenRocket uses different tag names across versions:
 *   BodyTube: <radius>, <outerradius>, <outsideradius>
 *   NoseCone: <aftradius> (aft = base of nose = body radius), also <radius>
 * Also checks the 'radius' attribute (some formats use attributes).
 * Ignores "auto" values.
 */
function getRadius(el: Element | null): number {
  if (!el) return 0;
  for (const tag of ['radius', 'outerradius', 'outsideradius', 'aftradius']) {
    const child = el.getElementsByTagName(tag)[0];
    if (child) {
      const txt = (child.textContent ?? '').trim().toLowerCase();
      if (txt && txt !== 'auto') {
        const n = parseFloat(txt);
        if (isFinite(n) && n > 0) return n;
      }
    }
  }
  // Fallback: check 'radius' attribute directly on the element
  const attr = el.getAttribute('radius');
  if (attr && attr.toLowerCase() !== 'auto') {
    const n = parseFloat(attr);
    if (isFinite(n) && n > 0) return n;
  }
  return 0;
}

/** Return all elements with any of the given tag names (document-wide). */
function getAllByTags(doc: Document, ...tags: string[]): Element[] {
  return tags.flatMap(t => Array.from(doc.getElementsByTagName(t)));
}

function mapNoseShape(shape: string): OpenRocketData['noseConeType'] {
  const s = shape.toLowerCase();
  if (s === 'ogive' || s === 'tangent' || s === 'secant') return 'ogive';
  if (s === 'conical') return 'conical';
  if (s === 'parabolic' || s === 'ellipsoid') return 'parabolic';
  if (s === 'haack' || s === 'vonkarman' || s === 'lvhaack' || s === 'power') return 'haack';
  return 'ogive';
}

export async function parseOrkFile(buffer: ArrayBuffer): Promise<OpenRocketData> {
  const xmlString = await extractXml(buffer);
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');

  // Rocket name
  const rocketEl = doc.getElementsByTagName('rocket')[0] ?? null;
  const rocketName = rocketEl ? (rocketEl.getAttribute('name') ?? undefined) : undefined;

  // ── Nose cone ────────────────────────────────────────────────────────────────
  const noseEl = doc.getElementsByTagName('nosecone')[0] ?? null;
  const noseShape = noseEl ? (noseEl.getAttribute('shape') ?? getText(noseEl, 'shape')) : 'ogive';
  const noseLength_m = getNum(noseEl, 'length');
  // Nosecone uses <aftradius> in most OR versions; fallback to <radius>
  const noseRadius_m = getRadius(noseEl);

  // ── Body tubes — multi-stage aware ───────────────────────────────────────────
  // Collect all body tubes. For multi-stage rockets, the tube with the largest
  // outer radius is the primary airframe (all stages typically share the same
  // diameter, but this also handles tapered/stepped designs correctly).
  const allBodyEls = Array.from(doc.getElementsByTagName('bodytube'));

  // Find the tube with the largest outer radius to use as reference diameter.
  let maxRadius = 0;
  for (const el of allBodyEls) {
    const r = getRadius(el);
    if (r > maxRadius) { maxRadius = r; }
  }

  const radius_m = maxRadius > 0 ? maxRadius : noseRadius_m;

  // Total rocket length = nose + sum of all body tube lengths.
  // This handles multi-stage rockets where each stage has its own body tube.
  const totalBodyLength_m = allBodyEls.reduce((acc, el) => acc + getNum(el, 'length'), 0);
  const totalLength_m = noseLength_m + totalBodyLength_m;

  // ── Fins ─────────────────────────────────────────────────────────────────────
  // Prefer fins from the LAST stage (booster fins stabilise the whole stack).
  // Fallback: use first finset found.
  const allTrapEls = Array.from(doc.getElementsByTagName('trapezoidfinset'));
  const allEllipEls = Array.from(doc.getElementsByTagName('ellipticalfinset'));
  // Last trapezoid finset is typically on the booster; if none, use elliptical.
  const finEl =
    (allTrapEls.length > 0 ? allTrapEls[allTrapEls.length - 1] : null) ??
    (allEllipEls.length > 0 ? allEllipEls[allEllipEls.length - 1] : null);

  const finRoot_m  = getNum(finEl, 'rootchord');
  const finTip_m   = getNum(finEl, 'tipchord');
  const finSpan_m  = getNum(finEl, 'height');
  const finSweep_m = getNum(finEl, 'sweeplength');

  // ── Motor (prefer booster — last motor element in doc) ─────────────────────
  const allMotorEls = getAllByTags(doc, 'motor');
  const motorEl = allMotorEls.length > 0 ? allMotorEls[allMotorEls.length - 1] : null;
  const motorDesignation  = motorEl
    ? (motorEl.getAttribute('designation') || getText(motorEl, 'designation') || undefined)
    : undefined;
  const motorManufacturer = motorEl
    ? (motorEl.getAttribute('manufacturer') || getText(motorEl, 'manufacturer') || undefined)
    : undefined;

  // ── Stored simulation results ─────────────────────────────────────────────
  const altEl = doc.getElementsByTagName('maxaltitude')[0] ?? null;
  const maxApogee_m = altEl ? parseFloat(altEl.textContent ?? '') : undefined;

  const velEl = doc.getElementsByTagName('maxvelocity')[0] ?? null;
  const maxVelocity_ms = velEl ? parseFloat(velEl.textContent ?? '') : undefined;

  return {
    rocketName,
    bodyDiameter_in: radius_m * 2 * M_TO_IN,
    bodyLength_in:   totalLength_m * M_TO_IN,
    noseConeType:    mapNoseShape(noseShape),
    noseLength_in:   noseLength_m * M_TO_IN,
    finRootChord_in: finRoot_m * M_TO_IN,
    finTipChord_in:  finTip_m * M_TO_IN,
    finSpan_in:      finSpan_m * M_TO_IN,
    finSweep_in:     finSweep_m > 0 ? finSweep_m * M_TO_IN : undefined,
    numFins:         extractNumFins(doc),
    cgFromNose_in:   (() => {
      const cg_m = extractCGFromNose(doc);
      return cg_m != null ? cg_m * M_TO_IN : undefined;
    })(),
    motorDesignation:  motorDesignation || undefined,
    motorManufacturer: motorManufacturer || undefined,
    maxApogee_m:     maxApogee_m != null && isFinite(maxApogee_m) ? maxApogee_m : undefined,
    maxVelocity_ms:  maxVelocity_ms != null && isFinite(maxVelocity_ms) ? maxVelocity_ms : undefined,
  };
}

/**
 * Extract number of fins from parsed .ork document.
 * Falls back to 3 if not found (most common hobby rocket config).
 */
export function extractNumFins(doc: Document): number {
  const finEl =
    doc.getElementsByTagName('trapezoidfinset')[0] ??
    doc.getElementsByTagName('ellipticalfinset')[0] ??
    null;
  if (!finEl) return 3;
  const countEl = finEl.getElementsByTagName('fincount')[0];
  if (!countEl) return 3;
  const n = parseInt(countEl.textContent ?? '3', 10);
  return isFinite(n) && n > 0 ? n : 3;
}

/**
 * Estimate CG location from nose tip (meters) by reading OR-stored simulation data.
 * Returns undefined if not available.
 */
export function extractCGFromNose(doc: Document): number | undefined {
  const cgEl = doc.getElementsByTagName('cg')[0] ?? null;
  if (cgEl) {
    const val = parseFloat(cgEl.textContent ?? '');
    if (isFinite(val) && val > 0) return val;
  }
  return undefined;
}
