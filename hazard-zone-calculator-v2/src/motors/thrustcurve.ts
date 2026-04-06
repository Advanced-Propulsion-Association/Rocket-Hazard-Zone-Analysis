/**
 * ThrustCurve.org API client (browser-safe, no auth required, CORS open)
 * API docs: https://www.thrustcurve.org/info/api.html
 */

import type { Motor, MotorSearchResult } from '../types';

const TC_BASE = 'https://www.thrustcurve.org/api/v1';

export interface SearchParams {
  designation?: string;
  manufacturer?: string;
  commonName?: string;
  availability?: 'available' | 'regular' | 'OOP' | 'all';
}

export async function searchMotors(params: SearchParams): Promise<MotorSearchResult[]> {
  const body: Record<string, unknown> = {
    availability: params.availability ?? 'available',
  };
  if (params.designation)   body.designation   = params.designation;
  if (params.manufacturer)  body.manufacturer  = params.manufacturer;
  if (params.commonName)    body.commonName    = params.commonName;

  const res = await fetch(`${TC_BASE}/search.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!res.ok) throw new Error(`ThrustCurve search failed: ${res.status}`);
  const data = await res.json();

  return (data.results ?? []).map((r: Record<string, unknown>) => ({
    motorId:        r.motorId as string,
    commonName:     r.commonName as string,
    designation:    r.designation as string,
    manufacturer:   r.manufacturer as string,
    totalImpulseNs: r.totImpulseNs as number,
    avgThrustN:     r.avgThrustN as number,
    burnTimeS:      r.burnTimeS as number,
    propWeightG:    r.propWeightG as number,
    totalWeightG:   r.totalWeightG as number,
    diameter:       r.diameter as number,
    length:         r.length as number,
    motorClass:     r.impulseClass as string,
  }));
}

export async function downloadMotor(motorId: string): Promise<Motor | null> {
  const res = await fetch(`${TC_BASE}/download.json`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ motorIds: [motorId], data: 'samples' }),
  });

  if (!res.ok) throw new Error(`ThrustCurve download failed: ${res.status}`);
  const data = await res.json();

  // API response: data.results is an array of result objects.
  // Each result object has: { source: string, samples: [{time, thrust}], motor: {...} }
  const downloads: Array<{
    source: string;
    samples: Array<{ time: number; thrust: number }>;
    motor: Record<string, unknown>;
  }> = data.results ?? [];
  if (downloads.length === 0) return null;

  // Motor metadata comes from any result (same motor, different sources)
  const meta = downloads[0].motor ?? {};

  // Pick best available sample source: cert > mfr > user
  const ranked = ['cert', 'mfr', 'user'];
  let best = downloads.find(d => d.source === ranked[0] && d.samples?.length > 0)
          ?? downloads.find(d => d.source === ranked[1] && d.samples?.length > 0)
          ?? downloads.find(d => d.source === ranked[2] && d.samples?.length > 0)
          ?? downloads.find(d => d.samples?.length > 0)
          ?? downloads[0];

  const bestSamples = best.samples ?? [];

  return {
    name:             (meta.commonName ?? motorId) as string,
    diameterMm:       (meta.diameter ?? 0) as number,
    lengthMm:         (meta.length ?? 0) as number,
    propellantMassKg: ((meta.propWeightG ?? 0) as number) / 1000,
    totalMassKg:      ((meta.totalWeightG ?? 0) as number) / 1000,
    manufacturer:     (meta.manufacturer ?? 'Unknown') as string,
    thrustCurve:      bestSamples.map(s => ({ time: s.time, thrust: s.thrust })),
  };
}

/** Combined: search + download first result. Returns null if not found. */
export async function lookupMotor(
  designation: string,
  manufacturer?: string,
): Promise<Motor | null> {
  const results = await searchMotors({ designation, manufacturer, availability: 'all' });
  if (results.length === 0) return null;
  return downloadMotor(results[0].motorId);
}
