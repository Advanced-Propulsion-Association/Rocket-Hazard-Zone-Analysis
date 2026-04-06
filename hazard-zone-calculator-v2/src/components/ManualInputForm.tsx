import type { OpenRocketData } from '../types';

interface Props {
  values: Partial<OpenRocketData>;
  onChange: (updates: Partial<OpenRocketData>) => void;
}

function Field({ label, value, onChange, unit, help }: {
  label: string; value: number | undefined; onChange: (v: number) => void;
  unit: string; help: string;
}) {
  return (
    <div className="mb-3">
      <label className="block text-xs text-gray-400 mb-1">{label} ({unit})</label>
      <input
        type="number"
        className="w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white focus:outline-none focus:border-blue-400"
        value={value ?? ''}
        onChange={e => onChange(parseFloat(e.target.value))}
      />
      <p className="text-xs text-gray-500 mt-0.5">{help}</p>
    </div>
  );
}

export function ManualInputForm({ values, onChange }: Props) {
  return (
    <details className="mt-3">
      <summary className="text-sm text-blue-400 cursor-pointer select-none">
        ▸ Enter geometry manually
      </summary>
      <div className="mt-3 space-y-1">
        <Field label="Body Diameter" unit="in" value={values.bodyDiameter_in}
          onChange={v => onChange({ bodyDiameter_in: v })}
          help="Outer diameter of the body tube." />
        <Field label="Body Length" unit="in" value={values.bodyLength_in}
          onChange={v => onChange({ bodyLength_in: v })}
          help="Total length from base to nose tip." />
        <Field label="Nose Length" unit="in" value={values.noseLength_in}
          onChange={v => onChange({ noseLength_in: v })}
          help="Length of nose cone only." />
        <Field label="Fin Root Chord" unit="in" value={values.finRootChord_in}
          onChange={v => onChange({ finRootChord_in: v })}
          help="Fin chord length at body attachment." />
        <Field label="Fin Tip Chord" unit="in" value={values.finTipChord_in}
          onChange={v => onChange({ finTipChord_in: v })}
          help="Fin chord at tip (0 for triangular fins)." />
        <Field label="Fin Span" unit="in" value={values.finSpan_in}
          onChange={v => onChange({ finSpan_in: v })}
          help="Fin height from body surface to tip." />
      </div>
    </details>
  );
}
