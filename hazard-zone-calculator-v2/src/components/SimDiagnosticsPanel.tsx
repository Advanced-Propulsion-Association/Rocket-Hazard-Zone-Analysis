import type { Config6DOF } from '../types';

interface Props {
  config: Config6DOF;
  airframeMass_kg: number;
}

const M_TO_IN = 39.3701;
const M_TO_FT = 3.28084;
const RAD_TO_DEG = 180 / Math.PI;

function Row({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <tr className="border-b border-gray-800">
      <td className="py-1 pr-3 text-gray-400 text-xs whitespace-nowrap">{label}</td>
      <td className="py-1 pr-3 font-mono text-xs text-white">{value}</td>
      {note && <td className="py-1 text-xs text-gray-500 italic">{note}</td>}
    </tr>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="mb-4">
      <p className="text-xs font-semibold text-blue-400 uppercase tracking-wider mb-1">{title}</p>
      <table className="w-full">
        <tbody>{children}</tbody>
      </table>
    </div>
  );
}

export function SimDiagnosticsPanel({ config, airframeMass_kg }: Props) {
  const stabilityCalibers = config.bodyDiameter_m > 0
    ? (config.CP_m - config.CG_m) / config.bodyDiameter_m
    : 0;

  const burnTime = config.thrustCurve.length > 0
    ? config.thrustCurve[config.thrustCurve.length - 1][0]
    : 0;
  // Trapezoidal integration of thrust curve
  const motorImpulse = config.thrustCurve.reduce((sum, pt, i) => {
    if (i === 0) return sum;
    const [t0, f0] = config.thrustCurve[i - 1];
    const [t1, f1] = pt;
    return sum + 0.5 * (f0 + f1) * (t1 - t0);
  }, 0);
  const avgThrust = burnTime > 0 ? motorImpulse / burnTime : 0;

  const propMassFraction = config.totalMass_kg > 0
    ? (config.propellantMass_kg / config.totalMass_kg * 100).toFixed(1)
    : '—';

  return (
    <div className="mt-4 p-3 bg-gray-900 border border-gray-700 rounded text-xs">
      <p className="text-xs text-yellow-400 uppercase tracking-wider mb-3 font-semibold">
        Sim Diagnostics — Values Passed to 6-DOF
      </p>

      <Section title="Mass Budget">
        <Row label="Airframe (dry) mass" value={`${(airframeMass_kg * 1000).toFixed(1)} g`} note={`= 0.00275 × D × L`} />
        <Row label="Motor total mass" value={`${(config.motor.totalMassKg * 1000).toFixed(1)} g`} />
        <Row label="Propellant mass" value={`${(config.propellantMass_kg * 1000).toFixed(1)} g`} note={`${propMassFraction}% of total`} />
        <Row label="Total launch mass" value={`${(config.totalMass_kg * 1000).toFixed(1)} g  (${config.totalMass_kg.toFixed(3)} kg)`} />
      </Section>

      <Section title="Geometry (passed to sim)">
        <Row label="Body diameter" value={`${(config.bodyDiameter_m * 100).toFixed(2)} cm  (${(config.bodyDiameter_m * M_TO_IN).toFixed(3)}")`} />
        <Row label="Body length" value={`${config.bodyLength_m.toFixed(3)} m  (${(config.bodyLength_m * M_TO_IN).toFixed(2)}")`} />
        <Row label="Nose cone length" value={`${config.noseConeLength_m.toFixed(3)} m`} />
        <Row label="Fin root chord" value={`${(config.finRootChord_m * 100).toFixed(1)} cm`} />
        <Row label="Fin tip chord" value={`${(config.finTipChord_m * 100).toFixed(1)} cm`} />
        <Row label="Fin span" value={`${(config.finSpan_m * 100).toFixed(1)} cm`} />
        <Row label="Fin sweep angle" value={`${(config.finSweepAngle_rad * RAD_TO_DEG).toFixed(1)}°`} />
        <Row label="Num fins" value={`${config.numFins}`} />
      </Section>

      <Section title="Aerodynamics (Barrowman)">
        <Row label="CNα (normal force slope)" value={`${config.CNalpha.toFixed(3)} /rad`} />
        <Row label="CP from nose" value={`${config.CP_m.toFixed(3)} m  (${(config.CP_m * M_TO_IN).toFixed(2)}")`} />
        <Row label="CG from nose" value={`${config.CG_m.toFixed(3)} m  (${(config.CG_m * M_TO_IN).toFixed(2)}")`} />
        <Row
          label="Stability margin"
          value={`${stabilityCalibers.toFixed(2)} cal  (${((config.CP_m - config.CG_m) * 100).toFixed(1)} cm)`}
          note={stabilityCalibers < 1 ? '⚠ Marginal (<1 cal)' : stabilityCalibers > 4 ? '⚠ Over-stable (>4 cal)' : '✓ OK'}
        />
        <Row label="CD (drag coeff)" value={`${config.CD.toFixed(3)}`} />
        <Row label="Cmq (pitch damp)" value={`${config.Cmq.toFixed(4)}`} />
        <Row label="Clp (roll damp)" value={`${config.Clp.toFixed(4)}`} />
        <Row label="Ixx (axial MOI)" value={`${config.Ixx_kgm2.toFixed(5)} kg·m²`} />
        <Row label="Iyy (transverse MOI)" value={`${config.Iyy_kgm2.toFixed(5)} kg·m²`} />
      </Section>

      <Section title="Motor">
        <Row label="Name" value={config.motor.name} />
        <Row label="Total impulse" value={`${motorImpulse.toFixed(1)} N·s`} />
        <Row label="Avg thrust" value={`${avgThrust.toFixed(1)} N`} />
        <Row label="Burn time" value={`${burnTime.toFixed(2)} s`} />
        <Row label="Thrust curve points" value={`${config.thrustCurve.length}`} />
      </Section>

      <Section title="Launch Conditions">
        <Row label="Launch altitude" value={`${config.launchAltitude_m.toFixed(0)} m AGL  (${(config.launchAltitude_m * M_TO_FT).toFixed(0)} ft)`} />
        <Row label="Launch angle (from vert.)" value={`${(config.launchAngle_rad * RAD_TO_DEG).toFixed(1)}°`} />
        <Row label="Wind speed" value={`${config.windSpeed_ms.toFixed(1)} m/s`} />
        <Row label="Wind direction" value={`${(config.windDirection_rad * RAD_TO_DEG).toFixed(0)}°`} />
        <Row label="Site temp" value={`${config.siteTemp_K.toFixed(1)} K  (${(config.siteTemp_K - 273.15).toFixed(1)} °C)`} />
      </Section>
    </div>
  );
}
