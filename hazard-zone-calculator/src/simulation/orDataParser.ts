/**
 * Parser for OpenRocket full flight data CSV exports.
 *
 * OpenRocket can export a per-timestep CSV with 50+ columns including the
 * drag coefficient, Mach number, CP/CG locations, thrust, and mass at every
 * simulation step. This parser extracts the pre-apogee ballistic data and
 * derives a representative CD for use in the hazard zone simulation.
 *
 * Key filter: only pre-apogee rows (vertical velocity > 0) with Mach > 0.02
 * and CD < 5 are used, which excludes the static pad data and any post-
 * deployment parachute drag.
 */

export interface OrFlightDataResult {
  /** Median drag coefficient from pre-apogee phase — informational */
  representativeCd: number;
  /**
   * Subsonic baseline CD — minimum CD from low-Mach (M < 0.4) pre-apogee points,
   * falling back to min of all pre-apogee points. This is the correct input for
   * cdMachCorrection(): it represents CD at near-zero Mach, which the sim then
   * scales up through the transonic/supersonic regime. Using the median
   * (representativeCd) instead would double-apply Mach correction.
   */
  subsonicBaseCd: number;
  /** Component breakdown if OR exports them separately */
  cdFriction?: number;
  cdPressure?: number;
  cdBase?: number;
  /** Mach number at peak velocity during ascent */
  maxMach: number;
  /** Peak altitude recorded in the file (ft) */
  maxAltitude_ft: number;
  /** Number of valid pre-apogee data points used */
  numPoints: number;
  /** Reference length (body diameter) in inches, if present */
  referenceLength_in?: number;
  /** CG from nose (in) at last pre-apogee point */
  cgFromNose_in?: number;
  /** CP from nose (in) at last pre-apogee point */
  cpFromNose_in?: number;
  /** Stability margin (calibers) at last pre-apogee point */
  stabilityMargin_cal?: number;
  warnings: string[];
}

/** Find the 0-based column index whose header contains the given substring. */
function findCol(headers: string[], substring: string): number {
  return headers.findIndex(h => h.toLowerCase().includes(substring.toLowerCase()));
}

