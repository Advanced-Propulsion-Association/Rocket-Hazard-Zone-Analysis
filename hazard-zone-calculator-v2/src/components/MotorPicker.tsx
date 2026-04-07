import { useState, useRef } from 'react';
import { lookupMotor } from '../motors/thrustcurve';
import { parseRaspEng, makeBoxcarMotor, totalImpulse } from '../simulation/motor';
import type { Motor } from '../types';

type MotorMode = 'lookup' | 'rasp' | 'boxcar';

interface Props {
  selectedMotor: Motor | null;
  onMotorSelected: (motor: Motor) => void;
  onClear?: () => void;
}

function motorSummary(motor: Motor): string {
  const I = totalImpulse(motor).toFixed(0);
  const bt = motor.thrustCurve.length > 0
    ? motor.thrustCurve[motor.thrustCurve.length - 1].time.toFixed(1)
    : '?';
  return `${motor.name}${motor.manufacturer ? ` (${motor.manufacturer})` : ''} — ${I} N·s, ${bt}s burn`;
}

export function MotorPicker({ selectedMotor, onMotorSelected, onClear }: Props) {
  const [mode, setMode] = useState<MotorMode>('lookup');
  const [desig, setDesig] = useState('');
  const [status, setStatus] = useState('');
  const [loading, setLoading] = useState(false);
  const raspRef = useRef<HTMLInputElement>(null);

  // Boxcar inputs
  const [avgThrust, setAvgThrust] = useState('');
  const [burnTime, setBurnTime]   = useState('');
  const [propMass, setPropMass]   = useState('');
  const [motorMass, setMotorMass] = useState('');

  const handleLookup = async () => {
    if (!desig.trim()) return;
    setLoading(true);
    setStatus('Searching ThrustCurve.org…');
    try {
      const motor = await lookupMotor(desig.trim());
      if (!motor) {
        setStatus('Not found. Check designation (e.g. J350W, H128W) or try another input method.');
        setLoading(false);
        return;
      }
      onMotorSelected(motor);
      setStatus('');
    } catch {
      setStatus('Lookup failed — check internet connection.');
    }
    setLoading(false);
  };

  const handleRasp = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      const text = await file.text();
      const motor = parseRaspEng(text);
      onMotorSelected(motor);
      setStatus('');
    } catch (err) {
      setStatus('Failed to parse .eng file: ' + String(err));
    }
  };

  const handleBoxcar = () => {
    const thrust = parseFloat(avgThrust);
    const bt     = parseFloat(burnTime);
    const pm     = parseFloat(propMass);
    const tm     = parseFloat(motorMass);
    if (!thrust || !bt || !pm || !tm) {
      setStatus('Fill in all four boxcar fields.');
      return;
    }
    const motor = makeBoxcarMotor(thrust, bt, pm, tm, 'Custom');
    onMotorSelected(motor);
    setStatus('');
  };

  const tabClass = (m: MotorMode) =>
    `px-3 py-1 text-xs rounded cursor-pointer transition-colors ${
      mode === m
        ? 'bg-blue-600 text-white'
        : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
    }`;

  return (
    <div className="mt-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Motor</p>

      {selectedMotor && (
        <div className="mb-2 px-3 py-2 bg-green-900/30 border border-green-700 rounded text-xs text-green-300 flex items-center justify-between">
          <span>{motorSummary(selectedMotor)}</span>
          <button
            className="ml-2 text-green-500 hover:text-red-400 text-xs transition-colors"
            onClick={onClear}
            title="Clear motor"
          >
            ✕
          </button>
        </div>
      )}

      <div className="flex gap-2 mb-3">
        {(['lookup', 'rasp', 'boxcar'] as MotorMode[]).map(m => (
          <button key={m} className={tabClass(m)} onClick={() => { setMode(m); setStatus(''); }}>
            {m === 'lookup' ? 'ThrustCurve.org' : m === 'rasp' ? '.eng File' : 'Boxcar'}
          </button>
        ))}
      </div>

      {mode === 'lookup' && (
        <div className="flex gap-2">
          <input
            type="text"
            value={desig}
            onChange={e => setDesig(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleLookup()}
            placeholder="e.g. J350W, H128W-14"
            className="flex-1 bg-gray-800 border border-gray-600 rounded px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
          />
          <button
            onClick={handleLookup}
            disabled={loading || !desig.trim()}
            className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 rounded text-sm text-white transition-colors"
          >
            {loading ? '…' : 'Lookup'}
          </button>
        </div>
      )}

      {mode === 'rasp' && (
        <div>
          <button
            onClick={() => raspRef.current?.click()}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 rounded text-sm text-white transition-colors"
          >
            Upload .eng file
          </button>
          <input ref={raspRef} type="file" accept=".eng" className="hidden" onChange={handleRasp} />
        </div>
      )}

      {mode === 'boxcar' && (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            {[
              { label: 'Avg thrust (N)', val: avgThrust, set: setAvgThrust, ph: '200' },
              { label: 'Burn time (s)',  val: burnTime,  set: setBurnTime,  ph: '1.5' },
              { label: 'Propellant mass (kg)', val: propMass,   set: setPropMass,   ph: '0.1' },
              { label: 'Total motor mass (kg)', val: motorMass, set: setMotorMass, ph: '0.25' },
            ].map(({ label, val, set, ph }) => (
              <label key={label} className="block">
                <span className="text-xs text-gray-400">{label}</span>
                <input
                  type="number" min="0" step="any"
                  value={val} onChange={e => set(e.target.value)}
                  placeholder={ph}
                  className="mt-0.5 w-full bg-gray-800 border border-gray-600 rounded px-2 py-1 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500"
                />
              </label>
            ))}
          </div>
          <button
            onClick={handleBoxcar}
            className="w-full px-3 py-1.5 bg-blue-600 hover:bg-blue-500 rounded text-sm text-white transition-colors"
          >
            Use Motor
          </button>
        </div>
      )}

      {status && (
        <p className="mt-2 text-xs text-yellow-300">{status}</p>
      )}
    </div>
  );
}
