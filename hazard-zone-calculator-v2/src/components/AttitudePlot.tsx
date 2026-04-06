import PlotlyModule from 'react-plotly.js';
const Plot = (PlotlyModule as any).default ?? PlotlyModule;
import type { TrajectoryPoint6DOF } from '../types';

interface Props {
  trajectory: TrajectoryPoint6DOF[];
}

const RAD_TO_DEG = 180 / Math.PI;

export function AttitudePlot({ trajectory }: Props) {
  const t     = trajectory.map(p => p.t);
  const pitch = trajectory.map(p => p.state.theta * RAD_TO_DEG);
  const yaw   = trajectory.map(p => p.state.psi   * RAD_TO_DEG);
  const roll  = trajectory.map(p => p.state.phi   * RAD_TO_DEG);
  const alpha = trajectory.map(p => p.alpha        * RAD_TO_DEG);

  return (
    <Plot
      data={[
        { x: t, y: pitch, name: 'Pitch θ', type: 'scatter', mode: 'lines', line: { color: '#4299e1' } },
        { x: t, y: yaw,   name: 'Yaw ψ',   type: 'scatter', mode: 'lines', line: { color: '#68d391' } },
        { x: t, y: roll,  name: 'Roll φ',  type: 'scatter', mode: 'lines', line: { color: '#fbd38d', dash: 'dot' } },
        { x: t, y: alpha, name: 'AoA α',   type: 'scatter', mode: 'lines', line: { color: '#fc8181', dash: 'dash' } },
      ]}
      layout={{
        paper_bgcolor: 'transparent', plot_bgcolor: '#1a1a2e',
        font: { color: '#e2e8f0', size: 11 },
        margin: { t: 10, r: 10, b: 40, l: 45 },
        xaxis: { title: 'Time (s)', gridcolor: '#2d3748' },
        yaxis: { title: 'Angle (°)', gridcolor: '#2d3748' },
        legend: { bgcolor: 'transparent', font: { size: 10 } },
        shapes: [{
          type: 'rect', xref: 'paper', yref: 'y',
          x0: 0, x1: 1, y0: 15, y1: Math.max(90, ...alpha),
          fillcolor: 'rgba(252,129,129,0.1)', line: { width: 0 },
        }],
      }}
      style={{ width: '100%', height: 240 }}
      config={{ displayModeBar: false }}
    />
  );
}
