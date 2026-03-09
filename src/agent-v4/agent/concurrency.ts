import type { ToolCall } from '../../providers';
import type { ToolConcurrencyPolicy } from '../tool/types';

export interface ToolExecutionPlan {
  toolCall: ToolCall;
  policy: ToolConcurrencyPolicy;
}

export interface ToolExecutionWave {
  type: 'exclusive' | 'parallel';
  plans: ToolExecutionPlan[];
}

export function buildExecutionWaves(plans: ToolExecutionPlan[]): ToolExecutionWave[] {
  const waves: ToolExecutionWave[] = [];
  let currentParallel: ToolExecutionPlan[] = [];

  const flushParallel = () => {
    if (currentParallel.length === 0) {
      return;
    }
    waves.push({ type: 'parallel', plans: currentParallel });
    currentParallel = [];
  };

  for (const plan of plans) {
    if (plan.policy.mode === 'exclusive') {
      flushParallel();
      waves.push({ type: 'exclusive', plans: [plan] });
    } else {
      currentParallel.push(plan);
    }
  }
  flushParallel();

  return waves;
}

export async function runWithConcurrencyAndLock<T>(
  tasks: Array<{ lockKey?: string; run: () => Promise<T> }>,
  limit: number
): Promise<T[]> {
  if (tasks.length === 0) {
    return [];
  }

  const results: T[] = new Array(tasks.length);
  const pending = tasks.map((_, index) => index);
  const runningLocks = new Set<string>();
  let activeCount = 0;
  let settled = false;

  return new Promise<T[]>((resolve, reject) => {
    const tryStart = () => {
      while (activeCount < limit && pending.length > 0) {
        const nextPos = pending.findIndex((index) => {
          const lockKey = tasks[index].lockKey;
          return !lockKey || !runningLocks.has(lockKey);
        });
        if (nextPos === -1) {
          break;
        }

        const taskIndex = pending.splice(nextPos, 1)[0];
        const lockKey = tasks[taskIndex].lockKey;
        if (lockKey) {
          runningLocks.add(lockKey);
        }
        activeCount += 1;

        tasks[taskIndex]
          .run()
          .then((value) => {
            results[taskIndex] = value;
          })
          .catch((error) => {
            if (!settled) {
              settled = true;
              reject(error);
            }
          })
          .finally(() => {
            activeCount -= 1;
            if (lockKey) {
              runningLocks.delete(lockKey);
            }

            if (settled) {
              return;
            }
            if (pending.length === 0 && activeCount === 0) {
              settled = true;
              resolve(results);
              return;
            }
            tryStart();
          });
      }
    };

    tryStart();
  });
}
