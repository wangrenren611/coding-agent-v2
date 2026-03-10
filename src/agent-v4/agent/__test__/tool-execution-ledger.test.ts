import { describe, expect, it } from 'vitest';
import {
  InMemoryToolExecutionLedger,
  NoopToolExecutionLedger,
  executeToolCallWithLedger,
  type ToolExecutionLedgerRecord,
} from '../tool-execution-ledger';

function makeRecord(output: string): ToolExecutionLedgerRecord {
  return {
    success: true,
    output,
    summary: output || 'no output',
    recordedAt: Date.now(),
  };
}

describe('tool-execution-ledger', () => {
  it('InMemoryToolExecutionLedger executeOnce deduplicates concurrent execution', async () => {
    const ledger = new InMemoryToolExecutionLedger();
    let executionCount = 0;

    const run = () =>
      ledger.executeOnce('exec_1', 'tool_1', async () => {
        executionCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 20));
        return makeRecord('ok');
      });

    const [resultA, resultB] = await Promise.all([run(), run()]);
    expect(resultA.record.output).toBe('ok');
    expect(resultB.record.output).toBe('ok');
    expect(executionCount).toBe(1);
  });

  it('NoopToolExecutionLedger executeOnce never caches', async () => {
    const ledger = new NoopToolExecutionLedger();
    let executionCount = 0;

    const run = async () =>
      ledger.executeOnce('exec_2', 'tool_2', async () => {
        executionCount += 1;
        return makeRecord(`ok_${executionCount}`);
      });

    const first = await run();
    const second = await run();
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(false);
    expect(first.record.output).toBe('ok_1');
    expect(second.record.output).toBe('ok_2');
  });

  it('executeToolCallWithLedger bypasses cache when executionId is empty', async () => {
    const ledger = new InMemoryToolExecutionLedger();
    let executionCount = 0;

    const run = async () =>
      executeToolCallWithLedger({
        ledger,
        executionId: '',
        toolCallId: 'tool_3',
        execute: async () => {
          executionCount += 1;
          return makeRecord(`result_${executionCount}`);
        },
      });

    const first = await run();
    const second = await run();
    expect(first.fromCache).toBe(false);
    expect(second.fromCache).toBe(false);
    expect(first.record.output).toBe('result_1');
    expect(second.record.output).toBe('result_2');
  });
});
