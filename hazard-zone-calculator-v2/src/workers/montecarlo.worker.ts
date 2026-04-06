import type { WorkerRequest, WorkerProgress, WorkerResult } from '../types';
import { runMonteCarlo } from '../simulation/montecarlo';

self.onmessage = (e: MessageEvent<WorkerRequest>) => {
  const { config, numRuns } = e.data;

  const result = runMonteCarlo(config, numRuns, (completed) => {
    const progress: WorkerProgress = { type: 'progress', completed, total: numRuns };
    self.postMessage(progress);
  });

  const response: WorkerResult = { type: 'result', result };
  self.postMessage(response);
};
