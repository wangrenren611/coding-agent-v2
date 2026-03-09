export interface AgentLogContext {
  executionId?: string;
  traceId?: string;
  spanId?: string;
  parentSpanId?: string;
  stepIndex?: number;
  toolCallId?: string;
  toolName?: string;
  errorCode?: string;
  category?: string;
  retryCount?: number;
  messageCount?: number;
  latencyMs?: number;
  [key: string]: unknown;
}

export interface AgentLogger {
  error?: (message: string, error?: unknown, context?: AgentLogContext) => void;
  warn?: (message: string, context?: AgentLogContext, data?: unknown) => void;
  info?: (message: string, context?: AgentLogContext, data?: unknown) => void;
  debug?: (message: string, context?: AgentLogContext, data?: unknown) => void;
}

export interface CoreStructuredLoggerLike {
  error: (message: string, error?: unknown, context?: Record<string, unknown>) => void;
  warn: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  info: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
  debug: (message: string, context?: Record<string, unknown>, data?: unknown) => void;
}

export function createAgentLoggerAdapter(
  logger: CoreStructuredLoggerLike,
  baseContext: AgentLogContext = {}
): AgentLogger {
  const withContext = (context?: AgentLogContext): AgentLogContext => ({
    ...baseContext,
    ...(context || {}),
  });

  return {
    debug: (message, context, data) => logger.debug(message, withContext(context), data),
    info: (message, context, data) => logger.info(message, withContext(context), data),
    warn: (message, context, data) => logger.warn(message, withContext(context), data),
    error: (message, error, context) => logger.error(message, error, withContext(context)),
  };
}
