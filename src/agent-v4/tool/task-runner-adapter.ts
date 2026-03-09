import type { ToolExecutionContext } from './types';
import type { AgentRunEntity, SubagentType } from './task-types';

export interface StartAgentInput {
  subagentType: SubagentType;
  prompt: string;
  systemPrompt?: string;
  description?: string;
  model?: 'sonnet' | 'opus' | 'haiku';
  maxTurns?: number;
  allowedTools?: string[];
  runInBackground?: boolean;
  resume?: string;
  linkedTaskId?: string;
  metadata?: Record<string, unknown>;
}

export interface SubagentRunnerAdapter {
  start(
    namespace: string,
    input: StartAgentInput,
    context?: ToolExecutionContext
  ): Promise<AgentRunEntity>;
  poll(namespace: string, agentId: string): Promise<AgentRunEntity | null>;
  cancel(namespace: string, agentId: string, reason?: string): Promise<AgentRunEntity | null>;
}

class UnconfiguredSubagentRunnerAdapter implements SubagentRunnerAdapter {
  async start(): Promise<AgentRunEntity> {
    throw new Error(
      'TASK_RUNNER_NOT_CONFIGURED: real subagent runner is required. Inject runner from runtime.'
    );
  }

  async poll(): Promise<AgentRunEntity | null> {
    return null;
  }

  async cancel(): Promise<AgentRunEntity | null> {
    return null;
  }
}

export function createUnconfiguredSubagentRunnerAdapter(): SubagentRunnerAdapter {
  return new UnconfiguredSubagentRunnerAdapter();
}

export {
  InProcessMockRunnerAdapter,
  type InProcessMockRunnerAdapterOptions,
} from './task-mock-runner-adapter';
export {
  RealSubagentRunnerAdapter,
  type RealSubagentRunnerAdapterOptions,
} from './task-real-runner-adapter';
