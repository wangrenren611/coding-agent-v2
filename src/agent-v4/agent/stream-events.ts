import type { AgentError } from './error';
import type { ExecutionCheckpoint, StreamEvent } from '../types';

export function createCheckpoint(
  executionId: string | undefined,
  stepIndex: number,
  lastMessageId: string | undefined
): ExecutionCheckpoint {
  return {
    executionId: executionId || '',
    stepIndex,
    lastMessageId: lastMessageId || '',
    lastMessageTime: Date.now(),
    canResume: true,
  };
}

export function createProgressEvent(
  executionId: string | undefined,
  stepIndex: number,
  currentAction: 'llm' | 'tool',
  messageCount: number
): StreamEvent {
  return {
    type: 'progress',
    data: {
      executionId,
      stepIndex,
      currentAction,
      messageCount,
    },
  };
}

export function createErrorEvent(error: AgentError): StreamEvent {
  return {
    type: 'error',
    data: {
      name: error.name,
      code: error.code,
      errorCode: error.errorCode,
      category: error.category,
      retryable: error.retryable,
      httpStatus: error.httpStatus,
      message: error.message,
    },
  };
}

export function createDoneEvent(stepIndex: number): StreamEvent {
  return {
    type: 'done',
    data: {
      finishReason: 'stop',
      steps: stepIndex,
    },
  };
}
