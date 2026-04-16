# PDF Output Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the minimal `window.print()` with a formal two-page FAA-submission-quality PDF report rendered by a dedicated `PrintView` component.

**Architecture:** A `PrintView` component (always in DOM, hidden on screen via `display:none`) renders the full light-themed report. `@media print` hides the main app and reveals only `PrintView`. A `mapSnapshot.ts` utility stitches OSM tiles onto a canvas and draws the hazard circle. The print button in `Results.tsx` calls `buildMapSnapshot`, stores the data URL in App state, then triggers `window.print()` after React re-renders `PrintView` with the new image.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, Plotly.js (`react-plotly.js`), Canvas API, OpenStreetMap tile API

**TypeScript check command:** `npx tsc --noEmit -p tsconfig.app.json` (NOT bare `npx tsc --noEmit`)

---

## File Map

| Action | File | Purpose |
|--------|------|---------|
| Modify | `src/types/index.ts` | Add `PrintInputSummary` interface |
| Modify | `src/index.css` | Add `@media print` + `@page` rules |
| Create | `src/utils/mapSnapshot.ts` | OSM tile stitch + hazard circle canvas |
| Create | `src/components/PrintView.tsx` | Full two-page print layout |
| Modify | `src/App.tsx` | Add `inputSummary` + `mapSnapshot` state, `handlePrint`, render `PrintView` |
| Modify | `src/components/Tier1Form.tsx` | Add `onInputChange` prop, fire on compute |
| Modify | `src/components/Tier2Form.tsx` | Add `onInputChange` prop, fire on compute |
| Modify | `src/components/Results.tsx` | Replace `window.print()` with `onPrint` prop; fix `print:hidden` on debug log |

---

## Task 1: Type + CSS Foundation

**Files:**
- Modify: `src/types/index.ts`
- Modify: `src/index.css`

- [ ] **Step 1: Add `PrintInputSummary` to `src/types/index.ts`**

Add after the closing brace of `HazardZoneResult` (after line 100):

```typescript
// ─── Print ───────────────────────────────────────────────────────────────────

export interface PrintInputSummary {
  tier: InputTier;
  siteElevation_ft: number;
  maxWindSpeed_mph: number;
  // Tier 1
  apogee_ft?: number;
  // Tier 2/3
  diameter_in?: number;
  length_in?: number;
  totalMass_lb?: number;
  motorDesignation?: string;
  cdSource?: string;          // e.g. "fineness ratio", ".ork file", "OR CSV"
  buildQualityMultiplier?: number; // e.g. 1.10
  // Tier 3 only
  noseConeType?: string;
  numFins?: number;
  nozzleExitDiameter_in?: number;
}
```

- [ ] **Step 2: Add `@media print` + `@page` to `src/index.css`**

Append to the end of `src/index.css`:

```css
@media print {
  /* Hide entire app; PrintView (#print-root) overrides this */
  body > #root > * {
    display: none !important;
  }
  #print-root {
    display: block !important;
  }
  @page {
    size: letter portrait;
    margin: 0.75in;
  }
}
```

- [ ] **Step 3: TypeScript check**

```bash
cd "C:/Users/bsoltes/FAA Hazard analysis/hazard-zone-calculator"
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors.

- [ ] **Step 4: Commit**

```bash
git add src/types/index.ts src/index.css
git commit -m "feat(print): add PrintInputSummary type and @media print CSS foundation"
```

---

## Task 2: `mapSnapshot.ts` — OSM Tile Map Utility

**Files:**
- Create: `src/utils/mapSnapshot.ts`

- [ ] **Step 1: Create `src/utils/mapSnapshot.ts`**

```typescript
/**
 * buildMapSnapshot — fetch OSM tiles, stitch to canvas, draw hazard circle.
 * Returns a PNG data URL, or null on any fetch/canvas failure.
 *
 * Output canvas: 580 × 220 px (full report width, enough height for context).
 */

function latLonToTile(lat: number, lon: number, z: number): { x: number; y: number; fx: number; fy: number } {
  const n = Math.pow(2, z);
  const latRad = (lat * Math.PI) / 180;
  const x = (lon + 180) / 360 * n;
  const y = (1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2 * n;
  return { x: Math.floor(x), y: Math.floor(y), fx: x - Math.floor(x), fy: y - Math.floor(y) };
}

function calcZoom(lat: number, hazardRadius_m: number): number {
  // Target: hazard circle radius ≈ 200px on a 580px-wide canvas
  const latRad = (lat * Math.PI) / 180;
  const z = Math.log2((156543.03392 * Math.cos(latRad) * 200) / hazardRadius_m);
  return Math.max(8, Math.min(17, Math.round(z)));
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = url;
  });
}

const OUT_W = 580;
const OUT_H = 220;
const TILE = 256;

