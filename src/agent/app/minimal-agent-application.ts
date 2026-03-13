import type { LLMGenerateOptions, Tool } from '../../providers';
import { StatelessAgent } from '../agent';
import type { AgentCallbacks, Message, StreamEvent } from '../types';

type RunFinishReason = 'stop' | 'max_steps' | 'error';

export interface RunAgentRequest {
  conversationId: string;
  userInput: string;
  executionId?: string;
  historyMessages?: Message[];
  systemPrompt?: string;
  tools?: Tool[];
  config?: LLMGenerateOptions;
  maxSteps?: number;
  abortSignal?: AbortSignal;
  timeoutBudgetMs?: number;
  llmTimeoutRatio?: number;
}

export interface RunAgentCallbacks extends Partial<AgentCallbacks> {
  onToolStream?: (event: StreamEvent) => void | Promise<void>;
  onEvent?: (event: StreamEvent) => void | Promise<void>;
}

export interface RunAgentResult {
  executionId: string;
  conversationId: string;
  messages: Message[];
  events: StreamEvent[];
  finishReason: RunFinishReason;
  steps: number;
}

export class MinimalStatelessAgentApplication {
  constructor(private readonly agent: StatelessAgent) {}

  async runForeground(
    request: RunAgentRequest,
    callbacks?: RunAgentCallbacks
  ): Promise<RunAgentResult> {
    const executionId = request.executionId ?? createId('exec_');
    const baseMessages = request.historyMessages ? [...request.historyMessages] : [];
    const userMessage = createUserMessage(request.userInput);
    const inputMessages = [...baseMessages, userMessage];
    const emittedMessages: Message[] = [];
    const events: StreamEvent[] = [];
    let finishReason: RunFinishReason = 'error';
    let steps = 0;

    const toolChunkListener = (payload: unknown): void => {
      const toolStreamEvent: StreamEvent = {
        type: 'tool_stream',
        data: payload,
      };
      events.push(toolStreamEvent);
      void callbacks?.onToolStream?.(toolStreamEvent);
      void callbacks?.onEvent?.(toolStreamEvent);
    };

    this.agent.on('tool_chunk', toolChunkListener);

    const agentCallbacks: AgentCallbacks = {
      onMessage: async (message) => {
        emittedMessages.push(message);
        await callbacks?.onMessage?.(message);
      },
      onCheckpoint: async (checkpoint) => {
        await callbacks?.onCheckpoint?.(checkpoint);
      },
      onProgress: callbacks?.onProgress,
      onCompaction: callbacks?.onCompaction,
      onMetric: callbacks?.onMetric,
      onTrace: callbacks?.onTrace,
      onToolPolicy: callbacks?.onToolPolicy,
      onError: callbacks?.onError,
    };

    try {
      for await (const event of this.agent.runStream(
        {
          executionId,
          conversationId: request.conversationId,
          messages: inputMessages,
          systemPrompt: request.systemPrompt,
          tools: request.tools,
          config: request.config,
          maxSteps: request.maxSteps,
          abortSignal: request.abortSignal,
          timeoutBudgetMs: request.timeoutBudgetMs,
          llmTimeoutRatio: request.llmTimeoutRatio,
        },
        agentCallbacks
      )) {
        events.push(event);
        await callbacks?.onEvent?.(event);
        if (event.type === 'done') {
          const doneData = event.data as { finishReason?: 'stop' | 'max_steps'; steps?: number };
          finishReason = doneData.finishReason ?? 'stop';
          steps = typeof doneData.steps === 'number' ? doneData.steps : steps;
        }
        if (event.type === 'error') {
          finishReason = 'error';
        }
      }
    } finally {
      this.agent.off('tool_chunk', toolChunkListener);
    }

    if (steps === 0) {
      steps = inferSteps(events);
    }

    return {
      executionId,
      conversationId: request.conversationId,
      messages: [...inputMessages, ...emittedMessages],
      events,
      finishReason,
      steps,
    };
  }
}

function inferSteps(events: StreamEvent[]): number {
  let maxStep = 0;
  for (const event of events) {
    if (event.type !== 'progress' && event.type !== 'checkpoint') {
      continue;
    }
    const data = event.data as { stepIndex?: number };
    if (typeof data.stepIndex === 'number' && data.stepIndex > maxStep) {
      maxStep = data.stepIndex;
    }
  }
  return maxStep;
}

function createUserMessage(content: string): Message {
  return {
    messageId: createId('msg_usr_'),
    type: 'user',
    role: 'user',
    content,
    timestamp: Date.now(),
  };
}

function createId(prefix: string): string {
  return `${prefix}${Date.now()}_${Math.random().toString(36).slice(2, 11)}`;
}
