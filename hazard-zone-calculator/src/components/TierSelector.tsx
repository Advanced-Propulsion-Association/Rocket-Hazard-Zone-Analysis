import type { InputTier } from '../types';

interface Props {
  selected: InputTier;
  onChange: (tier: InputTier) => void;
}

const TIERS: { id: InputTier; label: string; description: string }[] = [
  {
    id: 'tier1',
    label: 'Tier 1 — Operator',
    description: 'Only need max altitude. Conservative defaults.',
  },
  {
    id: 'tier2',
    label: 'Tier 2 — Basic',
    description: 'Kit specs + motor name or average thrust.',
  },
  {
    id: 'tier3',
    label: 'Tier 3 — Full',
    description: 'Complete geometry, full thrust curve, high-altitude flights.',
  },
];

export function TierSelector({ selected, onChange }: Props) {
  return (
    <div>
      <p className="text-xs text-slate-400 mb-3 uppercase tracking-widest font-medium">Input Mode</p>
      <div className="grid grid-cols-3 gap-3">
        {TIERS.map(t => (
          <button
            key={t.id}
            onClick={() => onChange(t.id)}
            className={`text-left rounded-lg border p-3 transition-colors ${
              selected === t.id
                ? 'border-blue-500 bg-blue-500/10 text-white'
                : 'border-slate-700 bg-slate-800 text-slate-400 hover:border-slate-500 hover:text-slate-200'
            }`}
          >
            <div className="text-sm font-semibold">{t.label}</div>
            <div className="text-xs mt-0.5 opacity-80">{t.description}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
