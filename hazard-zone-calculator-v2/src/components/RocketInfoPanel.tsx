/**
 * RocketInfoPanel — shows all parsed geometry, computed Barrowman aerodynamics,
 * OpenRocket stored simulation results, and aero charts for a loaded .ork file.
 */
import PlotlyModule from 'react-plotly.js';
const Plot = (PlotlyModule as any).default ?? PlotlyModule;

import { useMemo } from 'react';
import type { OpenRocketData } from '../types';
import { computeCNAlpha, computeCPFromNose } from '../simulation/barrowman';
import { cdMachCorrection, cdFromFineness } from '../simulation/aerodynamics';

const IN_TO_M = 0.0254;
const M_TO_IN = 1 / IN_TO_M;
const M_TO_FT = 3.28084;
const MS_TO_FPS = 3.28084;
const MS2_TO_G = 1 / 9.80665;

interface Props {
  data: OpenRocketData;
}

// ── Stability diagram (SVG rocket profile) ───────────────────────────────────

function StabilityDiagram({
  length_m, noselen_m, diameter_m, finRoot_m, finSpan_m, finTip_m, CG_m, CP_m,
}: {
  length_m: number; noselen_m: number; diameter_m: number;
  finRoot_m: number; finSpan_m: number; finTip_m: number;
  CG_m: number; CP_m: number;
}) {
  const W = 340; // SVG width px
  const bodyH = 28; // body tube height in SVG px
  const finH = bodyH * 0.6; // fin extension below body
  const pad = 16; // horizontal padding
  const scale = (W - 2 * pad) / length_m; // px per meter

  const cx = (x_m: number) => pad + x_m * scale;
  const bodyY = 38; // top of body tube
  const bodyCY = bodyY + bodyH / 2;
  const totalH = bodyY + bodyH + finH + 24 + 20; // extra space for labels

  // Nose cone as a polygon (triangle approximation)
  const nosePoints = [
    `${cx(0)},${bodyCY}`,
    `${cx(noselen_m)},${bodyY}`,
    `${cx(noselen_m)},${bodyY + bodyH}`,
  ].join(' ');

  // Body tube
  const bodyX = cx(noselen_m);
  const bodyW = cx(length_m) - bodyX;

  // Fin trapezoid — trailing edge at body end
  const finLeadX = length_m - finRoot_m;
  const finTipOffset = finRoot_m - finTip_m; // how far in from fin LE the tip is

  const finPts = [
    `${cx(finLeadX)},${bodyY + bodyH}`,                        // root LE
    `${cx(finLeadX + finTipOffset / 2)},${bodyY + bodyH + finH}`,  // tip LE (swept)
    `${cx(length_m - finTipOffset / 2)},${bodyY + bodyH + finH}`,  // tip TE
    `${cx(length_m)},${bodyY + bodyH}`,                        // root TE
  ].join(' ');

  const cgX  = cx(CG_m);
  const cpX  = cx(CP_m);
  const calibers = (CP_m - CG_m) / diameter_m;
  const stable = calibers >= 1.0;

  return (
    <div className="mt-2">
      <svg width={W} height={totalH} className="overflow-visible">
        {/* Body tube */}
        <rect x={bodyX} y={bodyY} width={bodyW} height={bodyH}
          fill="#334155" stroke="#94a3b8" strokeWidth="1" />

        {/* Nose cone */}
        <polygon points={nosePoints} fill="#334155" stroke="#94a3b8" strokeWidth="1" />

        {/* Fins */}
        {finRoot_m > 0 && finSpan_m > 0 && (
          <polygon points={finPts} fill="#1e3a5f" stroke="#60a5fa" strokeWidth="1" />
        )}

        {/* CG marker — circle with dot */}
        <circle cx={cgX} cy={bodyCY} r={9} fill="#fbbf24" stroke="#f59e0b" strokeWidth="1.5" />
        <circle cx={cgX} cy={bodyCY} r={2.5} fill="#78350f" />
        <text x={cgX} y={bodyY - 6} textAnchor="middle" fontSize="9" fill="#fbbf24" fontFamily="monospace">
          CG {(CG_m * M_TO_IN).toFixed(1)}&quot;
        </text>

        {/* CP marker — circle with crosshair */}
        <circle cx={cpX} cy={bodyCY} r={9} fill="none" stroke="#f87171" strokeWidth="1.5" />
        <line x1={cpX - 8} y1={bodyCY} x2={cpX + 8} y2={bodyCY} stroke="#f87171" strokeWidth="1.5" />
        <line x1={cpX} y1={bodyCY - 8} x2={cpX} y2={bodyCY + 8} stroke="#f87171" strokeWidth="1.5" />
        <text x={cpX} y={bodyY + bodyH + finH + 14} textAnchor="middle" fontSize="9" fill="#f87171" fontFamily="monospace">
          CP {(CP_m * M_TO_IN).toFixed(1)}&quot;
        </text>

        {/* Stability margin label */}
        <text x={W / 2} y={totalH - 4} textAnchor="middle" fontSize="9"
          fill={stable ? '#4ade80' : '#f87171'} fontFamily="monospace">
          SM = {calibers.toFixed(2)} cal {stable ? '✓ stable' : '⚠ unstable'}
        </text>
      </svg>
    </div>
  );
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RocketInfoPanel({ data }: Props) {
  const d_m   = data.bodyDiameter_in * IN_TO_M;
  const L_m   = data.bodyLength_in   * IN_TO_M;
  const noseL_m  = data.noseLength_in   * IN_TO_M;
  const finRoot_m  = data.finRootChord_in * IN_TO_M;
  const finTip_m   = data.finTipChord_in  * IN_TO_M;
  const finSpan_m  = data.finSpan_in      * IN_TO_M;
  const finSweep_m = (data.finSweep_in ?? 0) * IN_TO_M;
  const numFins    = data.numFins ?? 3;

  const baro = useMemo(() => {
    const inputs = {
      bodyDiameter_m: d_m, noseLength_m: noseL_m, noseConeType: data.noseConeType,
      finRootChord_m: finRoot_m, finTipChord_m: finTip_m, finSpan_m, numFins,
      finSweep_m,
    };
    const CNalpha = computeCNAlpha(inputs);
    const CP_m    = computeCPFromNose({ ...inputs, bodyLength_m: L_m });
    const CG_m    = data.cgFromNose_in != null
      ? data.cgFromNose_in * IN_TO_M
      : L_m * 0.55;
    const SM_cal  = d_m > 0 ? (CP_m - CG_m) / d_m : 0;
    const fineness = d_m > 0 ? L_m / d_m : 10;
    const cdBase  = cdFromFineness(fineness);
    return { CNalpha, CP_m, CG_m, SM_cal, cdBase };
  }, [d_m, L_m, noseL_m, finRoot_m, finTip_m, finSpan_m, finSweep_m, numFins, data]);

  // CD vs Mach curve
  const machVals = Array.from({ length: 41 }, (_, i) => i * 0.05);
  const cdVals   = machVals.map(m => cdMachCorrection(baro.cdBase, m));

  // CN vs AoA curve (linear Barrowman, clamped at 14°)
  const aoaDeg = Array.from({ length: 29 }, (_, i) => i * 0.5);
  const cnVals  = aoaDeg.map(deg => {
    const alpha = Math.min(deg, 14) * Math.PI / 180;
    return baro.CNalpha * Math.sin(alpha);
  });

  const plotLayout = (title: string, xLabel: string, yLabel: string) => ({
    title: { text: title, font: { size: 11, color: '#cbd5e1' } },
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: '#0f172a',
    font: { color: '#94a3b8', size: 10 },
    margin: { l: 44, r: 8, t: 28, b: 36 },
    xaxis: { title: xLabel, gridcolor: '#1e293b', zerolinecolor: '#334155' },
    yaxis: { title: yLabel, gridcolor: '#1e293b', zerolinecolor: '#334155' },
    showlegend: false,
  });

  return (
    <details className="mt-3 border border-gray-700 rounded-lg overflow-hidden" open>
      <summary className="px-4 py-2 bg-gray-800/60 text-xs font-medium cursor-pointer select-none hover:bg-gray-800 text-gray-300">
        Rocket Analysis
      </summary>
      <div className="p-3 text-xs text-gray-400 space-y-4">

        {/* ── Geometry ──────────────────────────────────────────────── */}
        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Geometry</h3>
          <table className="w-full">
            <tbody className="divide-y divide-gray-800">
              <tr><td className="py-0.5 text-gray-400">Diameter</td>
                  <td className="text-right text-gray-200">{data.bodyDiameter_in.toFixed(3)} in&nbsp;<span className="text-gray-500">({(d_m * 100).toFixed(1)} cm)</span></td></tr>
              <tr><td className="py-0.5 text-gray-400">Length</td>
                  <td className="text-right text-gray-200">{data.bodyLength_in.toFixed(1)} in&nbsp;<span className="text-gray-500">({L_m.toFixed(2)} m)</span></td></tr>
              <tr><td className="py-0.5 text-gray-400">Fineness ratio (L/D)</td>
                  <td className="text-right text-gray-200">{d_m > 0 ? (L_m / d_m).toFixed(1) : '—'}</td></tr>
              <tr><td className="py-0.5 text-gray-400">Nose cone</td>
                  <td className="text-right text-gray-200">{data.noseConeType} · {data.noseLength_in.toFixed(2)} in</td></tr>
              <tr><td className="py-0.5 text-gray-400">Fin root chord</td>
                  <td className="text-right text-gray-200">{data.finRootChord_in.toFixed(2)} in</td></tr>
              <tr><td className="py-0.5 text-gray-400">Fin tip chord</td>
                  <td className="text-right text-gray-200">{data.finTipChord_in.toFixed(2)} in</td></tr>
              <tr><td className="py-0.5 text-gray-400">Fin span</td>
                  <td className="text-right text-gray-200">{data.finSpan_in.toFixed(2)} in</td></tr>
              <tr><td className="py-0.5 text-gray-400">Fin sweep</td>
                  <td className="text-right text-gray-200">{data.finSweep_in != null ? `${data.finSweep_in.toFixed(2)} in` : '—'}</td></tr>
              <tr><td className="py-0.5 text-gray-400">Number of fins</td>
                  <td className="text-right text-gray-200">{numFins}</td></tr>
              {data.cgFromNose_in != null && (
                <tr><td className="py-0.5 text-gray-400">CG from nose (file)</td>
                    <td className="text-right text-gray-200">{data.cgFromNose_in.toFixed(2)} in&nbsp;<span className="text-gray-500">({(data.cgFromNose_in * IN_TO_M).toFixed(3)} m)</span></td></tr>
              )}
              {data.motorDesignation && (
                <tr><td className="py-0.5 text-gray-400">Motor (default config)</td>
                    <td className="text-right text-gray-200">{data.motorManufacturer ? `${data.motorManufacturer} ` : ''}{data.motorDesignation}</td></tr>
              )}
            </tbody>
          </table>
        </section>

        {/* ── Computed Barrowman aerodynamics ───────────────────────── */}
        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Barrowman Aerodynamics</h3>

          <StabilityDiagram
            length_m={L_m} noselen_m={noseL_m} diameter_m={d_m}
            finRoot_m={finRoot_m} finSpan_m={finSpan_m} finTip_m={finTip_m}
            CG_m={baro.CG_m} CP_m={baro.CP_m}
          />

          <table className="w-full mt-2">
            <tbody className="divide-y divide-gray-800">
              <tr><td className="py-0.5 text-gray-400">CN<sub>α</sub> (normal force slope)</td>
                  <td className="text-right text-gray-200">{baro.CNalpha.toFixed(2)} /rad</td></tr>
              <tr><td className="py-0.5 text-gray-400">CP from nose</td>
                  <td className="text-right text-gray-200">
                    {(baro.CP_m * M_TO_IN).toFixed(2)} in&nbsp;
                    <span className="text-gray-500">({(baro.CP_m / d_m).toFixed(2)} cal)</span>
                  </td></tr>
              <tr><td className="py-0.5 text-gray-400">
                    CG from nose {data.cgFromNose_in == null && <span className="text-yellow-600">(est)</span>}
                  </td>
                  <td className="text-right text-gray-200">
                    {(baro.CG_m * M_TO_IN).toFixed(2)} in&nbsp;
                    <span className="text-gray-500">({(baro.CG_m / d_m).toFixed(2)} cal)</span>
                  </td></tr>
              <tr>
                <td className="py-0.5 text-gray-400">Static stability margin</td>
                <td className={`text-right font-medium ${baro.SM_cal >= 1 ? 'text-green-400' : baro.SM_cal > 0 ? 'text-yellow-400' : 'text-red-400'}`}>
                  {baro.SM_cal.toFixed(2)} cal
                  {baro.SM_cal < 1 && baro.SM_cal > 0 && <span className="text-yellow-500 ml-1">⚠ marginal (&lt;1 cal)</span>}
                  {baro.SM_cal <= 0 && <span className="text-red-500 ml-1">⚠ unstable</span>}
                </td>
              </tr>
              <tr><td className="py-0.5 text-gray-400">Subsonic C<sub>D</sub> (fineness model)</td>
                  <td className="text-right text-gray-200">{baro.cdBase.toFixed(3)}</td></tr>
            </tbody>
          </table>
        </section>

        {/* ── OpenRocket stored simulation results ──────────────────── */}
        {data.maxApogee_m != null && (
          <section>
            <h3 className="text-gray-200 font-semibold mb-1">
              OpenRocket Prediction
              {data.motorDesignation && <span className="text-gray-500 font-normal ml-1">({data.motorDesignation})</span>}
            </h3>
            <table className="w-full">
              <tbody className="divide-y divide-gray-800">
                {data.maxApogee_m != null && (
                  <tr><td className="py-0.5 text-gray-400">Max altitude (apogee)</td>
                      <td className="text-right text-gray-200">
                        {(data.maxApogee_m * M_TO_FT).toFixed(0)} ft&nbsp;
                        <span className="text-gray-500">({data.maxApogee_m.toFixed(1)} m)</span>
                      </td></tr>
                )}
                {data.maxVelocity_ms != null && (
                  <tr><td className="py-0.5 text-gray-400">Max velocity</td>
                      <td className="text-right text-gray-200">
                        {(data.maxVelocity_ms * MS_TO_FPS).toFixed(0)} ft/s&nbsp;
                        <span className="text-gray-500">({data.maxVelocity_ms.toFixed(1)} m/s, M {data.maxMach?.toFixed(3) ?? '—'})</span>
                      </td></tr>
                )}
                {data.maxAcceleration_ms2 != null && (
                  <tr><td className="py-0.5 text-gray-400">Max acceleration</td>
                      <td className="text-right text-gray-200">
                        {(data.maxAcceleration_ms2 * MS2_TO_G).toFixed(1)} g&nbsp;
                        <span className="text-gray-500">({data.maxAcceleration_ms2.toFixed(0)} m/s²)</span>
                      </td></tr>
                )}
                {data.timeToApogee_s != null && (
                  <tr><td className="py-0.5 text-gray-400">Time to apogee</td>
                      <td className="text-right text-gray-200">{data.timeToApogee_s.toFixed(2)} s</td></tr>
                )}
                {data.flightTime_s != null && (
                  <tr><td className="py-0.5 text-gray-400">Total flight time</td>
                      <td className="text-right text-gray-200">{data.flightTime_s.toFixed(1)} s</td></tr>
                )}
                {data.launchRodVelocity_ms != null && (
                  <tr><td className="py-0.5 text-gray-400">Launch rod exit velocity</td>
                      <td className="text-right text-gray-200">
                        {(data.launchRodVelocity_ms * MS_TO_FPS).toFixed(0)} ft/s&nbsp;
                        <span className="text-gray-500">({data.launchRodVelocity_ms.toFixed(1)} m/s)</span>
                      </td></tr>
                )}
                {data.groundHitVelocity_ms != null && (
                  <tr><td className="py-0.5 text-gray-400">Ground hit velocity</td>
                      <td className="text-right text-gray-200">
                        {(data.groundHitVelocity_ms * MS_TO_FPS).toFixed(0)} ft/s&nbsp;
                        <span className="text-gray-500">({data.groundHitVelocity_ms.toFixed(1)} m/s)</span>
                      </td></tr>
                )}
              </tbody>
            </table>
          </section>
        )}

        {/* ── Aero plots ────────────────────────────────────────────── */}
        <section>
          <h3 className="text-gray-200 font-semibold mb-2">Aero Charts</h3>

          {/* CD vs Mach */}
          <Plot
            data={[{
              x: machVals, y: cdVals, type: 'scatter', mode: 'lines',
              line: { color: '#60a5fa', width: 2 },
              name: 'CD',
            }]}
            layout={{
              ...plotLayout('Drag Coefficient vs Mach', 'Mach', 'CD'),
              height: 200,
              shapes: [{ type: 'line' as const, x0: 0.8, x1: 0.8, y0: 0, y1: 1,
                yref: 'paper' as const, line: { color: '#f59e0b', dash: 'dot', width: 1 } }],
              annotations: [{ x: 0.81, y: 0.95, xref: 'x' as const, yref: 'paper' as const,
                text: 'transonic', showarrow: false, font: { size: 8, color: '#f59e0b' }, xanchor: 'left' as const }],
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
            useResizeHandler
          />

          {/* CN vs AoA */}
          <Plot
            data={[{
              x: aoaDeg, y: cnVals, type: 'scatter', mode: 'lines',
              line: { color: '#34d399', width: 2 },
              name: 'CN',
            }]}
            layout={{
              ...plotLayout('Normal Force Coefficient vs AoA', 'AoA (°)', 'CN'),
              height: 200,
              shapes: [{ type: 'line' as const, x0: 14, x1: 14, y0: 0, y1: 1,
                yref: 'paper' as const, line: { color: '#f87171', dash: 'dot', width: 1 } }],
              annotations: [{ x: 14.2, y: 0.95, xref: 'x' as const, yref: 'paper' as const,
                text: 'model limit', showarrow: false, font: { size: 8, color: '#f87171' }, xanchor: 'left' as const }],
            }}
            config={{ displayModeBar: false, responsive: true }}
            style={{ width: '100%' }}
            useResizeHandler
          />
        </section>

      </div>
    </details>
  );
}
