import { ogiveWaveDragCD } from './src/simulation/barrowmanDrag.js';

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
process.exit(allPass ? 0 : 1);
