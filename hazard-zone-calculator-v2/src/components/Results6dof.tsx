import { AttitudePlot } from './AttitudePlot';
import { ScatterPlot } from './ScatterPlot';
import { ComparePanel } from './ComparePanel';
import type { MonteCarloResult } from '../types';

interface Props {
  result: MonteCarloResult;
  hazard3dof_ft?: number;
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <details open className="mb-3 border border-gray-700 rounded-lg overflow-hidden">
      <summary className="px-4 py-2 bg-gray-800/60 text-sm font-medium cursor-pointer select-none hover:bg-gray-800">
        {title}
      </summary>
      <div className="p-4">{children}</div>
    </details>
  );
}

const M_TO_FT = 3.28084;

export function Results6dof({ result, hazard3dof_ft }: Props) {
  const apogee_ft = Math.max(...result.nominalTrajectory.map(p => p.state.z)) * M_TO_FT;

  return (
    <div>
      <Section title={`Hazard Zone — ${result.hazardRadius_ft.toFixed(0)} ft radius`}>
        <div className="grid grid-cols-3 gap-3 text-center">
          <div className="bg-gray-800 rounded p-3">
            <p className="text-2xl font-bold text-green-400">{result.hazardRadius_ft.toFixed(0)}</p>
            <p className="text-xs text-gray-400">ft radius</p>
          </div>
          <div className="bg-gray-800 rounded p-3">
            <p className="text-2xl font-bold text-blue-400">{result.hazardRadius_m.toFixed(0)}</p>
            <p className="text-xs text-gray-400">m radius</p>
          </div>
          <div className="bg-gray-800 rounded p-3">
            <p className="text-2xl font-bold text-gray-300">{result.hazardRadius_p99_m.toFixed(0)}</p>
            <p className="text-xs text-gray-400">m (P99)</p>
          </div>
        </div>
        <p className="text-xs text-gray-500 mt-2">
          Based on {result.scatter.length} Monte Carlo runs. Hazard radius = max landing distance from launch pad.
        </p>
      </Section>

      <Section title="Landing Scatter">
        <ScatterPlot points={result.scatter} hazardRadius_m={result.hazardRadius_m} />
      </Section>

      <Section title="Attitude History (nominal trajectory)">
        <AttitudePlot trajectory={result.nominalTrajectory} />
      </Section>

      <Section title="vs V1 (3-DOF Conservative Estimate)">
        <ComparePanel
          hazard6dof_ft={result.hazardRadius_ft}
          hazard3dof_ft={hazard3dof_ft}
          apogee6dof_ft={apogee_ft}
        />
      </Section>
    </div>
  );
}
