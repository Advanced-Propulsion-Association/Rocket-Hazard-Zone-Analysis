/**
 * AssumptionsPanel — shows every model, assumption, and default value
 * used in the 6-DOF simulation so the user understands what drives the output.
 */
export function AssumptionsPanel() {
  return (
    <details className="mt-3 border border-gray-700 rounded-lg overflow-hidden">
      <summary className="px-4 py-2 bg-gray-800/60 text-xs font-medium cursor-pointer select-none hover:bg-gray-800 text-gray-300">
        Models & Assumptions
      </summary>
      <div className="p-4 text-xs text-gray-400 space-y-4">

        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Aerodynamics</h3>
          <ul className="space-y-1 list-disc list-inside">
            <li><span className="text-gray-300">Normal-force slope CN<sub>α</sub></span> — Barrowman (1967) linearised equations for nose + body + fins. Valid for α &lt; ~15°; clamped to 14° in simulation.</li>
            <li><span className="text-gray-300">Centre of Pressure (CP)</span> — Barrowman method with fin sweep correction. Constant throughout flight (no dynamic shift model).</li>
            <li><span className="text-gray-300">Drag coefficient C<sub>D</sub></span> — Fixed 0.40 with Prandtl–Glauert Mach correction above Mach 0.6. No base-drag, skin-friction, or transonic wave-drag model.</li>
            <li><span className="text-gray-300">Pitch/yaw damping C<sub>mq</sub>, C<sub>nr</sub></span> — Derived from fin geometry: −2 CN<sub>α,fins</sub> (l<sub>fin</sub>/d)². Constant (no dynamic correction for changing CG during burn).</li>
            <li><span className="text-gray-300">Roll damping C<sub>lp</sub></span> — Fixed −0.5 (typical unspun hobby rocket).</li>
            <li>Fin interference factor from Barrowman; no body–fin interaction for non-circular cross sections.</li>
          </ul>
        </section>

        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Atmosphere</h3>
          <ul className="space-y-1 list-disc list-inside">
            <li><span className="text-gray-300">Model</span> — International Standard Atmosphere (ISA) with surface-temperature offset. Density, pressure, and speed-of-sound vary with altitude via the ISA lapse rate (6.5 K/km troposphere).</li>
            <li><span className="text-gray-300">Wind profile</span> — Power-law boundary-layer model: V(z) = V<sub>ref</sub> · (z/z<sub>ref</sub>)<sup>1/7</sup>, referenced to 10 m AGL. Wind direction is randomised uniformly 0–360° in Monte Carlo.</li>
            <li>No turbulence or gusts modelled; no vertical wind component.</li>
          </ul>
        </section>

        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Equations of Motion</h3>
          <ul className="space-y-1 list-disc list-inside">
            <li><span className="text-gray-300">6-DOF integration</span> — Fixed-step RK4, dt = 10 ms (burn) / 50 ms (coast).</li>
            <li><span className="text-gray-300">Attitude representation</span> — ZYX Euler angles (φ, θ, ψ). Gimbal-lock guard applied near θ = ±90°.</li>
            <li><span className="text-gray-300">Moments of inertia</span> — Estimated as a thin cylindrical shell: I<sub>xx</sub> = ½mr², I<sub>yy</sub> = m(3r² + L²)/12. Constant (no propellant burn-off shift).</li>
            <li><span className="text-gray-300">Mass flow</span> — Constant linear propellant depletion over burn time.</li>
            <li><span className="text-gray-300">CG</span> — Read from .ork file if present; otherwise estimated at 55% of body length from nose. Does not shift during burn.</li>
          </ul>
        </section>

        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Monte Carlo Dispersions</h3>
          <table className="w-full">
            <thead>
              <tr className="text-gray-300 border-b border-gray-700">
                <th className="text-left pb-1">Parameter</th>
                <th className="text-left pb-1">Distribution</th>
                <th className="text-left pb-1">Value</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-800">
              <tr><td className="py-0.5">Wind speed</td><td>Uniform</td><td>±20% of nominal</td></tr>
              <tr><td className="py-0.5">Wind direction</td><td>Uniform</td><td>0–360°</td></tr>
              <tr><td className="py-0.5">Launch angle</td><td>Uniform</td><td>±2° from nominal</td></tr>
              <tr><td className="py-0.5">Motor impulse</td><td>Uniform</td><td>±3% of total impulse</td></tr>
              <tr><td className="py-0.5">Tip-off pitch rate</td><td>Uniform</td><td>±1 rad/s</td></tr>
            </tbody>
          </table>
        </section>

        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Hazard Radius Definition</h3>
          <ul className="space-y-1 list-disc list-inside">
            <li><span className="text-gray-300">Headline (P99)</span> — 99th-percentile of all landing distances from the launch pad.</li>
            <li><span className="text-gray-300">Max</span> — Furthest single landing across all runs; shown for reference only (high variance).</li>
            <li>Radius represents the rocket body only — no parachute drift, fragment, or ballistic model.</li>
            <li>No recovery-system (parachute) deployment modelled; the rocket is treated as a rigid body throughout descent.</li>
          </ul>
        </section>

        <section>
          <h3 className="text-gray-200 font-semibold mb-1">Airframe Mass Heuristic</h3>
          <p>When no mass is provided by the .ork file, dry airframe mass is estimated as:</p>
          <p className="mt-1 font-mono text-gray-300 bg-gray-900 px-2 py-1 rounded">
            m<sub>dry</sub> = body_length_in × 0.015 lb/in + 0.66 lb
          </p>
          <p className="mt-1">This is a rough approximation for fiberglass/cardboard airframes. Provide CG from the .ork file for a more accurate simulation.</p>
        </section>

      </div>
    </details>
  );
}