export async function buildMapSnapshot(
  lat: number,
  lon: number,
  hazardRadius_m: number,
): Promise<string | null> {
  try {
    const z = calcZoom(lat, hazardRadius_m);
    const { x: tx, y: ty, fx, fy } = latLonToTile(lat, lon, z);

    // Fetch 3×3 tile grid centred on (tx, ty)
    const tileImgs: (HTMLImageElement | null)[][] = [];
    for (let row = -1; row <= 1; row++) {
      const rowImgs: (HTMLImageElement | null)[] = [];
      for (let col = -1; col <= 1; col++) {
        const tileX = tx + col;
        const tileY = ty + row;
        const maxTile = Math.pow(2, z);
        // Clamp tile coords to valid range
        if (tileX < 0 || tileX >= maxTile || tileY < 0 || tileY >= maxTile) {
          rowImgs.push(null);
          continue;
        }
        try {
          const url = `https://tile.openstreetmap.org/${z}/${tileX}/${tileY}.png`;
          rowImgs.push(await loadImage(url));
        } catch {
          rowImgs.push(null);
        }
      }
      tileImgs.push(rowImgs);
    }

    // Stitch onto 768×768 canvas
    const stitchCanvas = document.createElement('canvas');
    stitchCanvas.width = TILE * 3;
    stitchCanvas.height = TILE * 3;
    const ctx = stitchCanvas.getContext('2d')!;

    // Light gray background for missing tiles
    ctx.fillStyle = '#e8e8e8';
    ctx.fillRect(0, 0, TILE * 3, TILE * 3);

    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        const img = tileImgs[row][col];
        if (img) ctx.drawImage(img, col * TILE, row * TILE);
      }
    }

    // Launch site pixel on the 768×768 stitch
    // Centre tile (tx,ty) is at offset (256, 256); fractional within tile
    const launchPx = TILE + fx * TILE; // x in stitch
    const launchPy = TILE + fy * TILE; // y in stitch

    // Hazard circle radius in pixels
    const metersPerPx = (156543.03392 * Math.cos((lat * Math.PI) / 180)) / Math.pow(2, z);
    const circleR = hazardRadius_m / metersPerPx;

    // Draw hazard circle (red dashed)
    ctx.save();
    ctx.strokeStyle = '#dc2626';
    ctx.lineWidth = 2.5;
    ctx.setLineDash([8, 5]);
    ctx.beginPath();
    ctx.arc(launchPx, launchPy, circleR, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // Draw launch site marker (blue dot + ring)
    ctx.save();
    ctx.fillStyle = '#1d4ed8';
    ctx.beginPath();
    ctx.arc(launchPx, launchPy, 5, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = '#1d4ed8';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(launchPx, launchPy, 9, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();

    // OSM attribution
    ctx.save();
    ctx.font = '11px sans-serif';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(0, TILE * 3 - 18, 200, 18);
    ctx.fillStyle = '#fff';
    ctx.fillText('© OpenStreetMap contributors', 4, TILE * 3 - 4);
    ctx.restore();

    // Crop to OUT_W × OUT_H centred on launch site
    const cropX = Math.max(0, Math.min(TILE * 3 - OUT_W, Math.round(launchPx - OUT_W / 2)));
    const cropY = Math.max(0, Math.min(TILE * 3 - OUT_H, Math.round(launchPy - OUT_H / 2)));

    const outCanvas = document.createElement('canvas');
    outCanvas.width = OUT_W;
    outCanvas.height = OUT_H;
    const outCtx = outCanvas.getContext('2d')!;
    outCtx.drawImage(stitchCanvas, cropX, cropY, OUT_W, OUT_H, 0, 0, OUT_W, OUT_H);

    return outCanvas.toDataURL('image/png');
  } catch {
    return null;
  }
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/utils/mapSnapshot.ts
git commit -m "feat(print): add OSM tile map snapshot utility"
```

---

## Task 3: `PrintView.tsx` — Page 1

**Files:**
- Create: `src/components/PrintView.tsx`

- [ ] **Step 1: Create `src/components/PrintView.tsx` with Page 1 layout**

```tsx
import type { HazardZoneResult, PrintInputSummary, InputTier } from '../types';
// react-plotly.js CJS/ESM interop
import PlotlyModule from 'react-plotly.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Plot = ((PlotlyModule as any).default ?? PlotlyModule) as React.ComponentType<any>;

const M_TO_FT = 3.28084;
const TIER_LABELS: Record<InputTier, string> = {
  tier1: 'Tier 1 — Operator Mode (apogee only)',
  tier2: 'Tier 2 — Basic Geometry',
  tier3: 'Tier 3 — Full Geometry',
};

const BUILD_QUALITY_LABELS: Record<string, string> = {
  '1':    'Professional (×1.00)',
  '1.1':  'Good (×1.10)',
  '1.25': 'Average (×1.25)',
  '1.5':  'Poor (×1.50)',
};

// Inline style helpers — all light theme, no Tailwind dark utilities
const S = {
  page: {
    fontFamily: 'Georgia, serif',
    fontSize: '11px',
    lineHeight: '1.5',
    color: '#111',
    background: '#fff',
  } as React.CSSProperties,
  sectionHeader: {
    fontSize: '10px',
    fontWeight: 'bold',
    textTransform: 'uppercase' as const,
    letterSpacing: '.06em',
    color: '#333',
    borderBottom: '1px solid #ccc',
    paddingBottom: '3px',
    marginBottom: '7px',
  } as React.CSSProperties,
  pageFooter: {
    borderTop: '1px solid #ccc',
    paddingTop: '6px',
    marginTop: '16px',
    display: 'flex',
    justifyContent: 'space-between',
    fontSize: '8px',
    color: '#999',
  } as React.CSSProperties,
  page2: {
    pageBreakBefore: 'always',
  } as React.CSSProperties,
};

interface Props {
  result: HazardZoneResult;
  launchCoords: { lat: number; lon: number } | null;
  windBearing: number | null;
  inputSummary: PrintInputSummary | null;
  mapSnapshotUrl: string | null;
}

export function PrintView({ result, launchCoords, inputSummary, mapSnapshotUrl }: Props) {
  const r = result;
  const quarterFt = r.quarterAltitudeRule_m * M_TO_FT;
  const tier = inputSummary?.tier ?? 'tier1';

  // ── Trajectory traces (light theme) ──────────────────────────────────────
  const traces: object[] = [];
  if (r.trajectories) {
    const angles = Object.keys(r.trajectories).map(Number).sort((a, b) => a - b);
    for (const angle of angles) {
      const pts = r.trajectories[angle];
      if (!pts || pts.length === 0) continue;
      const isMax = angle === r.optimalAngle_deg;
      traces.push({
        x: pts.map(p => p.x * M_TO_FT),
        y: pts.map(p => Math.max(0, p.z) * M_TO_FT),
        type: 'scatter',
        mode: 'lines',
        name: `${angle}°`,
        line: { color: isMax ? '#2563eb' : '#94a3b8', width: isMax ? 2.5 : 1 },
        hoverinfo: 'skip',
      });
    }
  }
  if (r.hazardRadius_ft > 0) {
    traces.push({
      x: [r.hazardRadius_ft, r.hazardRadius_ft],
      y: [0, r.maxApogee_ft * 0.15],
      type: 'scatter',
      mode: 'lines',
      name: 'Hazard radius',
      line: { color: '#dc2626', width: 2, dash: 'dash' },
      hoverinfo: 'skip',
    });
  }

  const chartLayout = {
    paper_bgcolor: '#f8fafc',
    plot_bgcolor: '#f8fafc',
    font: { color: '#334155', size: 10, family: 'Georgia, serif' },
    xaxis: {
      title: { text: 'Downrange Distance (ft)', font: { size: 10 } },
      gridcolor: '#e2e8f0',
      zerolinecolor: '#94a3b8',
      rangemode: 'tozero' as const,
    },
    yaxis: {
      title: { text: 'Altitude AGL (ft)', font: { size: 10 } },
      gridcolor: '#e2e8f0',
      zerolinecolor: '#94a3b8',
      rangemode: 'tozero' as const,
    },
    margin: { l: 56, r: 16, t: 16, b: 48 },
    showlegend: true,
    legend: {
      bgcolor: 'rgba(248,250,252,0.9)',
      bordercolor: '#cbd5e1',
      borderwidth: 1,
      font: { size: 9 },
      x: 1, xanchor: 'right' as const, y: 1,
    },
    hovermode: false as const,
  };

  return (
    <div id="print-root" style={{ display: 'none' }}>

      {/* ── PAGE 1 ── */}
      <div style={S.page}>

        {/* Title block */}
        <div style={{ borderBottom: '2.5px solid #111', paddingBottom: '10px', marginBottom: '14px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{ fontSize: '17px', fontWeight: 'bold', textTransform: 'uppercase', letterSpacing: '.06em' }}>
                Hazard Zone Analysis Report
              </div>
              <div style={{ fontSize: '11px', color: '#444', marginTop: '2px', fontStyle: 'italic' }}>
                Amateur Rocketry — FAA AST Submittal
              </div>
            </div>
            <div style={{ textAlign: 'right', fontSize: '9px', color: '#555', lineHeight: '1.7' }}>
              <div><b>Date:</b> {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}</div>
              <div><b>Tier:</b> {TIER_LABELS[tier]}</div>
              <div><b>Generated by:</b> Hazard Zone Calculator v1.0</div>
            </div>
          </div>
          <div style={{ display: 'flex', gap: '24px', marginTop: '8px', fontSize: '9px', color: '#555', flexWrap: 'wrap' }}>
            {launchCoords && (
              <span><b>Launch site:</b> {launchCoords.lat.toFixed(5)}° N, {Math.abs(launchCoords.lon).toFixed(5)}° {launchCoords.lon < 0 ? 'W' : 'E'}</span>
            )}
            {inputSummary && <span><b>Site elevation:</b> {inputSummary.siteElevation_ft.toFixed(0)} ft MSL</span>}
            {inputSummary && <span><b>Max wind:</b> {inputSummary.maxWindSpeed_mph} MPH · <b>Max launch angle:</b> 20°</span>}
          </div>
        </div>

        {/* Warnings */}
        {r.warnings.length > 0 && (
          <div style={{ marginBottom: '14px' }}>
            {r.warnings.map((w, i) => (
              <div key={i} style={{ border: '1px solid #d97706', background: '#fffbeb', borderRadius: '4px', padding: '8px 10px', fontSize: '9px', color: '#92400e', marginBottom: '6px', pageBreakInside: 'avoid' }}>
                ⚠ {w}
              </div>
            ))}
          </div>
        )}

        {/* Methodology */}
        <div style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: '4px', padding: '10px', marginBottom: '14px', pageBreakInside: 'avoid' }}>
          <div style={{ fontSize: '10px', fontWeight: 'bold', color: '#334155', marginBottom: '4px' }}>Methodology</div>
          <div style={{ fontSize: '9px', color: '#555', lineHeight: '1.6' }}>
            3-DOF point-mass model (equivalent to TAOS, Sandia National Laboratories). Assumes nose-forward
            ballistic descent (conservative — lower drag than tumbling = longer range). CD estimated from body
            fineness ratio. Launch angle swept 0–20°, maximum wind speed 20 MPH. 1976 US Standard Atmosphere
            anchored to site elevation. Hazard radius = max(physics range, ¼ × apogee altitude).
          </div>
        </div>

        {/* Input Parameters */}
        {inputSummary && (
          <div style={{ marginBottom: '14px', pageBreakInside: 'avoid' }}>
            <div style={S.sectionHeader}>Input Parameters</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5px' }}>
              <tbody>
                {tier === 'tier1' ? (
                  <>
                    <tr style={{ background: '#f5f7fa' }}>
                      <td style={{ padding: '4px 8px', color: '#555', width: '35%' }}>Apogee altitude</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.apogee_ft?.toFixed(0) ?? r.maxApogee_ft.toFixed(0)} ft</td>
                      <td style={{ padding: '4px 8px', color: '#555', width: '35%' }}>Site elevation</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.siteElevation_ft.toFixed(0)} ft MSL</td>
                    </tr>
                  </>
                ) : (
                  <>
                    <tr style={{ background: '#f5f7fa' }}>
                      <td style={{ padding: '4px 8px', color: '#555', width: '35%' }}>Rocket diameter</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.diameter_in?.toFixed(3)} in ({((inputSummary.diameter_in ?? 0) * 25.4).toFixed(1)} mm)</td>
                      <td style={{ padding: '4px 8px', color: '#555', width: '35%' }}>Body length</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.length_in?.toFixed(1)} in ({((inputSummary.length_in ?? 0) * 25.4).toFixed(0)} mm)</td>
                    </tr>
                    <tr>
                      <td style={{ padding: '4px 8px', color: '#555' }}>Gross mass</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.totalMass_lb?.toFixed(3)} lb ({((inputSummary.totalMass_lb ?? 0) * 453.592).toFixed(0)} g)</td>
                      <td style={{ padding: '4px 8px', color: '#555' }}>Motor</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.motorDesignation ?? '—'} (Class {r.motorClass})</td>
                    </tr>
                    <tr style={{ background: '#f5f7fa' }}>
                      <td style={{ padding: '4px 8px', color: '#555' }}>Total impulse</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{r.totalImpulse_Ns.toFixed(1)} N·s</td>
                      <td style={{ padding: '4px 8px', color: '#555' }}>CD source</td>
                      <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.cdSource ?? '—'}</td>
                    </tr>
                    {inputSummary.buildQualityMultiplier != null && inputSummary.buildQualityMultiplier !== 1.0 && (
                      <tr>
                        <td style={{ padding: '4px 8px', color: '#555' }}>Build quality</td>
                        <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>
                          {BUILD_QUALITY_LABELS[String(inputSummary.buildQualityMultiplier)] ?? `×${inputSummary.buildQualityMultiplier}`}
                        </td>
                        <td style={{ padding: '4px 8px', color: '#555' }}>Effective CD</td>
                        <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{r.cdEffective?.toFixed(4) ?? '—'}</td>
                      </tr>
                    )}
                    {tier === 'tier3' && inputSummary.noseConeType && (
                      <tr style={{ background: '#f5f7fa' }}>
                        <td style={{ padding: '4px 8px', color: '#555' }}>Nose cone</td>
                        <td style={{ padding: '4px 8px', fontWeight: 'bold', textTransform: 'capitalize' }}>{inputSummary.noseConeType}</td>
                        <td style={{ padding: '4px 8px', color: '#555' }}>Number of fins</td>
                        <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>{inputSummary.numFins ?? '—'}</td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        )}

        {/* Results 2×2 */}
        <div style={{ marginBottom: '14px' }}>
          <div style={S.sectionHeader}>Results</div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', pageBreakInside: 'avoid' }}>
            <div style={{ border: '2px solid #1d4ed8', background: '#eff6ff', borderRadius: '4px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '8.5px', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>Hazard Zone Radius</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', color: '#1d4ed8', lineHeight: '1.1' }}>{r.hazardRadius_ft.toFixed(0)} ft</div>
              <div style={{ fontSize: '9px', color: '#888' }}>{r.hazardRadius_m.toFixed(0)} m</div>
            </div>
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '8.5px', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>Maximum Apogee</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', lineHeight: '1.1' }}>{r.maxApogee_ft.toFixed(0)} ft</div>
              <div style={{ fontSize: '9px', color: '#888' }}>{r.maxApogee_m.toFixed(0)} m</div>
            </div>
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '8.5px', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>Worst-case Launch Angle</div>
              <div style={{ fontSize: '22px', fontWeight: 'bold', lineHeight: '1.1' }}>{r.optimalAngle_deg}°</div>
              <div style={{ fontSize: '9px', color: '#888' }}>NAR/Tripoli max = 20°</div>
            </div>
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '10px', textAlign: 'center' }}>
              <div style={{ fontSize: '8.5px', color: '#555', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: '2px' }}>Motor</div>
              <div style={{ fontSize: '16px', fontWeight: 'bold', lineHeight: '1.2' }}>
                {r.motorClass === '?' ? 'Unknown (Tier 1)' : `Class ${r.motorClass}`}
              </div>
              <div style={{ fontSize: '9px', color: '#888' }}>
                {r.totalImpulse_Ns > 0 ? `${r.totalImpulse_Ns.toFixed(0)} N·s total impulse` : 'Tier 1 — no motor input'}
              </div>
            </div>
          </div>
        </div>

        {/* ¼-altitude rule */}
        <div style={{
          border: `1px solid ${r.quarterRuleConservative ? '#059669' : '#d97706'}`,
          background: r.quarterRuleConservative ? '#ecfdf5' : '#fffbeb',
          borderRadius: '4px', padding: '10px', marginBottom: '14px',
          display: 'flex', justifyContent: 'space-between', alignItems: 'center',
          pageBreakInside: 'avoid',
        }}>
          <div>
            <div style={{ fontSize: '10px', fontWeight: 'bold', color: r.quarterRuleConservative ? '#065f46' : '#92400e' }}>NAR/Tripoli ¼-Altitude Rule Check</div>
            <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>
              Apogee {r.maxApogee_ft.toFixed(0)} ft ÷ 4 = {quarterFt.toFixed(0)} ft minimum clear zone
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: '10px', fontWeight: 'bold', color: r.quarterRuleConservative ? '#059669' : '#d97706' }}>
              {r.quarterRuleConservative ? 'Rule is conservative' : 'Physics exceeds ¼ rule'}
            </div>
            <div style={{ fontSize: '9px', color: '#555' }}>
              {r.quarterRuleConservative
                ? `${quarterFt.toFixed(0)} ft (rule) ≥ ${r.hazardRadius_ft.toFixed(0)} ft (physics)`
                : `Use ${r.hazardRadius_ft.toFixed(0)} ft — rule gives only ${quarterFt.toFixed(0)} ft`}
            </div>
          </div>
        </div>

        {/* Stability (Tier 2/3 only) */}
        {r.stabilityMargin_cal != null && r.stabilityCategory != null && (
          <div style={{
            border: `1px solid ${r.stabilityCategory === 'stable' ? '#059669' : r.stabilityCategory === 'marginal' ? '#d97706' : '#dc2626'}`,
            background: r.stabilityCategory === 'stable' ? '#ecfdf5' : r.stabilityCategory === 'marginal' ? '#fffbeb' : '#fef2f2',
            borderRadius: '4px', padding: '10px', marginBottom: '14px',
            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
            pageBreakInside: 'avoid',
          }}>
            <div>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: r.stabilityCategory === 'stable' ? '#065f46' : r.stabilityCategory === 'marginal' ? '#92400e' : '#991b1b' }}>
                Static Stability Margin
              </div>
              <div style={{ fontSize: '9px', color: '#555', marginTop: '2px' }}>
                {r.stabilityMargin_cal.toFixed(2)} calibers
                {r.cdEffective != null && ` · Effective CD = ${r.cdEffective.toFixed(4)}`}
              </div>
            </div>
            <div style={{ textAlign: 'right' }}>
              <div style={{ fontSize: '10px', fontWeight: 'bold', color: r.stabilityCategory === 'stable' ? '#059669' : r.stabilityCategory === 'marginal' ? '#d97706' : '#dc2626' }}>
                {r.stabilityCategory === 'stable' ? 'Stable (≥ 1 cal)' : r.stabilityCategory === 'marginal' ? 'Marginal (0–1 cal)' : 'Unstable (< 0 cal)'}
              </div>
            </div>
          </div>
        )}

        {/* Page 1 footer */}
        <div style={S.pageFooter}>
          <span>3-DOF ballistic model · NAR/Tripoli safety envelope · 1976 US Standard Atmosphere</span>
          <span>Page 1 of 2</span>
        </div>
      </div>

      {/* ── PAGE 2 ── */}
      <div style={{ ...S.page, ...S.page2 }}>

        {/* Map */}
        <div style={{ marginBottom: '18px', pageBreakInside: 'avoid' }}>
          <div style={S.sectionHeader}>Launch Site — Hazard Zone Map</div>
          {mapSnapshotUrl ? (
            <>
              <img
                src={mapSnapshotUrl}
                alt="Hazard zone map"
                style={{ width: '100%', height: '220px', objectFit: 'cover', border: '1px solid #ccc', borderRadius: '4px', display: 'block' }}
              />
              <div style={{ fontSize: '8.5px', color: '#555', marginTop: '4px' }}>
                Red dashed circle = {r.hazardRadius_ft.toFixed(0)} ft ({r.hazardRadius_m.toFixed(0)} m) hazard radius · Blue dot = launch site · © OpenStreetMap contributors
              </div>
            </>
          ) : (
            /* Fallback when map fetch failed or no coords */
            <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '12px', background: '#f8fafc' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px', fontSize: '9.5px' }}>
                {launchCoords && (
                  <>
                    <div><span style={{ color: '#555' }}>Latitude: </span><b style={{ fontFamily: 'monospace' }}>{launchCoords.lat.toFixed(5)}° N</b></div>
                    <div><span style={{ color: '#555' }}>Longitude: </span><b style={{ fontFamily: 'monospace' }}>{Math.abs(launchCoords.lon).toFixed(5)}° {launchCoords.lon < 0 ? 'W' : 'E'}</b></div>
                  </>
                )}
                <div><span style={{ color: '#555' }}>Site elevation: </span><b>{inputSummary?.siteElevation_ft.toFixed(0) ?? '—'} ft MSL</b></div>
                <div><span style={{ color: '#555' }}>Hazard radius: </span><b style={{ color: '#1d4ed8' }}>{r.hazardRadius_ft.toFixed(0)} ft ({r.hazardRadius_m.toFixed(0)} m)</b></div>
              </div>
              <div style={{ marginTop: '8px', fontSize: '8px', color: '#888', fontStyle: 'italic' }}>
                Map image unavailable. See digital version for interactive map.
              </div>
            </div>
          )}
        </div>

        {/* Trajectory chart */}
        {traces.length > 0 && (
          <div style={{ marginBottom: '18px', pageBreakInside: 'avoid' }}>
            <div style={S.sectionHeader}>Ballistic Trajectory Sweep — Launch Angles 0°–20°</div>
            <Plot
              data={traces as never[]}
              layout={chartLayout}
              config={{ displayModeBar: false, responsive: false }}
              style={{ width: '100%', height: '280px' }}
            />
            <div style={{ fontSize: '8.5px', color: '#555', marginTop: '4px' }}>
              Blue = worst-case trajectory ({r.optimalAngle_deg}°) · Gray = other launch angles · Red dashed = hazard zone boundary · No recovery assumed
            </div>
          </div>
        )}

        {/* Tier 1 altitude range table */}
        {r.tier1Table && r.tier1Table.length > 0 && (
          <div style={{ marginBottom: '18px', pageBreakInside: 'avoid' }}>
            <div style={S.sectionHeader}>Altitude Range Table</div>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '9.5px' }}>
              <thead>
                <tr style={{ borderBottom: '1px solid #ccc' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: '#555', fontWeight: 'normal', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '.04em' }}>Apogee (ft AGL)</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', color: '#555', fontWeight: 'normal', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '.04em' }}>Hazard Radius (ft)</th>
                  <th style={{ textAlign: 'right', padding: '4px 8px', color: '#555', fontWeight: 'normal', textTransform: 'uppercase', fontSize: '8px', letterSpacing: '.04em' }}>Hazard Radius (m)</th>
                </tr>
              </thead>
              <tbody>
                {r.tier1Table.map((row, i) => (
                  <tr key={row.altitude_ft} style={{ borderBottom: '1px solid #f0f0f0', background: i % 2 === 0 ? '#f8fafc' : '#fff' }}>
                    <td style={{ padding: '3px 8px', fontFamily: 'monospace' }}>{row.altitude_ft.toLocaleString()}</td>
                    <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'monospace' }}>{row.hazardRadius_ft.toFixed(0)}</td>
                    <td style={{ padding: '3px 8px', textAlign: 'right', fontFamily: 'monospace', color: '#555' }}>{row.hazardRadius_m.toFixed(0)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {/* Barrowman breakdown (Tier 3, no OR CSV) */}
        {r.barrowmanBreakdown && (
          <div style={{ marginBottom: '18px', pageBreakInside: 'avoid' }}>
            <div style={S.sectionHeader}>Barrowman CD Breakdown</div>
            <table style={{ width: '50%', borderCollapse: 'collapse', fontSize: '9.5px' }}>
              <tbody>
                {[
                  ['Skin friction (nose + body)', r.barrowmanBreakdown.CD_friction.toFixed(4)],
                  ['Base drag', r.barrowmanBreakdown.CD_base.toFixed(4)],
                  ['Fin drag', r.barrowmanBreakdown.CD_fins.toFixed(4)],
                  ['Nose pressure drag', r.barrowmanBreakdown.CD_nose_pressure.toFixed(4)],
                ].map(([label, val], i) => (
                  <tr key={label} style={{ background: i % 2 === 0 ? '#f8fafc' : '#fff' }}>
                    <td style={{ padding: '3px 8px', color: '#555' }}>{label}</td>
                    <td style={{ padding: '3px 8px', fontFamily: 'monospace', textAlign: 'right' }}>{val}</td>
                  </tr>
                ))}
                <tr style={{ borderTop: '1px solid #ccc' }}>
                  <td style={{ padding: '4px 8px', fontWeight: 'bold' }}>Total Barrowman CD</td>
                  <td style={{ padding: '4px 8px', fontFamily: 'monospace', textAlign: 'right', fontWeight: 'bold', color: '#1d4ed8' }}>{r.barrowmanBreakdown.CD_total.toFixed(4)}</td>
                </tr>
              </tbody>
            </table>
          </div>
        )}

        {/* OR apogee comparison */}
        {r.orkApogee_m != null && (
          <div style={{ marginBottom: '18px', pageBreakInside: 'avoid' }}>
            <div style={S.sectionHeader}>
              Apogee Comparison — Model vs OpenRocket
              {r.orkMotorDesignation && <span style={{ fontWeight: 'normal', marginLeft: '8px', color: '#888' }}>({r.orkMotorDesignation})</span>}
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', textAlign: 'center', marginBottom: '8px' }}>
              <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '8px' }}>
                <div style={{ fontSize: '8.5px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>Our model (3-DOF)</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#1d4ed8' }}>{r.maxApogee_ft.toFixed(0)} ft</div>
              </div>
              <div style={{ border: '1px solid #ccc', borderRadius: '4px', padding: '8px' }}>
                <div style={{ fontSize: '8.5px', color: '#555', textTransform: 'uppercase', marginBottom: '4px' }}>OpenRocket (stored)</div>
                <div style={{ fontSize: '18px', fontWeight: 'bold', color: '#7c3aed' }}>{(r.orkApogee_m * M_TO_FT).toFixed(0)} ft</div>
              </div>
            </div>
            {(() => {
              const pct = ((r.maxApogee_m - r.orkApogee_m!) / r.orkApogee_m!) * 100;
              const over = pct >= 0;
              return (
                <div style={{ textAlign: 'center', padding: '6px', border: `1px solid ${over ? '#059669' : '#d97706'}`, background: over ? '#ecfdf5' : '#fffbeb', borderRadius: '4px', fontSize: '9px', color: over ? '#065f46' : '#92400e' }}>
                  <b>{over ? '+' : ''}{pct.toFixed(1)}%</b> {over ? 'conservative overshoot' : 'undershooting OR — review inputs'}
                </div>
              );
            })()}
          </div>
        )}

        {/* Page 2 footer */}
        <div style={S.pageFooter}>
          <span>Hazard Zone Calculator v1.0</span>
          <span>Page 2 of 2</span>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/components/PrintView.tsx
