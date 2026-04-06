import PlotlyModule from 'react-plotly.js';
const Plot = (PlotlyModule as any).default ?? PlotlyModule;
import type { ScatterPoint } from '../types';

interface Props {
  points: ScatterPoint[];
  hazardRadius_m: number;
}

const M_TO_FT = 3.28084;

export function ScatterPlot({ points, hazardRadius_m }: Props) {
  const circleTheta = Array.from({ length: 361 }, (_, i) => i * Math.PI / 180);
  const circleX = circleTheta.map(t => hazardRadius_m * Math.cos(t));
  const circleY = circleTheta.map(t => hazardRadius_m * Math.sin(t));

  const colors = points.map((_, i) => i);

  return (
    <Plot
      data={[
        {
          x: points.map(p => p.x * M_TO_FT),
          y: points.map(p => p.y * M_TO_FT),
          mode: 'markers',
          type: 'scatter',
          name: 'Landing points',
          marker: { size: 4, color: colors, colorscale: 'Viridis', opacity: 0.7 },
        },
        {
          x: circleX.map(v => v * M_TO_FT),
          y: circleY.map(v => v * M_TO_FT),
          mode: 'lines',
          type: 'scatter',
          name: `Hazard radius (${(hazardRadius_m * M_TO_FT).toFixed(0)} ft)`,
          line: { color: '#fc8181', width: 2 },
        },
        {
          x: [0], y: [0],
          mode: 'markers',
          type: 'scatter',
          name: 'Launch pad',
          marker: { size: 10, color: '#fbd38d', symbol: 'star' },
        },
      ]}
      layout={{
        paper_bgcolor: 'transparent', plot_bgcolor: '#1a1a2e',
        font: { color: '#e2e8f0', size: 11 },
        margin: { t: 10, r: 10, b: 40, l: 55 },
        xaxis: { title: 'Downrange (ft)', gridcolor: '#2d3748', scaleanchor: 'y' },
        yaxis: { title: 'Lateral (ft)', gridcolor: '#2d3748' },
        legend: { bgcolor: 'transparent', font: { size: 10 } },
      }}
      style={{ width: '100%', height: 320 }}
      config={{ displayModeBar: false }}
    />
  );
}
