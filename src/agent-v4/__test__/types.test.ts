import { describe, expect, it } from 'vitest';
import { AGENT_V4_TYPES_MODULE } from '../types';
import type {
  AgentCallbacks,
  AgentInput,
  AgentOutput,
  ConversationContext,
  ErrorDecision,
  Execution,
  ExecutionCheckpoint,
  ExecutionProgress,
  ExecuteOptions,
  Message,
  StreamEvent,
  Task,
  ToolConfirmInfo,
  ToolDecision,
  ToolStreamChunk,
} from '../types';

describe('agent-v4/types runtime contract', () => {
  it('accepts representative typed data structures', () => {
    const message: Message = {
      messageId: 'm1',
      type: 'user',
      role: 'user',
      content: 'hello',
      timestamp: Date.now(),
    };

    const input: AgentInput = {
      executionId: 'e1',
      conversationId: 'c1',
      messages: [message],
      maxSteps: 3,
    };

    const output: AgentOutput = {
      messages: [message],
      finishReason: 'stop',
      steps: 1,
    };

    const checkpoint: ExecutionCheckpoint = {
      executionId: 'e1',
      stepIndex: 1,
      lastMessageId: 'm1',
      lastMessageTime: Date.now(),
      canResume: true,
    };

    const progress: ExecutionProgress = {
      executionId: 'e1',
      stepIndex: 1,
      currentAction: 'llm',
      messageCount: 1,
    };

    const callbacks: AgentCallbacks = {
      onMessage: () => undefined,
      onCheckpoint: () => undefined,
      onProgress: () => undefined,
      onError: () => ({ retry: false }),
    };

    const errDecision: ErrorDecision = { retry: true, message: 'retry now' };
    const toolChunk: ToolStreamChunk = { type: 'stdout', data: 'chunk' };
    const confirmInfo: ToolConfirmInfo = {
      toolCallId: 'tc1',
      toolName: 'bash',
      arguments: '{}',
    };
    const toolDecision: ToolDecision = { approved: true };
    const execOptions: ExecuteOptions = {
      onChunk: () => undefined,
      onConfirm: async () => toolDecision,
    };

    const streamEvent: StreamEvent = { type: 'progress', data: progress };
    const execution: Execution = {
      executionId: 'e1',
      conversationId: 'c1',
      status: 'RUNNING',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };

    const task: Task = {
      executionId: 'e1',
      conversationId: 'c1',
      message: { role: 'user', content: 'do this' },
      createdAt: Date.now(),
    };

    const context: ConversationContext = {
      messages: [message],
      systemPrompt: 'you are helper',
    };

    expect(input.messages[0].role).toBe('user');
    expect(output.finishReason).toBe('stop');
    expect(checkpoint.canResume).toBe(true);
    expect(progress.currentAction).toBe('llm');
    expect(typeof callbacks.onMessage).toBe('function');
    expect(errDecision.retry).toBe(true);
    expect(toolChunk.type).toBe('stdout');
    expect(confirmInfo.toolName).toBe('bash');
    expect(execOptions.onConfirm).toBeTypeOf('function');
    expect(streamEvent.type).toBe('progress');
    expect(execution.status).toBe('RUNNING');
    expect(task.message.role).toBe('user');
    expect(context.messages.length).toBe(1);
    expect(AGENT_V4_TYPES_MODULE).toBe('agent-v4-types');
  });
});
