/**
 * OpenRocket .ork file parser
 *
 * .ork files are XML (optionally GZIP-compressed). All geometry is in meters.
 * Uses only browser-native APIs — no new npm dependencies.
 */

import type { OpenRocketData } from '../types';

const M_TO_IN = 1 / 0.0254;

export function isGzip(buffer: ArrayBuffer): boolean {
  const bytes = new Uint8Array(buffer);
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

export async function decompressGzip(buffer: ArrayBuffer): Promise<ArrayBuffer> {
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
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out.buffer;
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

function mapNoseShape(shape: string): OpenRocketData['noseConeType'] {
  const s = shape.toLowerCase();
  if (s === 'ogive' || s === 'tangent' || s === 'secant') return 'ogive';
  if (s === 'conical') return 'conical';
  if (s === 'parabolic' || s === 'ellipsoid') return 'parabolic';
  if (s === 'haack' || s === 'vonkarman' || s === 'lvhaack' || s === 'power') return 'haack';
  return 'ogive';
}

export async function parseOrkFile(buffer: ArrayBuffer): Promise<OpenRocketData> {
  const raw = isGzip(buffer) ? await decompressGzip(buffer) : buffer;
  const xmlString = new TextDecoder('utf-8').decode(raw);
  const doc = new DOMParser().parseFromString(xmlString, 'text/xml');

  // Rocket name
  const rocketEl = doc.getElementsByTagName('rocket')[0] ?? null;
  const rocketName = rocketEl ? (rocketEl.getAttribute('name') ?? undefined) : undefined;

  // Nose cone
  const noseEl = doc.getElementsByTagName('nosecone')[0] ?? null;
  const noseShape = noseEl ? (noseEl.getAttribute('shape') ?? getText(noseEl, 'shape')) : 'ogive';
  const noseLength_m = getNum(noseEl, 'length');
  const noseRadius_m = getNum(noseEl, 'radius'); // aft radius of nose = body radius

  // Body tube (first one — stage 1)
  const bodyEl = doc.getElementsByTagName('bodytube')[0] ?? null;
  const bodyLength_m = getNum(bodyEl, 'length');
  const bodyRadius_m = getNum(bodyEl, 'radius');

  // Use nose radius if body radius is 0 (some .ork files omit body radius)
  const radius_m = bodyRadius_m > 0 ? bodyRadius_m : noseRadius_m;

  // Fins (trapezoid or elliptical)
  const finEl =
    doc.getElementsByTagName('trapezoidfinset')[0] ??
    doc.getElementsByTagName('ellipticalfinset')[0] ??
    null;
  const finRoot_m   = getNum(finEl, 'rootchord');
  const finTip_m    = getNum(finEl, 'tipchord');
  const finSpan_m   = getNum(finEl, 'height');
  const finSweep_m  = getNum(finEl, 'sweeplength');

  // Motor
  const motorEl = doc.getElementsByTagName('motor')[0] ?? null;
  const motorDesignation  = motorEl ? (motorEl.getAttribute('designation') ?? getText(motorEl, 'designation') ?? undefined) : undefined;
  const motorManufacturer = motorEl ? (motorEl.getAttribute('manufacturer') ?? getText(motorEl, 'manufacturer') ?? undefined) : undefined;

  // Stored simulation apogee
  const altEl = doc.getElementsByTagName('maxaltitude')[0] ?? null;
  const maxAltText = altEl ? (altEl.textContent ?? '') : '';
  const maxApogee_m = maxAltText ? parseFloat(maxAltText) : undefined;

  // Max velocity
  const velEl = doc.getElementsByTagName('maxvelocity')[0] ?? null;
  const maxVelText = velEl ? (velEl.textContent ?? '') : '';
  const maxVelocity_ms = maxVelText ? parseFloat(maxVelText) : undefined;

  return {
    rocketName,
    bodyDiameter_in: radius_m * 2 * M_TO_IN,
    bodyLength_in:   bodyLength_m * M_TO_IN,
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
