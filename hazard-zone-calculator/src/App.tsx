import { useState, useEffect } from 'react';
import { TierSelector } from './components/TierSelector';
import { Tier1Form } from './components/Tier1Form';
import { Tier2Form } from './components/Tier2Form';
import { Results } from './components/Results';
import { ErrorBoundary } from './components/ErrorBoundary';
import { PrintView } from './components/PrintView';
import { buildMapSnapshot } from './utils/mapSnapshot';
import type { HazardZoneResult, InputTier, PrintInputSummary } from './types';

export default function App() {
  const [tier, setTier] = useState<InputTier>('tier1');
  const [result, setResult] = useState<HazardZoneResult | null>(null);
  const [computing, setComputing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [debugLog, setDebugLog] = useState<string>('');
  const [launchCoords, setLaunchCoords] = useState<{ lat: number; lon: number } | null>(null);
  const [windBearing, setWindBearing] = useState<number | null>(null);
  const [inputSummary, setInputSummary] = useState<PrintInputSummary | null>(null);
  const [mapSnapshot, setMapSnapshot] = useState<string | null>(null);
  const [printPending, setPrintPending] = useState(false);

  const handleResult = (r: HazardZoneResult) => {
    // Build a plain-text debug dump before trying to render
    const log = [
      '=== COMPUTATION RESULT ===',
      `hazardRadius_m:        ${r.hazardRadius_m}`,
      `hazardRadius_ft:       ${r.hazardRadius_ft}`,
      `optimalAngle_deg:      ${r.optimalAngle_deg}`,
      `maxApogee_m:           ${r.maxApogee_m}`,
      `maxApogee_ft:          ${r.maxApogee_ft}`,
      `motorClass:            ${r.motorClass}`,
      `totalImpulse_Ns:       ${r.totalImpulse_Ns}`,
      `quarterAltRule_m:      ${r.quarterAltitudeRule_m}`,
      `quarterConservative:   ${r.quarterRuleConservative}`,
      `warnings:              ${JSON.stringify(r.warnings)}`,
      `trajectories keys:     ${r.trajectories ? Object.keys(r.trajectories).join(', ') : 'none'}`,
      '',
      ...(r.trajectories
        ? Object.entries(r.trajectories).map(([angle, pts]) => {
            const last = pts[pts.length - 1];
            const apogee = Math.max(...pts.map(p => p.z));
            return `  angle ${angle}°: ${pts.length} pts, apogee=${apogee.toFixed(0)}m, impact x=${last?.x.toFixed(0)}m z=${last?.z.toFixed(1)}m`;
          })
        : ['  (no trajectories stored)']),
      ...(r.stageImpacts ? [
        '',
        `stageImpacts (${r.stageImpacts.length}):`,
        ...r.stageImpacts.map(si =>
          `  ${si.label}: ${si.range_ft.toFixed(0)} ft  (${si.range_m.toFixed(0)} m)`
        ),
      ] : []),
    ].join('\n');

    setDebugLog(log);
    setResult(r);
    setError(null);
    setComputing(false);
  };

  const handleError = (msg: string) => {
    setDebugLog('=== ERROR ===\n' + msg);
    setError(msg);
    setComputing(false);
  };

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

  return (
    <>
    <div className="min-h-screen bg-slate-900 text-slate-100 print:hidden">
      <header className="border-b border-slate-700 bg-slate-800/60 backdrop-blur">
        <div className="max-w-4xl mx-auto px-6 py-4">
          <div className="flex items-baseline gap-3">
            <h1 className="text-xl font-bold text-white tracking-tight">
              FAA Rocket Hazard Zone Calculator
            </h1>
            <span className="text-xs text-slate-400 font-mono">v1.0</span>
          </div>
          <p className="text-sm text-slate-400 mt-0.5">
            3-DOF ballistic trajectory &middot; NAR/Tripoli safety envelope &middot; 1976 US Standard Atmosphere
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8 space-y-8">
        <TierSelector selected={tier} onChange={t => { setTier(t); setResult(null); setError(null); setDebugLog(''); }} />

        <div className="bg-slate-800 rounded-xl border border-slate-700 p-6">
          {tier === 'tier1' && (
            <Tier1Form
              onComputing={() => { setComputing(true); setError(null); setDebugLog('Computing...'); }}
              onResult={handleResult}
              onError={handleError}
              onCoordsChange={(lat, lon) => setLaunchCoords({ lat, lon })}
              onWindBearingChange={(b) => setWindBearing(b)}
              onInputChange={setInputSummary}
            />
          )}
          {(tier === 'tier2' || tier === 'tier3') && (
            <Tier2Form
              tier={tier}
              onComputing={() => { setComputing(true); setError(null); setDebugLog('Computing...'); }}
              onResult={handleResult}
              onError={handleError}
              onCoordsChange={(lat, lon) => setLaunchCoords({ lat, lon })}
              onWindBearingChange={(b) => setWindBearing(b)}
              onInputChange={setInputSummary}
            />
          )}
        </div>

        {computing && (
          <div className="flex items-center gap-3 text-slate-300">
            <svg className="animate-spin h-5 w-5 text-blue-400" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z" />
            </svg>
            <span className="text-sm">Computing trajectory sweep&hellip;</span>
          </div>
        )}

        {error && (
          <div className="bg-red-900/40 border border-red-700 rounded-lg px-4 py-3 text-sm text-red-300">
            {error}
          </div>
        )}

        {/* Debug log — always visible when there's output */}
        {debugLog && (
          <div className="rounded-xl border border-slate-600 bg-slate-800/60 overflow-hidden print:hidden">
            <div className="px-4 py-2 border-b border-slate-600 flex justify-between items-center">
              <p className="text-xs font-medium text-slate-300 uppercase tracking-widest">Debug Log</p>
              <button onClick={() => setDebugLog('')} className="text-xs text-slate-500 hover:text-slate-300">clear</button>
            </div>
            <pre className="px-4 py-3 text-xs text-slate-300 overflow-x-auto whitespace-pre-wrap font-mono leading-relaxed">
              {debugLog}
            </pre>
          </div>
        )}

        {/* Results — wrapped in error boundary so a render error shows the stack, not a blank screen */}
        {result && !computing && (
          <ErrorBoundary>
            <Results result={result} launchCoords={launchCoords} windBearing={windBearing} onPrint={handlePrint} />
          </ErrorBoundary>
        )}
        <p className="text-xs text-slate-500 text-center pb-6">
          Hazard zone = worst-case ballistic impact radius assuming total recovery failure,
          20&deg; max launch angle, 20 MPH max wind. Prepared in support of FAA AST amateur rocket hazard zone analysis.
        </p>
      </main>
    </div>
    {result && (
      <PrintView
        result={result}
        launchCoords={launchCoords}
        windBearing={windBearing}
        inputSummary={inputSummary}
        mapSnapshotUrl={mapSnapshot}
      />
    )}
    </>
  );
}
