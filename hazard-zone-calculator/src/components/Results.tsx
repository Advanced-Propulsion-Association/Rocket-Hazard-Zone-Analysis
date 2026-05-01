import { useState } from 'react';
// react-plotly.js is CommonJS; handle Vite CJS/ESM interop
import PlotlyModule from 'react-plotly.js';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const Plot = ((PlotlyModule as any).default ?? PlotlyModule) as React.ComponentType<any>;
import type { HazardZoneResult } from '../types';
import type React from 'react';
import { MapPanel } from './MapPanel';

interface Props {
  result: HazardZoneResult;
  launchCoords?: { lat: number; lon: number } | null;
  windBearing?: number | null;
  onPrint?: () => void;
}

const M_TO_FT = 3.28084;

function downloadFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function Results({ result, launchCoords, windBearing, onPrint }: Props) {
  const r = result;
  const quarterFt = r.quarterAltitudeRule_m * M_TO_FT;
  const [showPlot, setShowPlot] = useState(true);

  const handleExportResults = () => {
    const summary = {
      exportedAt: new Date().toISOString(),
      hazardRadius_ft: r.hazardRadius_ft,
      hazardRadius_m: r.hazardRadius_m,
      maxApogee_ft: r.maxApogee_ft,
      maxApogee_m: r.maxApogee_m,
      optimalAngle_deg: r.optimalAngle_deg,
      motorClass: r.motorClass,
      totalImpulse_Ns: r.totalImpulse_Ns,
      quarterAltitudeRule_ft: r.quarterAltitudeRule_m * M_TO_FT,
      quarterAltitudeRule_m: r.quarterAltitudeRule_m,
      quarterRuleConservative: r.quarterRuleConservative,
      tier1DescentRange_ft: r.tier1DescentRange_m != null ? r.tier1DescentRange_m * M_TO_FT : undefined,
      tier1AscentOffset_ft: r.tier1AscentOffset_m != null ? r.tier1AscentOffset_m * M_TO_FT : undefined,
      stabilityMargin_cal: r.stabilityMargin_cal,
      cdMultiplier: r.cdMultiplier,
      stabilityCategory: r.stabilityCategory,
      orkApogee_ft: r.orkApogee_m != null ? r.orkApogee_m * M_TO_FT : undefined,
      orkMotorDesignation: r.orkMotorDesignation,
      warnings: r.warnings,
    };
    downloadFile(JSON.stringify(summary, null, 2), `hazard-results-${Date.now()}.json`, 'application/json');
  };

  const handleExportCsv = () => {
    if (!r.trajectories) return;
    const rows = ['angle_deg,t_s,x_ft,z_ft,vx_fps,vz_fps,mass_kg,mach,thrust_N,drag_N'];
    for (const [angleDeg, pts] of Object.entries(r.trajectories)) {
      for (const p of pts) {
        rows.push([
          angleDeg,
          p.t.toFixed(3),
          (p.x * M_TO_FT).toFixed(1),
          (Math.max(0, p.z) * M_TO_FT).toFixed(1),
          (p.vx * M_TO_FT).toFixed(2),
          (p.vz * M_TO_FT).toFixed(2),
          p.mass.toFixed(4),
          p.mach.toFixed(4),
          p.thrust.toFixed(2),
          p.drag.toFixed(2),
        ].join(','));
      }
    }
    downloadFile(rows.join('\n'), `hazard-trajectory-${Date.now()}.csv`, 'text/csv');
  };

  const handleExportTableCsv = () => {
    if (!r.tier1Table) return;
    const rows = ['apogee_ft,hazard_radius_ft,hazard_radius_m'];
    for (const row of r.tier1Table) {
      rows.push(`${row.altitude_ft},${row.hazardRadius_ft.toFixed(0)},${row.hazardRadius_m.toFixed(0)}`);
    }
    downloadFile(rows.join('\n'), `hazard-range-table-${Date.now()}.csv`, 'text/csv');
  };

  // Build trajectory traces
  const traces: object[] = [];
  if (r.trajectories) {
    const angles = Object.keys(r.trajectories).map(Number).sort((a, b) => a - b);
    for (const angle of angles) {
      const pts = r.trajectories[angle];
      if (!pts || pts.length === 0) continue;
      const isMax = angle === r.optimalAngle_deg;
      // Clamp z to >= 0 for clean display; filter out any NaN
      const xs = pts.map(p => p.x * M_TO_FT).filter(v => isFinite(v));
      const ys = pts.map(p => Math.max(0, p.z) * M_TO_FT).filter(v => isFinite(v));
      traces.push({
        x: xs,
        y: ys,
        type: 'scatter',
        mode: 'lines',
        name: `${angle}\u00b0`,
        line: {
          color: isMax ? '#3b82f6' : '#475569',
          width: isMax ? 2.5 : 1,
        },
        hovertemplate: `${angle}\u00b0 \u2014 downrange: %{x:.0f} ft, alt: %{y:.0f} ft<extra></extra>`,
      });
    }
  }

  // Hazard radius line (vertical dashed line at impact radius)
  if (r.hazardRadius_ft > 0) {
    traces.push({
      x: [r.hazardRadius_ft, r.hazardRadius_ft],
      y: [0, r.maxApogee_ft * 0.15],
      type: 'scatter',
      mode: 'lines',
      name: 'Hazard radius',
      line: { color: '#ef4444', width: 2, dash: 'dash' },
      hovertemplate: `Hazard zone: ${r.hazardRadius_ft.toFixed(0)} ft<extra></extra>`,
    });
  }

  const layout = {
    paper_bgcolor: '#1e293b',
    plot_bgcolor: '#1e293b',
    font: { color: '#94a3b8', size: 11, family: 'system-ui, sans-serif' },
    xaxis: {
      title: { text: 'Downrange Distance (ft)', font: { size: 11 } },
      gridcolor: '#334155',
      zerolinecolor: '#64748b',
      rangemode: 'tozero' as const,
    },
    yaxis: {
      title: { text: 'Altitude AGL (ft)', font: { size: 11 } },
      gridcolor: '#334155',
      zerolinecolor: '#64748b',
      rangemode: 'tozero' as const,
    },
    margin: { l: 60, r: 20, t: 20, b: 50 },
    showlegend: true,
    legend: {
      bgcolor: 'rgba(30,41,59,0.9)',
      bordercolor: '#475569',
      borderwidth: 1,
      font: { size: 10 },
      x: 1,
      xanchor: 'right' as const,
      y: 1,
    },
    hovermode: 'closest' as const,
  };

  return (
    <div className="space-y-6" id="results-print-root">
      {/* Print-only header */}
      <div className="hidden print:block border-b border-slate-600 pb-4 mb-2">
        <h1 className="text-xl font-bold text-black">FAA Rocket Hazard Zone Analysis</h1>
        <p className="text-sm text-gray-600 mt-1">
          Generated {new Date().toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' })}
          {launchCoords ? ` · Launch site: ${launchCoords.lat.toFixed(5)}°, ${launchCoords.lon.toFixed(5)}°` : ''}
        </p>
        <p className="text-sm text-gray-600">
          3-DOF ballistic trajectory · NAR/Tripoli safety envelope · 1976 US Standard Atmosphere
        </p>
      </div>

      {/* Warnings */}
      {r.warnings.length > 0 && (
        <div className="space-y-2">
          {r.warnings.map((w, i) => (
            <div key={i} className="bg-amber-900/40 border border-amber-600 rounded-lg px-4 py-2.5 text-sm text-amber-300 flex items-start gap-2">
              <span className="mt-0.5 shrink-0">[!]</span>
              <span>{w}</span>
            </div>
          ))}
        </div>
      )}

      {/* Stability margin panel */}
      {r.stabilityMargin_cal != null && r.stabilityCategory != null && (
        <div className={`rounded-xl border px-5 py-4 ${
          r.stabilityCategory === 'stable'
            ? 'border-emerald-700 bg-emerald-900/20'
            : r.stabilityCategory === 'marginal'
              ? 'border-amber-700 bg-amber-900/20'
              : 'border-red-700 bg-red-900/20'
        }`}>
          <div className="flex justify-between items-start gap-4 flex-wrap">
            <div>
              <p className="text-sm font-medium text-slate-200">Static Stability Margin</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {r.stabilityMargin_cal.toFixed(2)} calibers
                {r.cdEffective != null && (
                  r.cdMultiplier != null && r.cdMultiplier !== 1.0
                    ? <> &middot; CD corrected &times;{r.cdMultiplier.toFixed(1)} &rarr; effective CD&nbsp;=&nbsp;{r.cdEffective.toFixed(3)}</>
                    : <> &middot; effective CD&nbsp;=&nbsp;{r.cdEffective.toFixed(3)}</>
                )}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className={`text-sm font-bold ${
                r.stabilityCategory === 'stable' ? 'text-emerald-400'
                : r.stabilityCategory === 'marginal' ? 'text-amber-400'
                : 'text-red-400'
              }`}>
                {r.stabilityCategory === 'stable' ? 'Stable (\u22651 cal)'
                  : r.stabilityCategory === 'marginal' ? 'Marginal (0\u20131 cal)'
                  : 'Unstable (< 0 cal)'}
              </p>
            </div>
          </div>
          {r.cdMultiplier != null && r.cdMultiplier !== 1.0 && (
            <p className="mt-2 text-xs text-slate-400">
              Low-stability rockets tend to tumble during descent, which increases drag and
              <strong className="text-slate-200"> shortens</strong> the hazard zone versus
              a nose-forward ballistic model. The corrected CD is applied, but the default
              nose-forward model is more conservative — consider using both.
            </p>
          )}
        </div>
      )}

      {/* Barrowman CD breakdown (Tier 3 only) */}
      {r.barrowmanBreakdown && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-4">
          <p className="text-sm font-medium text-slate-200 mb-3">Barrowman CD Breakdown</p>
          <div className="grid grid-cols-2 gap-x-8 gap-y-1.5 text-sm">
            <span className="text-slate-400">Skin friction (nose + body)</span>
            <span className="text-white tabular-nums">{r.barrowmanBreakdown.CD_friction.toFixed(4)}</span>
            <span className="text-slate-400">Base drag</span>
            <span className="text-white tabular-nums">{r.barrowmanBreakdown.CD_base.toFixed(4)}</span>
            <span className="text-slate-400">Fin drag</span>
            <span className="text-white tabular-nums">{r.barrowmanBreakdown.CD_fins.toFixed(4)}</span>
            <span className="text-slate-400">Nose pressure drag</span>
            <span className="text-white tabular-nums">{r.barrowmanBreakdown.CD_nose_pressure.toFixed(4)}</span>
            <span className="text-slate-400">Parasitic (lugs, roughness)</span>
            <span className="text-white tabular-nums">{r.barrowmanBreakdown.CD_parasitic.toFixed(4)}</span>
            <span className="text-slate-300 font-medium border-t border-slate-700 pt-2">Total Barrowman CD</span>
            <span className="text-blue-300 font-bold tabular-nums border-t border-slate-700 pt-2">
              {r.barrowmanBreakdown.CD_total.toFixed(4)}
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-3">
            Build quality and stability correction applied on top.
            Final simulation CD = {r.cdEffective?.toFixed(4) ?? '—'}.
          </p>
        </div>
      )}

      {/* Main result cards */}
      <div className="grid grid-cols-2 gap-4">
        <ResultCard
          label="Hazard Zone Radius"
          primary={`${r.hazardRadius_ft.toFixed(0)} ft`}
          secondary={`${r.hazardRadius_m.toFixed(0)} m`}
          accent
        />
        <ResultCard
          label="Maximum Apogee"
          primary={`${r.maxApogee_ft.toFixed(0)} ft`}
          secondary={`${r.maxApogee_m.toFixed(0)} m`}
        />
        <ResultCard
          label="Worst-case Launch Angle"
          primary={`${r.optimalAngle_deg}\u00b0 from vertical`}
          secondary="NAR/Tripoli max = 20\u00b0"
        />
        <ResultCard
          label="Motor"
          primary={r.motorClass === '?' ? 'Unknown (Tier 1)' : `Class ${r.motorClass}`}
          secondary={r.totalImpulse_Ns > 0 ? `${r.totalImpulse_Ns.toFixed(0)} N\u00b7s total impulse` : 'Use Tier 2/3 for motor details'}
        />
      </div>

      {/* Multi-stage: per-stage impact ranges */}
      {r.stageImpacts && r.stageImpacts.length > 1 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-4">
          <p className="text-sm font-medium text-slate-200 mb-3">Per-Stage Impact Ranges</p>
          <div className="space-y-2">
            {r.stageImpacts.map(si => {
              const isGoverning = si.range_ft === Math.max(...r.stageImpacts!.map(x => x.range_ft));
              return (
                <div key={si.stage} className={`rounded-lg px-4 py-2.5 ${
                  isGoverning ? 'bg-blue-600/15 border border-blue-600/40' : 'bg-slate-700/30'}`}>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-slate-300">{si.label}</span>
                    <div className="text-right">
                      <span className={`text-sm font-bold tabular-nums ${isGoverning ? 'text-blue-300' : 'text-slate-200'}`}>
                        {si.range_ft.toFixed(0)} ft
                      </span>
                      <span className="text-xs text-slate-500 ml-2">{si.range_m.toFixed(0)} m</span>
                      {isGoverning && <span className="ml-2 text-xs text-blue-400">governing</span>}
                    </div>
                  </div>
                  {si.cdFlight != null && (
                    <div className="mt-1 flex flex-wrap gap-x-4 text-xs text-slate-500">
                      <span>
                        Flight CD: <span className={si.hasCdOverride ? 'text-violet-400' : 'text-slate-400'}>
                          {si.cdFlight.toFixed(3)}
                        </span>
                        {si.hasCdOverride && <span className="text-slate-600 ml-1">(from .ork)</span>}
                        {!si.hasCdOverride && <span className="text-slate-600 ml-1">(Barrowman)</span>}
                      </span>
                      {si.cdDescent != null && (
                        <span>
                          Descent CD: <span className="text-amber-400">{si.cdDescent.toFixed(3)}</span>
                          <span className="text-slate-600 ml-1">(tumbling ×2)</span>
                        </span>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* 1/4 rule comparison */}
      <div className={`rounded-xl border px-5 py-4 ${
        r.quarterRuleConservative
          ? 'border-emerald-700 bg-emerald-900/20'
          : 'border-amber-700 bg-amber-900/20'
      }`}>
        <div className="flex justify-between items-center gap-4 flex-wrap">
          <div>
            <p className="text-sm font-medium text-slate-200">NAR/Tripoli 1/4-Altitude Rule Check</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Apogee {r.maxApogee_ft.toFixed(0)} ft &divide; 4 = {quarterFt.toFixed(0)} ft minimum clear zone
            </p>
          </div>
          <div className="text-right shrink-0">
            <p className={`text-sm font-bold ${r.quarterRuleConservative ? 'text-emerald-400' : 'text-amber-400'}`}>
              {r.quarterRuleConservative ? 'Rule is conservative' : 'Physics exceeds 1/4 rule'}
            </p>
            <p className="text-xs text-slate-400 mt-0.5">
              {r.quarterRuleConservative
                ? `${quarterFt.toFixed(0)} ft (rule) >= ${r.hazardRadius_ft.toFixed(0)} ft (physics)`
                : `Use ${r.hazardRadius_ft.toFixed(0)} ft — rule gives only ${quarterFt.toFixed(0)} ft`}
            </p>
          </div>
        </div>
      </div>

      {/* Hazard zone map */}
      {launchCoords && (
        <div className="rounded-xl border border-slate-700 overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/60">
            <p className="text-sm font-medium text-slate-200">Hazard Zone Map</p>
            <p className="text-xs text-slate-400 mt-0.5">
              Red circle = {r.hazardRadius_ft.toFixed(0)} ft ({r.hazardRadius_m.toFixed(0)} m) radius
              {windBearing != null ? ` · Blue arrow = wind from ${windBearing}°` : ''}
            </p>
          </div>
          <MapPanel
            lat={launchCoords.lat}
            lon={launchCoords.lon}
            hazardRadius_m={r.hazardRadius_m}
            windBearing={windBearing}
          />
        </div>
      )}

      {/* OpenRocket apogee comparison */}
      {r.orkApogee_m != null && (
        <div className="rounded-xl border border-violet-700 bg-violet-900/20 px-5 py-4">
          <p className="text-sm font-medium text-slate-200 mb-3">
            Apogee Comparison — Our Model vs OpenRocket
            {r.orkMotorDesignation && (
              <span className="ml-2 text-xs font-normal text-slate-400">({r.orkMotorDesignation})</span>
            )}
          </p>
          <div className="grid grid-cols-2 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Our model (3-DOF)</p>
              <p className="text-2xl font-bold text-blue-300 tabular-nums">{r.maxApogee_ft.toFixed(0)} ft</p>
              <p className="text-xs text-slate-500 mt-0.5">{r.maxApogee_m.toFixed(0)} m</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">OpenRocket (stored)</p>
              <p className="text-2xl font-bold text-violet-300 tabular-nums">{(r.orkApogee_m * M_TO_FT).toFixed(0)} ft</p>
              <p className="text-xs text-slate-500 mt-0.5">{r.orkApogee_m.toFixed(0)} m</p>
            </div>
          </div>
          {(() => {
            const pct = ((r.maxApogee_m - r.orkApogee_m!) / r.orkApogee_m!) * 100;
            const over = pct >= 0;
            return (
              <div className={`mt-3 rounded-lg px-4 py-2.5 text-center ${over ? 'bg-emerald-900/30 border border-emerald-700/50' : 'bg-amber-900/30 border border-amber-700/50'}`}>
                <span className={`text-lg font-bold tabular-nums ${over ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {over ? '+' : ''}{pct.toFixed(1)}%
                </span>
                <span className={`ml-2 text-xs ${over ? 'text-emerald-300/70' : 'text-amber-300/70'}`}>
                  {over ? 'conservative overshoot' : 'undershooting OR — review inputs'}
                </span>
              </div>
            );
          })()}
          <p className="mt-3 text-xs text-slate-400">
            Our model is a 3-DOF ballistic simulation (no recovery, conservative CD). OpenRocket uses
            a 6-DOF model with fins, recovery, and more detailed aerodynamics. Differences &lt;15% are
            expected; larger differences may indicate a mismatch in motor or geometry inputs.
          </p>
        </div>
      )}

      {/* Tier 1 descent / ascent breakdown */}
      {r.tier1DescentRange_m != null && r.tier1AscentOffset_m != null && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 px-5 py-4">
          <p className="text-sm font-medium text-slate-200 mb-3">Tier 1 Hazard Zone Breakdown</p>
          <div className="grid grid-cols-3 gap-4 text-center">
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Descent range</p>
              <p className="text-lg font-bold text-white tabular-nums">{(r.tier1DescentRange_m * M_TO_FT).toFixed(0)} ft</p>
              <p className="text-xs text-slate-500">Fall from apogee under 20 MPH wind</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">+ Ascent offset</p>
              <p className="text-lg font-bold text-white tabular-nums">{(r.tier1AscentOffset_m * M_TO_FT).toFixed(0)} ft</p>
              <p className="text-xs text-slate-500">Apogee × tan(20°) × 0.4</p>
            </div>
            <div>
              <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">= Physics range</p>
              <p className="text-lg font-bold text-blue-300 tabular-nums">
                {((r.tier1DescentRange_m + r.tier1AscentOffset_m) * M_TO_FT).toFixed(0)} ft
              </p>
              <p className="text-xs text-slate-500">Floor: max(physics, ¼-altitude rule)</p>
            </div>
          </div>
        </div>
      )}

      {/* Tier 1 altitude range table */}
      {r.tier1Table && r.tier1Table.length > 0 && (
        <div className="rounded-xl border border-slate-700 bg-slate-800/40 overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-700 bg-slate-800/60 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-slate-200">Altitude Range Table</p>
              <p className="text-xs text-slate-400 mt-0.5">
                Hazard radius at each altitude increment — same site elevation and build quality.
              </p>
            </div>
            <button
              onClick={handleExportTableCsv}
              className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-colors shrink-0"
            >
              Download CSV
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700">
                  <th className="text-left px-5 py-2.5 text-xs text-slate-400 uppercase tracking-wide font-medium">Apogee (ft AGL)</th>
                  <th className="text-right px-5 py-2.5 text-xs text-slate-400 uppercase tracking-wide font-medium">Hazard Radius (ft)</th>
                  <th className="text-right px-5 py-2.5 text-xs text-slate-400 uppercase tracking-wide font-medium">Hazard Radius (m)</th>
                </tr>
              </thead>
              <tbody>
                {r.tier1Table.map((row) => {
                  const isTarget = row.altitude_ft === Math.round(r.maxApogee_ft / (r.maxApogee_ft >= 10000 ? 1000 : 500)) * (r.maxApogee_ft >= 10000 ? 1000 : 500);
                  return (
                    <tr
                      key={row.altitude_ft}
                      className={`border-b border-slate-700/50 ${isTarget ? 'bg-blue-600/10' : 'hover:bg-slate-700/30'}`}
                    >
                      <td className={`px-5 py-2 tabular-nums ${isTarget ? 'text-blue-300 font-medium' : 'text-slate-200'}`}>
                        {row.altitude_ft.toLocaleString()}
                      </td>
                      <td className={`px-5 py-2 text-right tabular-nums ${isTarget ? 'text-blue-300 font-medium' : 'text-slate-200'}`}>
                        {row.hazardRadius_ft.toFixed(0)}
                      </td>
                      <td className={`px-5 py-2 text-right tabular-nums ${isTarget ? 'text-blue-300 font-medium' : 'text-slate-400'}`}>
                        {row.hazardRadius_m.toFixed(0)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Export buttons */}
      <div className="flex gap-3 flex-wrap print:hidden">
        <button
          onClick={handleExportResults}
          className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-colors"
        >
          Export Results JSON
        </button>
        {r.trajectories && Object.keys(r.trajectories).length > 0 && (
          <button
            onClick={handleExportCsv}
            className="text-xs px-3 py-1.5 rounded border border-slate-600 hover:border-slate-400 text-slate-300 hover:text-white transition-colors"
          >
            Export Trajectory CSV
          </button>
        )}
        <button
          onClick={() => onPrint ? onPrint() : window.print()}
          className="text-xs px-3 py-1.5 rounded border border-blue-600 hover:border-blue-400 text-blue-400 hover:text-blue-200 transition-colors"
        >
          Print / Save as PDF
        </button>
      </div>

      {/* Trajectory plot */}
      {traces.length > 0 && (
        <div className="rounded-xl border border-slate-700 overflow-hidden print:break-inside-avoid">
          <div className="px-4 py-3 border-b border-slate-700 bg-slate-800/60 flex justify-between items-center">
            <div>
              <p className="text-sm font-medium text-slate-200">Ballistic Trajectory Sweep</p>
              <p className="text-xs text-slate-400 mt-0.5">
                {r.totalImpulse_Ns > 0
                  ? <>Launch angles 0&ndash;20&deg; &middot; No recovery &middot; Blue = worst-case ({r.optimalAngle_deg}&deg;) &middot; Red = hazard radius</>
                  : <>Descent from {r.maxApogee_ft.toFixed(0)} ft &middot; Sweep = launch angles 0&ndash;20&deg; &middot; 20 MPH wind &middot; Blue = worst-case (20&deg;) &middot; Red = hazard radius</>}
              </p>
            </div>
            <button
              onClick={() => setShowPlot(v => !v)}
              className="text-xs text-slate-400 hover:text-slate-200 px-2 py-1 rounded border border-slate-600 hover:border-slate-400 transition-colors print:hidden"
            >
              {showPlot ? 'Hide' : 'Show'}
            </button>
          </div>
          <div className={showPlot ? '' : 'hidden print:block'}>
            <Plot
              data={traces as never[]}
              layout={layout}
              config={{ displayModeBar: false, responsive: true }}
              style={{ width: '100%', height: '380px' }}
              onError={(err: unknown) => console.warn('Plotly error:', err)}
            />
          </div>
        </div>
      )}

      {/* Methodology note */}
      <div className="rounded-lg bg-slate-800/40 border border-slate-700 px-4 py-3 text-xs text-slate-400 space-y-1">
        <p className="font-medium text-slate-300">Methodology</p>
        <p>3-DOF point-mass model (same as TAOS). Assumes nose-forward ballistic descent (conservative — lower drag than tumbling = longer range). CD estimated from body fineness ratio. Launch angle swept 0&ndash;20&deg;, max wind 20 MPH. 1976 US Standard Atmosphere anchored to site elevation.</p>
      </div>
    </div>
  );
}

function ResultCard({
  label, primary, secondary, accent = false,
}: {
  label: string;
  primary: string;
  secondary: string;
  accent?: boolean;
}) {
  return (
    <div className={`rounded-xl border px-5 py-4 ${
      accent ? 'border-blue-600 bg-blue-600/10' : 'border-slate-700 bg-slate-800/60'
    }`}>
      <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">{label}</p>
      <p className={`text-2xl font-bold tabular-nums ${accent ? 'text-blue-300' : 'text-white'}`}>{primary}</p>
      <p className="text-sm text-slate-400 mt-0.5">{secondary}</p>
    </div>
  );
}
