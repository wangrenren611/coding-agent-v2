import type { ToolStreamEvent, Usage } from '../core/types';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../tool/types';

export type TerminalUiStatus =
  | 'idle'
  | 'running'
  | 'waiting_confirm'
  | 'completed'
  | 'error'
  | 'exiting';

export interface TerminalUiState {
  sessionId: string;
  modelId?: string;
  status: TerminalUiStatus;
  runId?: string;
  turnCount: number;
  loopIndex: number;
  stepIndex: number;
  compactToolOutput: boolean;
  toolEventCount: number;
  totalUsage?: Usage;
  completionReason?: string;
  completionMessage?: string;
  errorMessage?: string;
  inputPlaceholder: string;
  updatedAt: number;
}

export type TerminalUiEvent =
  | {
      type: 'init';
      sessionId: string;
      modelId?: string;
      now?: number;
    }
  | {
      type: 'message.user';
      text: string;
      now?: number;
    }
  | {
      type: 'message.system';
      text: string;
      now?: number;
    }
  | {
      type: 'run.start';
      runId: string;
      prompt: string;
      now?: number;
    }
  | {
      type: 'stream.text';
      text: string;
      isReasoning?: boolean;
      messageId?: string;
      now?: number;
    }
  | {
      type: 'assistant.snapshot';
      messageId?: string;
      content?: string;
      reasoningContent?: string;
      finishReason?: string;
      now?: number;
    }
  | {
      type: 'stream.tool';
      event: ToolStreamEvent;
      now?: number;
    }
  | {
      type: 'tool.confirm.request';
      request: ToolConfirmRequest;
      now?: number;
    }
  | {
      type: 'tool.confirm.decision';
      request: ToolConfirmRequest;
      decision: ToolConfirmDecision;
      now?: number;
    }
  | {
      type: 'step';
      loopIndex?: number;
      stepIndex: number;
      finishReason?: string;
      toolCallsCount: number;
      now?: number;
    }
  | {
      type: 'stop';
      reason: string;
      message?: string;
      now?: number;
    }
  | {
      type: 'run.finish';
      completionReason: string;
      completionMessage?: string;
      usage?: Usage;
      now?: number;
    }
  | {
      type: 'run.error';
      error: string;
      now?: number;
    }
  | {
      type: 'input.placeholder';
      text: string;
      now?: number;
    }
  | {
      type: 'setting.compactToolOutput';
      compact: boolean;
      now?: number;
    }
  | {
      type: 'exit';
      now?: number;
    };
