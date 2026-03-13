import { describe, expect, it, vi } from 'vitest';
import type { AgentCallbacks, AgentMetric, AgentTraceEvent } from '../../types';
import {
  emitMetric,
  emitTrace,
  endSpan,
  extractErrorCode,
  logError,
  logInfo,
  logWarn,
  startSpan,
} from '../telemetry';

describe('telemetry', () => {
  it('extractErrorCode reads string errorCode from unknown object', () => {
    expect(extractErrorCode({ errorCode: 'E1' })).toBe('E1');
    expect(extractErrorCode({ errorCode: 1 })).toBeUndefined();
    expect(extractErrorCode(null)).toBeUndefined();
  });

  it('emitMetric and emitTrace call safeCallback wrappers', async () => {
    const onMetric = vi.fn(async (_metric: AgentMetric) => undefined);
    const onTrace = vi.fn(async (_event: AgentTraceEvent) => undefined);
    const callbacks: AgentCallbacks = {
      onMessage: async () => undefined,
      onCheckpoint: async () => undefined,
      onMetric,
      onTrace,
    };
    const safeCallback: <T>(
      cb: ((arg: T) => void | Promise<void>) | undefined,
      arg: T
    ) => Promise<void> = vi.fn(async (cb, arg) => {
      await cb?.(arg);
    });

    await emitMetric(
      callbacks,
      { name: 'agent.run.duration_ms', value: 1, unit: 'ms', timestamp: Date.now() },
      safeCallback
    );
    await emitTrace(
      callbacks,
      { traceId: 't', spanId: 's', name: 'span', phase: 'start', timestamp: Date.now() },
      safeCallback
    );

    expect(onMetric).toHaveBeenCalledOnce();
    expect(onTrace).toHaveBeenCalledOnce();
    expect(safeCallback).toHaveBeenCalledTimes(2);
  });

  it('startSpan and endSpan emit trace start/end events', async () => {
    const events: unknown[] = [];
    const callbacks = {} as AgentCallbacks;
    const emitTraceFn = vi.fn(async (_callbacks: AgentCallbacks | undefined, event: unknown) => {
      events.push(event);
    });

    const span = await startSpan({
      callbacks,
      traceId: 'trace_1',
      name: 'agent.run',
      parentSpanId: 'parent_1',
      attributes: { a: 1 },
      createSpanId: () => 'span_1',
      emitTrace: emitTraceFn,
    });

    await endSpan({
      callbacks,
      span,
      attributes: { b: 2 },
      emitTrace: emitTraceFn,
    });

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ phase: 'start', traceId: 'trace_1', spanId: 'span_1' });
    expect(events[1]).toMatchObject({ phase: 'end', traceId: 'trace_1', spanId: 'span_1' });
  });

  it('log helpers call corresponding logger methods', () => {
    const logger = {
      info: vi.fn(),
      warn: vi.fn(),
      error: vi.fn(),
    };

    logInfo(logger, 'm1', { a: 1 }, { b: 2 });
    logWarn(logger, 'm2', { c: 3 }, { d: 4 });
    logError(logger, 'm3', new Error('boom'), { e: 5 });

    expect(logger.info).toHaveBeenCalledOnce();
    expect(logger.warn).toHaveBeenCalledOnce();
    expect(logger.error).toHaveBeenCalledOnce();
  });
});
