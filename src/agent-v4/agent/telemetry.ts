import type { AgentCallbacks, AgentMetric, AgentTraceEvent } from '../types';
import type { AgentLogger } from './logger';

export interface SpanRuntime {
  traceId: string;
  spanId: string;
  parentSpanId?: string;
  name: string;
  startedAt: number;
}

export async function emitMetric(
  callbacks: AgentCallbacks | undefined,
  metric: AgentMetric,
  safeCallback: <T>(
    callback: ((arg: T) => void | Promise<void>) | undefined,
    arg: T
  ) => Promise<void>
): Promise<void> {
  await safeCallback(callbacks?.onMetric, metric);
}

export async function emitTrace(
  callbacks: AgentCallbacks | undefined,
  event: AgentTraceEvent,
  safeCallback: <T>(
    callback: ((arg: T) => void | Promise<void>) | undefined,
    arg: T
  ) => Promise<void>
): Promise<void> {
  await safeCallback(callbacks?.onTrace, event);
}

export async function startSpan(params: {
  callbacks: AgentCallbacks | undefined;
  traceId: string;
  name: string;
  parentSpanId?: string;
  attributes?: Record<string, unknown>;
  createSpanId: () => string;
  emitTrace: (callbacks: AgentCallbacks | undefined, event: AgentTraceEvent) => Promise<void>;
}): Promise<SpanRuntime> {
  const {
    callbacks,
    traceId,
    name,
    parentSpanId,
    attributes,
    createSpanId,
    emitTrace: emitTraceFn,
  } = params;
  const startedAt = Date.now();
  const span: SpanRuntime = {
    traceId,
    spanId: createSpanId(),
    parentSpanId,
    name,
    startedAt,
  };
  await emitTraceFn(callbacks, {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    phase: 'start',
    timestamp: startedAt,
    attributes,
  });
  return span;
}

export async function endSpan(params: {
  callbacks: AgentCallbacks | undefined;
  span: SpanRuntime;
  attributes?: Record<string, unknown>;
  emitTrace: (callbacks: AgentCallbacks | undefined, event: AgentTraceEvent) => Promise<void>;
}): Promise<void> {
  const { callbacks, span, attributes, emitTrace: emitTraceFn } = params;
  await emitTraceFn(callbacks, {
    traceId: span.traceId,
    spanId: span.spanId,
    parentSpanId: span.parentSpanId,
    name: span.name,
    phase: 'end',
    timestamp: Date.now(),
    attributes,
  });
}

export function extractErrorCode(error: unknown): string | undefined {
  if (!error || typeof error !== 'object') {
    return undefined;
  }
  const maybeCode = (error as { errorCode?: unknown }).errorCode;
  return typeof maybeCode === 'string' ? maybeCode : undefined;
}

export function logError(
  logger: AgentLogger,
  message: string,
  error: unknown,
  context?: Record<string, unknown>
): void {
  logger.error?.(message, error, context);
}

export function logInfo(
  logger: AgentLogger,
  message: string,
  context?: Record<string, unknown>,
  data?: unknown
): void {
  logger.info?.(message, context, data);
}

export function logWarn(
  logger: AgentLogger,
  message: string,
  context?: Record<string, unknown>,
  data?: unknown
): void {
  logger.warn?.(message, context, data);
}
