import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { OrkUpload } from './components/OrkUpload';
import { ManualInputForm } from './components/ManualInputForm';
import { MotorPicker } from './components/MotorPicker';
import { RunControls } from './components/RunControls';
import { Results6dof } from './components/Results6dof';
import { SiteConditions, DEFAULT_SITE_CONDITIONS } from './components/SiteConditions';
import type { SiteConditionsValue } from './components/SiteConditions';
import { AssumptionsPanel } from './components/AssumptionsPanel';
import { RocketInfoPanel } from './components/RocketInfoPanel';
import { SimDiagnosticsPanel } from './components/SimDiagnosticsPanel';
import { computeCNAlpha, computeCPFromNose } from './simulation/barrowman';
import { lookupMotor } from './motors/thrustcurve';
import { estimateMOI, estimateCmq, estimateClp } from './simulation/moi';
import type {
  OpenRocketData, Config6DOF, MonteCarloResult,
  WorkerProgress, WorkerResult,
} from './types';

const IN_TO_M = 0.0254;

function buildConfig6DOF(
  orkData: OpenRocketData,
  totalMass_kg: number,
  motor: Config6DOF['motor'],
  site: SiteConditionsValue,
): Config6DOF {
  const d_m = orkData.bodyDiameter_in * IN_TO_M;
  const L_m = orkData.bodyLength_in * IN_TO_M;
  const noseL_m = orkData.noseLength_in * IN_TO_M;
  const finRoot_m = orkData.finRootChord_in * IN_TO_M;
  const finTip_m = orkData.finTipChord_in * IN_TO_M;
  const finSpan_m = orkData.finSpan_in * IN_TO_M;
  const finSweep_m = (orkData.finSweep_in ?? 0) * IN_TO_M;
  const finSweepAngle_rad = finSpan_m > 0 ? Math.atan(finSweep_m / finSpan_m) : 0;
  const numFins = orkData.numFins ?? 3;

  const barrowmanInputs = {
    bodyDiameter_m: d_m,
    noseLength_m: noseL_m,
    noseConeType: orkData.noseConeType,
    finRootChord_m: finRoot_m,
    finTipChord_m: finTip_m,
    finSpan_m,
    numFins,
    finSweep_m,
  };

  const CNalpha = computeCNAlpha(barrowmanInputs);
  const CP_m = computeCPFromNose({ ...barrowmanInputs, bodyLength_m: L_m });
  const CG_m = orkData.cgFromNose_in != null
    ? orkData.cgFromNose_in * IN_TO_M
    : L_m * 0.55;

  const moi = estimateMOI({ totalMass_kg, bodyDiameter_m: d_m, totalLength_m: L_m });
  const CNalpha_fins = Math.max(0, CNalpha - 2.0);
  const Cmq = estimateCmq(CNalpha_fins, CP_m, CG_m, d_m);
  const Clp = estimateClp();

  return {
    bodyDiameter_m: d_m,
    bodyLength_m: L_m,
    noseConeLength_m: noseL_m,
    finRootChord_m: finRoot_m,
    finTipChord_m: finTip_m,
    finSpan_m,
    finSweepAngle_rad,
    numFins,
    totalMass_kg,
    motor,
    Ixx_kgm2: moi.Ixx,
    Iyy_kgm2: moi.Iyy,
    CNalpha,
    CP_m,
    CG_m,
    CD: 0.4,
    Cmq,
    Cnr: Cmq,
    Clp,
    thrustCurve: motor.thrustCurve.map(pt => [pt.time, pt.thrust] as [number, number]),
    propellantMass_kg: motor.propellantMassKg,
    launchAltitude_m: site.launchAltitude_m,
    launchAngle_rad: 5 * Math.PI / 180,
    launchAzimuth_deg: 0,
    windSpeed_ms: site.windSpeed_ms,
    windDirection_rad: site.windDirection_deg * Math.PI / 180,
    siteTemp_K: site.siteTemp_K,
    initialRollRate_rads: 0,
  };
}

