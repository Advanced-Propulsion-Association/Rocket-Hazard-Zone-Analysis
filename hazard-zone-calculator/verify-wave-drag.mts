import { ogiveWaveDragCD } from './src/simulation/barrowmanDrag.js';
import { cdMachCorrectionOgive } from './src/simulation/aerodynamics.js';

const cases: [number, number][] = [
  [0.50,  0],
  [0.85,  0],
  [0.90,  0.025 * (0.90 - 0.85) / 0.20],   // 0.00625
  [0.95,  0.025 * (0.95 - 0.85) / 0.20],   // 0.01250
  [1.05,  0.025],
  [1.10,  0.025],
  [1.20,  0.025],
  [1.50,  0.025 * 1.20 / 1.50],             // 0.02000
  [2.00,  0.025 * 1.20 / 2.00],             // 0.01500
];

let allPass = true;
for (const [mach, expected] of cases) {
  const got = ogiveWaveDragCD(mach);
  const ok = Math.abs(got - expected) < 1e-10;
  console.log(`M=${mach.toFixed(2)}  expected=${expected.toFixed(5)}  got=${got.toFixed(5)}  ${ok ? 'PASS' : 'FAIL'}`);
  if (!ok) allPass = false;
}

// --- cdMachCorrectionOgive spot-checks ---
const cdSub = 0.40;

const ogiveCorrCases: Array<[number, number]> = [
  // [mach, expected]
  [0.50, 0.40],                        // below onset: unchanged
  [0.85, 0.40],                        // onset boundary: wave=0, returns cdSub
  [0.95, 0.40 + 0.025*(0.95-0.85)/0.20], // linear ramp: ~0.4125
  [1.05, 0.40 + 0.025],               // plateau start: 0.425
  [1.10, 0.40 + 0.025],               // plateau end (still additive): 0.425
  [1.20, 0.40 * 1.055 * Math.pow(1.20, -0.561) + 0.025], // supersonic
  [2.00, 0.40 * 1.055 * Math.pow(2.00, -0.561) + 0.025 * 1.20 / 2.00], // supersonic decay
];

let passed2 = 0;
for (const [mach, expected] of ogiveCorrCases) {
  const got = cdMachCorrectionOgive(cdSub, mach);
  const ok = Math.abs(got - expected) < 1e-9;
  console.log(`cdMachCorrectionOgive(${cdSub}, M=${mach}): ${ok ? 'PASS' : 'FAIL'} (got=${got.toFixed(6)}, expected=${expected.toFixed(6)})`);
  if (ok) passed2++;
}
console.log(`\ncdMachCorrectionOgive: ${passed2}/${ogiveCorrCases.length} passed`);

allPass = allPass && passed2 === ogiveCorrCases.length;
process.exit(allPass ? 0 : 1);
