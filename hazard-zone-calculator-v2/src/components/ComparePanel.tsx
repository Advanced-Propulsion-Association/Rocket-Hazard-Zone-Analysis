interface Props {
  hazard6dof_ft: number;
  hazard3dof_ft?: number;
  apogee6dof_ft: number;
}

const M_TO_FT = 3.28084;

export function ComparePanel({ hazard6dof_ft, hazard3dof_ft, apogee6dof_ft }: Props) {
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <div className="bg-gray-800/60 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-400 mb-1">6-DOF Hazard Radius</p>
          <p className="text-2xl font-bold text-blue-400">{hazard6dof_ft.toFixed(0)} ft</p>
          <p className="text-xs text-gray-500">{(hazard6dof_ft / M_TO_FT).toFixed(0)} m</p>
        </div>
        <div className="bg-gray-800/60 rounded-lg p-3 text-center">
          <p className="text-xs text-gray-400 mb-1">3-DOF (v1) Radius</p>
          {hazard3dof_ft != null ? (
            <>
              <p className="text-2xl font-bold text-gray-300">{hazard3dof_ft.toFixed(0)} ft</p>
              <p className="text-xs text-gray-500">{(hazard3dof_ft / M_TO_FT).toFixed(0)} m</p>
            </>
          ) : (
            <p className="text-sm text-gray-500 mt-2">—</p>
          )}
        </div>
      </div>

      {hazard3dof_ft != null && (
        <p className="text-xs text-gray-400 leading-relaxed">
          The 3-DOF result is{' '}
          {hazard3dof_ft > hazard6dof_ft ? 'larger' : 'smaller'} than 6-DOF.{' '}
          {hazard3dof_ft > hazard6dof_ft
            ? 'This is expected: 3-DOF assumes nose-forward descent with no stabilizing aerodynamics, producing a conservative (larger) bound.'
            : 'The 6-DOF result is larger — this can occur when attitude divergence or wind-direction dispersion drives landing points further than the single worst-case 3-DOF trajectory.'}
        </p>
      )}

      <div className="text-xs text-gray-500 border-t border-gray-700 pt-2">
        Max apogee: <span className="text-gray-300">{apogee6dof_ft.toFixed(0)} ft AGL</span>
      </div>
    </div>
  );
}