export default function App() {
  const [orkData, setOrkData] = useState<OpenRocketData | null>(null);
  const [manualData, setManualData] = useState<Partial<OpenRocketData>>({});
  const [motor, setMotor] = useState<Config6DOF['motor'] | null>(null);
  const [site, setSite] = useState<SiteConditionsValue>(DEFAULT_SITE_CONDITIONS);
  const [error, setError] = useState<string | null>(null);
  const [numRuns, setNumRuns] = useState(500);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [result, setResult] = useState<MonteCarloResult | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  // Auto-lookup motor when a new .ork file is loaded (motor was just cleared)
  useEffect(() => {
    if (!orkData?.motorDesignation || motor) return;
    lookupMotor(orkData.motorDesignation, orkData.motorManufacturer)
      .then(m => { if (m) setMotor(m); })
      .catch(() => {}); // silent fail — user can select manually
  }, [orkData, motor]);

  const handleRun = useCallback(() => {
    const data = orkData ?? (manualData as OpenRocketData);
    if (!data?.bodyDiameter_in) {
      setError('Please upload a .ork file or enter geometry manually.');
      return;
    }
    if (!motor) {
      setError('Please select a motor (ThrustCurve.org lookup, .eng file, or boxcar).');
      return;
    }

    setRunning(true);
    setProgress(0);
    setError(null);

    // Airframe dry mass heuristic (kg): proportional to tube surface area (D×L)
    // Calibrated: 0.00275 * D_in * L_in → ~95g for Big Bertha (1.637"×22"), ~43g for simple rocket (0.984"×15.75")
    const airframeMass_kg = data.bodyDiameter_in && data.bodyLength_in
      ? 0.00275 * data.bodyDiameter_in * data.bodyLength_in
      : 0.5;
    const totalMass_kg = airframeMass_kg + motor.totalMassKg;
    const config = buildConfig6DOF(data, totalMass_kg, motor, site);

    workerRef.current?.terminate();
    workerRef.current = new Worker(
      new URL('./workers/montecarlo.worker.ts', import.meta.url),
      { type: 'module' }
    );

    workerRef.current.onmessage = (e: MessageEvent<WorkerProgress | WorkerResult>) => {
      if (e.data.type === 'progress') {
        setProgress(e.data.completed / e.data.total);
      } else if (e.data.type === 'result') {
        setResult(e.data.result);
        setRunning(false);
        setProgress(1);
      }
    };

    workerRef.current.onerror = (e) => {
      setError(`Simulation error: ${e.message}`);
      setRunning(false);
    };

    workerRef.current.postMessage({ type: 'run', config, numRuns });
  }, [orkData, manualData, motor, numRuns, site]);

  const effectiveData = orkData ?? manualData;
  const hasGeometry = !!(effectiveData as OpenRocketData)?.bodyDiameter_in;
  const readyToRun = hasGeometry && !!motor;

  // Live preview of config values that will be passed to the sim
  const previewAirframeMass_kg = useMemo(() => {
    const data = orkData ?? (manualData as OpenRocketData);
    if (!data?.bodyDiameter_in || !data?.bodyLength_in) return null;
    return 0.00275 * data.bodyDiameter_in * data.bodyLength_in;
  }, [orkData, manualData]);

  const previewConfig = useMemo<Config6DOF | null>(() => {
    if (!readyToRun || previewAirframeMass_kg === null || !motor) return null;
    const data = (orkData ?? manualData) as OpenRocketData;
    const totalMass_kg = previewAirframeMass_kg + motor.totalMassKg;
    return buildConfig6DOF(data, totalMass_kg, motor, site);
  }, [readyToRun, previewAirframeMass_kg, motor, orkData, manualData, site]);

  const notReadyHint = !hasGeometry
    ? 'Upload a .ork file or fill in geometry manually'
    : !motor
    ? 'Select a motor above to enable the simulation'
    : null;

  return (
    <div className="min-h-screen bg-gray-950 text-white">
      <header className="bg-gray-900 border-b border-gray-800 px-6 py-3">
        <h1 className="text-lg font-semibold">
          FAA Hazard Zone Calculator{' '}
          <span className="text-blue-400 text-sm font-normal ml-2">v2 — 6-DOF</span>
        </h1>
      </header>

      <div className="flex h-[calc(100vh-52px)]">
        <div className="w-[420px] flex-shrink-0 bg-gray-900 border-r border-gray-800 overflow-y-auto p-5">
          <p className="text-xs text-gray-400 uppercase tracking-wider mb-3">Rocket</p>
          <OrkUpload
            onParsed={data => { setOrkData(data); setMotor(null); setResult(null); setError(null); }}
            onError={setError}
            onClear={() => { setOrkData(null); setMotor(null); setResult(null); setError(null); }}
          />

          {orkData && (
            <RocketInfoPanel data={orkData} />
          )}

          <ManualInputForm values={manualData} onChange={d => setManualData(prev => ({ ...prev, ...d }))} />
          <MotorPicker selectedMotor={motor} onMotorSelected={setMotor} onClear={() => setMotor(null)} />
          <SiteConditions value={site} onChange={setSite} />

          {error && (
            <div className="mt-3 p-3 bg-red-900/30 border border-red-700 rounded text-xs text-red-300">
              {error}
            </div>
          )}

          {notReadyHint && !running && (
            <p className="mt-3 text-xs text-yellow-500">{notReadyHint}</p>
          )}
          <RunControls
            numRuns={numRuns}
            onNumRunsChange={setNumRuns}
            onRun={handleRun}
            running={running}
            progress={progress}
            canRun={readyToRun}
          />
        </div>

        <div className="flex-1 overflow-y-auto p-5">
          {result ? (
            <>
              <Results6dof result={result} />
              {previewConfig && previewAirframeMass_kg !== null && (
                <SimDiagnosticsPanel config={previewConfig} airframeMass_kg={previewAirframeMass_kg} />
              )}
              <AssumptionsPanel />
            </>
          ) : previewConfig && previewAirframeMass_kg !== null ? (
            <div className="max-w-xl">
              <SimDiagnosticsPanel config={previewConfig} airframeMass_kg={previewAirframeMass_kg} />
              <div className="mt-4">
                <AssumptionsPanel />
              </div>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center h-full text-gray-600 gap-6">
              <div className="text-center">
                <p className="text-4xl mb-3">🚀</p>
                <p>Upload a .ork file and run the simulation to see results.</p>
              </div>
              <div className="w-full max-w-xl">
                <AssumptionsPanel />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
