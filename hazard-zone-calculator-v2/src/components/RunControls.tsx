interface Props {
  numRuns: number;
  onNumRunsChange: (n: number) => void;
  onRun: () => void;
  running: boolean;
  progress: number;   // 0–1
  canRun: boolean;
}

const RUN_OPTIONS = [100, 500, 2000] as const;

export function RunControls({ numRuns, onNumRunsChange, onRun, running, progress, canRun }: Props) {
  return (
    <div className="mt-4 border-t border-gray-700 pt-4">
      <p className="text-xs text-gray-400 uppercase tracking-wider mb-2">Monte Carlo</p>

      <div className="flex items-center gap-3 mb-3">
        <span className="text-xs text-gray-400">Runs:</span>
        <div className="flex gap-2">
          {RUN_OPTIONS.map(n => (
            <button
              key={n}
              onClick={() => onNumRunsChange(n)}
              className={`px-2 py-1 text-xs rounded border transition-colors ${
                numRuns === n
                  ? 'border-blue-400 bg-blue-900/40 text-blue-300'
                  : 'border-gray-600 text-gray-400 hover:border-gray-400'
              }`}
            >
              {n.toLocaleString()}
            </button>
          ))}
        </div>
      </div>

      <button
        onClick={onRun}
        disabled={running || !canRun}
        className="w-full py-2 rounded text-sm font-medium transition-colors disabled:opacity-40 disabled:cursor-not-allowed bg-blue-600 hover:bg-blue-500 text-white"
      >
        {running ? 'Running…' : 'Run 6-DOF Simulation'}
      </button>

      {running && (
        <div className="mt-2">
          <div className="h-1.5 w-full bg-gray-700 rounded-full overflow-hidden">
            <div
              className="h-full bg-blue-500 rounded-full transition-all duration-300"
              style={{ width: `${Math.round(progress * 100)}%` }}
            />
          </div>
          <p className="text-xs text-gray-500 mt-1 text-right">
            {Math.round(progress * 100)}%
          </p>
        </div>
      )}
    </div>
  );
}
