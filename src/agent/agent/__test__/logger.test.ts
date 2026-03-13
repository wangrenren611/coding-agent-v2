import { describe, expect, it, vi } from 'vitest';
import { createAgentLoggerAdapter } from '../logger';

describe('agent/logger adapter', () => {
  it('maps AgentLogger calls to core structured logger with merged context', () => {
    const core = {
      debug: vi.fn(),
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    const logger = createAgentLoggerAdapter(core, { service: 'renx' });
    logger.info?.('run.start', { executionId: 'exec_1', stepIndex: 1 }, { extra: true });
    logger.error?.('run.error', new Error('boom'), { executionId: 'exec_1' });

    expect(core.info).toHaveBeenCalledWith(
      'run.start',
      expect.objectContaining({
        service: 'renx',
        executionId: 'exec_1',
        stepIndex: 1,
      }),
      { extra: true }
    );
    expect(core.error).toHaveBeenCalledWith(
      'run.error',
      expect.any(Error),
      expect.objectContaining({
        service: 'renx',
        executionId: 'exec_1',
      })
    );
  });
});
