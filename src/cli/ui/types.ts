import type { ToolConfirmRequest } from '../../tool';

export type ChatRole = 'system' | 'user' | 'assistant';
export type ActivityLevel = 'info' | 'warn' | 'error' | 'tool';
export type ActivityKind = 'log' | 'tool_call' | 'tool_output';
export type PanelMode = 'split' | 'conversation' | 'activity';
export type InputMode = 'prompt' | 'bash' | 'memory' | 'plan' | 'brainstorm';
export type AppStatus = 'idle' | 'processing' | 'failed' | 'exit';

export interface ChatLine {
  id: string;
  seq: number;
  role: ChatRole;
  text: string;
}

export interface ActivityEvent {
  id: string;
  seq: number;
  level: ActivityLevel;
  text: string;
  time: string;
  kind?: ActivityKind;
  indent?: number;
  toolCallId?: string;
}

export interface PendingConfirm {
  request: ToolConfirmRequest;
}

export interface SuggestionItem {
  type: 'slash' | 'file';
  value: string;
  title: string;
  description?: string;
}