export function parseOrFlightData(csvText: string): OrFlightDataResult {
  const lines = csvText.split(/\r?\n/);

  // ── Find the header line ────────────────────────────────────────────────────
  // OR exports a comment line that starts with "# " and contains "Time (s)"
  let headerLine: string | null = null;
  const dataLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith('#')) {
      if (headerLine === null && trimmed.toLowerCase().includes('time (s)')) {
        headerLine = trimmed.replace(/^#\s*/, '');
      }
      // skip all other comment / event lines
      continue;
    }
    dataLines.push(trimmed);
  }

  if (!headerLine) {
    throw new Error(
      'No column header found. Make sure this is an OpenRocket simulation export ' +
      '(CSV with "# Time (s), Altitude (ft), ..." header).'
    );
  }

  const headers = headerLine.split(',').map(h => h.trim());

  // ── Locate required columns ─────────────────────────────────────────────────
  const iAlt   = findCol(headers, 'Altitude (ft)');          // not "above sea level"
  const iVvel  = findCol(headers, 'Vertical velocity');
  const iMach  = findCol(headers, 'Mach number');
  const iCd    = findCol(headers, 'Drag coefficient');        // total CD
  const iCdFr  = findCol(headers, 'Friction drag coefficient');
  const iCdPr  = findCol(headers, 'Pressure drag coefficient');
  const iCdBa  = findCol(headers, 'Base drag coefficient');
  const iCp    = findCol(headers, 'CP location');
  const iCg    = findCol(headers, 'CG location');
  const iStab  = findCol(headers, 'Stability margin');
  const iRefL  = findCol(headers, 'Reference length');

  if (iVvel < 0 || iMach < 0 || iCd < 0) {
    throw new Error(
      'Required columns (Vertical velocity, Mach number, Drag coefficient) not found. ' +
      'Export the full simulation data from OpenRocket (not just summary).'
    );
  }

  // Handle the "Altitude (ft)" column — OR also has "Altitude above sea level (ft)".
  // We want the first altitude column (AGL). If findCol returned "above sea level", fix it.
  const altIdx = headers.findIndex(h =>
    h.toLowerCase().includes('altitude') && !h.toLowerCase().includes('sea level')
  );
  const altColIdx = altIdx >= 0 ? altIdx : iAlt;

  // ── Parse data rows ─────────────────────────────────────────────────────────
  const validPoints: Array<{ mach: number; cd: number; cdFr?: number; cdPr?: number; cdBa?: number }> = [];
  let maxAlt = 0;
  let maxMach = 0;
  let lastCg: number | undefined;
  let lastCp: number | undefined;
  let lastStab: number | undefined;
  let refLength: number | undefined;

  for (const line of dataLines) {
    const cols = line.split(',');
    if (cols.length <= Math.max(iVvel, iMach, iCd)) continue;

    const vvel = parseFloat(cols[iVvel]);
    const mach = parseFloat(cols[iMach]);
    const cd   = parseFloat(cols[iCd]);
    const alt  = altColIdx >= 0 ? parseFloat(cols[altColIdx]) : NaN;

    if (isNaN(vvel) || isNaN(mach) || isNaN(cd)) continue;
    if (!isNaN(alt) && alt > maxAlt) maxAlt = alt;

    // Pre-apogee, aerodynamically valid, not parachute-dominated
    if (vvel > 0 && mach > 0.02 && cd < 5) {
      const point: (typeof validPoints)[0] = { mach, cd };
      if (iCdFr >= 0) { const v = parseFloat(cols[iCdFr]); if (!isNaN(v)) point.cdFr = v; }
      if (iCdPr >= 0) { const v = parseFloat(cols[iCdPr]); if (!isNaN(v)) point.cdPr = v; }
      if (iCdBa >= 0) { const v = parseFloat(cols[iCdBa]); if (!isNaN(v)) point.cdBa = v; }
      validPoints.push(point);
      if (mach > maxMach) maxMach = mach;

      if (iCg >= 0)   { const v = parseFloat(cols[iCg]);   if (!isNaN(v) && v > 0) lastCg   = v; }
      if (iCp >= 0)   { const v = parseFloat(cols[iCp]);   if (!isNaN(v) && v > 0) lastCp   = v; }
      if (iStab >= 0) { const v = parseFloat(cols[iStab]); if (!isNaN(v))           lastStab = v; }
      if (iRefL >= 0) { const v = parseFloat(cols[iRefL]); if (!isNaN(v) && v > 0)  refLength = v; }
    }
  }

  if (validPoints.length === 0) {
    throw new Error(
      'No valid pre-apogee flight data found (Mach > 0.02, ascending, CD < 5). ' +
      'Check that the export includes the full powered and coasting ascent phases.'
    );
  }

  // ── Representative CD: median of all valid pre-apogee points (informational) ─
  const cds = validPoints.map(p => p.cd).sort((a, b) => a - b);
  const representativeCd = cds[Math.floor(cds.length / 2)];

  // ── Subsonic baseline CD: min from low-Mach points (used for sim) ──────────
  // We want the near-zero-Mach CD as input to cdMachCorrection(). The median
  // includes transonic samples which would cause double-correction. Prefer
  // points where M < 0.4; fall back to min of all points if fewer than 5.
  const lowMachPts = validPoints.filter(p => p.mach < 0.4);
  const basePool = lowMachPts.length >= 5 ? lowMachPts : validPoints;
  const subsonicBaseCd = Math.min(...basePool.map(p => p.cd));

  // Component medians if available
  const componentMedian = (key: 'cdFr' | 'cdPr' | 'cdBa') => {
    const vals = validPoints.map(p => p[key]).filter((v): v is number => v != null).sort((a, b) => a - b);
    return vals.length > 0 ? vals[Math.floor(vals.length / 2)] : undefined;
  };

  const warnings: string[] = [];
  if (maxMach < 0.15) {
    warnings.push(
      `Max Mach ${maxMach.toFixed(3)} — this rocket stays well subsonic so CD is ` +
      `nearly constant throughout flight. Barrowman and OR estimates should agree closely.`
    );
  }
  if (validPoints.length < 10) {
    warnings.push('Fewer than 10 pre-apogee data points found — CD estimate may be less reliable.');
  }

  return {
    representativeCd,
    subsonicBaseCd,
    cdFriction: componentMedian('cdFr'),
    cdPressure: componentMedian('cdPr'),
    cdBase:     componentMedian('cdBa'),
    maxMach,
    maxAltitude_ft: maxAlt,
    numPoints: validPoints.length,
    referenceLength_in: refLength,
    cgFromNose_in:      lastCg,
    cpFromNose_in:      lastCp,
    stabilityMargin_cal: lastStab,
    warnings,
  };
}