git commit -m "feat(print): add PrintView component with two-page formal report layout"
```

---

## Task 4: Wire `App.tsx`

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Add imports + state to `App.tsx`**

Add to the import block at the top of `src/App.tsx`:
```tsx
import { PrintView } from './components/PrintView';
import { buildMapSnapshot } from './utils/mapSnapshot';
import type { PrintInputSummary } from './types';
```

Add to the state declarations inside `App()` (after the existing `useState` calls):
```tsx
const [inputSummary, setInputSummary] = useState<PrintInputSummary | null>(null);
const [mapSnapshot, setMapSnapshot] = useState<string | null>(null);
const [printPending, setPrintPending] = useState(false);
```

- [ ] **Step 2: Add `handlePrint` + `useEffect` to `App.tsx`**

Add after the `handleError` function:
```tsx
const handlePrint = async () => {
  if (launchCoords && result) {
    const snap = await buildMapSnapshot(launchCoords.lat, launchCoords.lon, result.hazardRadius_m);
    setMapSnapshot(snap);
  }
  setPrintPending(true);
};

useEffect(() => {
  if (printPending) {
    setPrintPending(false);
    // One tick delay: let React flush PrintView's updated mapSnapshotUrl before printing
    setTimeout(() => window.print(), 50);
  }
}, [printPending, mapSnapshot]);
```

Add `useEffect` to the React import at the top:
```tsx
import { useState, useEffect } from 'react';
```

- [ ] **Step 3: Add `print:hidden` to debug log and update form props + render `PrintView`**

In `src/App.tsx`, find the debug log div (line ~114):
```tsx
{debugLog && (
  <div className="rounded-xl border border-slate-600 bg-slate-800/60 overflow-hidden">
```
Change to:
```tsx
{debugLog && (
  <div className="rounded-xl border border-slate-600 bg-slate-800/60 overflow-hidden print:hidden">
```

Update the `Tier1Form` render to add `onInputChange`:
```tsx
<Tier1Form
  onComputing={() => { setComputing(true); setError(null); setDebugLog('Computing...'); }}
  onResult={handleResult}
  onError={handleError}
  onCoordsChange={(lat, lon) => setLaunchCoords({ lat, lon })}
  onWindBearingChange={(b) => setWindBearing(b)}
  onInputChange={setInputSummary}
/>
```

Update the `Tier2Form` render to add `onInputChange`:
```tsx
<Tier2Form
  tier={tier}
  onComputing={() => { setComputing(true); setError(null); setDebugLog('Computing...'); }}
  onResult={handleResult}
  onError={handleError}
  onCoordsChange={(lat, lon) => setLaunchCoords({ lat, lon })}
  onWindBearingChange={(b) => setWindBearing(b)}
  onInputChange={setInputSummary}
/>
```

After the `<ErrorBoundary>` block (that wraps `<Results>`), add `<PrintView>`:
```tsx
{result && !computing && (
  <ErrorBoundary>
    <Results
      result={result}
      launchCoords={launchCoords}
      windBearing={windBearing}
      onPrint={handlePrint}
    />
  </ErrorBoundary>
)}
{result && (
  <PrintView
    result={result}
    launchCoords={launchCoords}
    windBearing={windBearing}
    inputSummary={inputSummary}
    mapSnapshotUrl={mapSnapshot}
  />
)}
```

- [ ] **Step 4: TypeScript check** — will fail until Tasks 5 and 6 add the new props to forms and Results

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected at this point: errors about missing `onInputChange` on Tier1Form/Tier2Form and missing `onPrint` on Results — that's fine, proceed to Tasks 5 and 6.

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(print): wire App.tsx — print state, handlePrint, PrintView render"
```

---

## Task 5: Wire `Tier1Form.tsx`

**Files:**
- Modify: `src/components/Tier1Form.tsx`

- [ ] **Step 1: Add `onInputChange` to `Tier1Form` Props and fire it on compute**

In `src/components/Tier1Form.tsx`, update the imports to add `PrintInputSummary`:
```tsx
import type { HazardZoneResult, PrintInputSummary } from '../types';
```

Update the Props interface:
```tsx
interface Props {
  onComputing: () => void;
  onResult: (r: HazardZoneResult) => void;
  onError: (msg: string) => void;
  onCoordsChange?: (lat: number, lon: number) => void;
  onWindBearingChange?: (bearing: number | null) => void;
  onInputChange?: (summary: PrintInputSummary) => void;
}
```

Update the destructured props in the function signature:
```tsx
export function Tier1Form({ onComputing, onResult, onError, onCoordsChange, onWindBearingChange, onInputChange }: Props) {
```

In `handleSubmit`, immediately before `onResult({ ...result, tier1Table })` (line ~111), add:
```tsx
onInputChange?.({
  tier: 'tier1',
  apogee_ft: apogee_ft,
  siteElevation_ft: elev_ft,
  maxWindSpeed_mph: 20,
});
```

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: fewer errors now. Only `onPrint` on Results remains.

- [ ] **Step 3: Commit**

```bash
git add src/components/Tier1Form.tsx
git commit -m "feat(print): add onInputChange to Tier1Form"
```

---

## Task 6: Wire `Tier2Form.tsx`

**Files:**
- Modify: `src/components/Tier2Form.tsx`

- [ ] **Step 1: Add `onInputChange` to `Tier2Form` Props and fire it on compute**

In `src/components/Tier2Form.tsx`, update the imports to add `PrintInputSummary`:
```tsx
import type { HazardZoneResult, InputTier, Motor, OpenRocketData, PrintInputSummary } from '../types';
```

Update the Props interface:
```tsx
interface Props {
  tier: InputTier;
  onComputing: () => void;
  onResult: (r: HazardZoneResult) => void;
  onError: (msg: string) => void;
  onCoordsChange?: (lat: number, lon: number) => void;
  onWindBearingChange?: (bearing: number | null) => void;
  onInputChange?: (summary: PrintInputSummary) => void;
}
```

Update the destructured props in the function signature:
```tsx
export function Tier2Form({ tier, onComputing, onResult, onError, onCoordsChange, onWindBearingChange, onInputChange }: Props) {
```

In the `setTimeout` callback, immediately before `onResult({...})` (line ~467), determine the CD source label and add the call:
```tsx
// Determine CD source label for print summary
const cdSourceLabel = (() => {
  if (orFlightData) return 'OR flight CSV (median pre-apogee)';
  if (manualCdOverride) return '.ork file (min powered-flight CD)';
  if (isTier3 && barrowmanBreakdown) return 'Barrowman component buildup';
  return 'Fineness ratio estimate';
})();

onInputChange?.({
  tier,
  siteElevation_ft: elev,
  maxWindSpeed_mph: w_mph,
  diameter_in: d_in,
  length_in: l_in,
  totalMass_lb: m_lb,
  motorDesignation: motor?.designation ?? motorDesig,
  cdSource: cdSourceLabel,
  buildQualityMultiplier: bq,
  noseConeType: isTier3 ? noseType : undefined,
  numFins: isTier3 ? parseInt(numFins) || undefined : undefined,
  nozzleExitDiameter_in: isTier3 && nozzleDia ? parseFloat(nozzleDia) || undefined : undefined,
});
```

Note: `manualCdOverride`, `orFlightData`, `barrowmanBreakdown`, `elev`, `w_mph`, `d_in`, `l_in`, `m_lb`, `bq`, `motor`, `motorDesig` are all already in scope at that point in `handleCompute`.

- [ ] **Step 2: TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: only the `onPrint` on Results error remains.

- [ ] **Step 3: Commit**

```bash
git add src/components/Tier2Form.tsx
git commit -m "feat(print): add onInputChange to Tier2Form"
```

---

## Task 7: Update `Results.tsx` Print Button

**Files:**
- Modify: `src/components/Results.tsx`

- [ ] **Step 1: Add `onPrint` prop to Results**

In `src/components/Results.tsx`, update the Props interface:
```tsx
interface Props {
  result: HazardZoneResult;
  launchCoords?: { lat: number; lon: number } | null;
  windBearing?: number | null;
  onPrint?: () => void;
}
```

Update the function signature:
```tsx
export function Results({ result, launchCoords, windBearing, onPrint }: Props) {
```

Find the Print button (line ~461):
```tsx
<button
  onClick={() => window.print()}
  className="text-xs px-3 py-1.5 rounded border border-blue-600 hover:border-blue-400 text-blue-400 hover:text-blue-200 transition-colors"
>
  Print / Save as PDF
</button>
```

Replace with:
```tsx
<button
  onClick={() => onPrint ? onPrint() : window.print()}
  className="text-xs px-3 py-1.5 rounded border border-blue-600 hover:border-blue-400 text-blue-400 hover:text-blue-200 transition-colors"
>
  Print / Save as PDF
</button>
```

- [ ] **Step 2: TypeScript check — should now be clean**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: **no errors**.

- [ ] **Step 3: Commit**

```bash
git add src/components/Results.tsx
git commit -m "feat(print): wire Results.tsx onPrint prop; complete print pipeline"
```

---

## Task 8: Manual Test + Final Verification

- [ ] **Step 1: Start dev server**

```bash
cd "C:/Users/bsoltes/FAA Hazard analysis/hazard-zone-calculator"
npm run dev
```

- [ ] **Step 2: Test Tier 1 print**

  1. Select Tier 1, enter apogee = 2000 ft, click Compute
  2. Click "Print / Save as PDF"
  3. Browser print preview should show: white two-page layout, Page 1 with methodology at top, no form/nav/debug log
  4. Page 2: coordinates fallback block (no launch coords set), no trajectory chart (Tier 1 has none)
  5. Cancel print

- [ ] **Step 3: Test Tier 2 print with GPS coords**

  1. Select Tier 2, fill in geometry (diameter: 1.637, length: 30, mass: 0.34), select a motor
  2. Enter lat/lon (e.g. 35.12345, -106.54321), click Lookup Elevation
  3. Click Compute
  4. Click "Print / Save as PDF"
  5. Print preview Page 1: formal report with inputs table, results 2×2, stability panel
  6. Print preview Page 2: OSM map tile image with hazard circle, trajectory sweep chart in light theme
  7. Confirm no dark backgrounds, no form visible

- [ ] **Step 4: Test Tier 3 print with .ork file**

  1. Select Tier 3, upload a `.ork` file
  2. Compute
  3. Print preview — confirm Barrowman breakdown appears on Page 2
  4. If OR CSV was also loaded, confirm OR comparison appears and Barrowman is hidden (matches screen behavior)

- [ ] **Step 5: Test map fetch failure fallback**

  Temporarily change the OSM URL in `mapSnapshot.ts` to a bad URL (`https://invalid.example.com/`), recompute with GPS coords, print. Confirm Page 2 shows the coordinates fallback block. Revert the URL change.

- [ ] **Step 6: Final TypeScript check**

```bash
npx tsc --noEmit -p tsconfig.app.json
```

Expected: no errors.

- [ ] **Step 7: Final commit**

```bash
git add -A
git commit -m "feat(print): formal two-page PDF report — FAA AST submission ready

- PrintView component with light-themed two-page layout
- OSM tile map snapshot with hazard circle (canvas stitching)
- Tier-conditional sections: stability, Barrowman, OR comparison, altitude table
- Print pipeline: buildMapSnapshot → React flush → window.print()
- Bug fixes: debug log hidden in print, @media print hides app/shows PrintView

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>"
```
