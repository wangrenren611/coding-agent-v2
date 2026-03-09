/**
 * 存储层抽象接口
 *
 * 定义消息和会话的持久化接口，支持多种存储后端实现
 */

import type { Message } from './message';
import type { AgentLoopState } from './types';

export interface Session {
  id: string;
  createdAt: number;
  updatedAt: number;
  messages: Message[];
  state?: AgentLoopState;
  metadata?: Record<string, unknown>;
}

export interface StorageOptions {
  storagePath?: string;
}

export abstract class StorageBackend {
  abstract options: StorageOptions;

  abstract initialize(): Promise<void>;

  abstract saveMessage(message: Message): Promise<void>;

  abstract updateMessage(messageId: string, updates: Partial<Message>): Promise<void>;

  abstract getMessage(messageId: string): Promise<Message | null>;

  abstract getMessages(sessionId: string): Promise<Message[]>;

  abstract saveSession(session: Session): Promise<void>;

  abstract getSession(sessionId: string): Promise<Session | null>;

  abstract getAllSessions(): Promise<Session[]>;

  abstract deleteSession(sessionId: string): Promise<void>;

  abstract saveState(sessionId: string, state: AgentLoopState): Promise<void>;

  abstract getState(sessionId: string): Promise<AgentLoopState | null>;

  abstract close(): Promise<void>;
}

export function createStorage(options?: StorageOptions): StorageBackend {
  return new FileStorage(options);
}

class FileStorage extends StorageBackend {
  options: StorageOptions;

  constructor(options?: StorageOptions) {
    super();
    this.options = {
      storagePath: options?.storagePath || './data',
    };
  }

  async initialize(): Promise<void> {}

  async saveMessage(message: Message): Promise<void> {}

  async updateMessage(messageId: string, updates: Partial<Message>): Promise<void> {}

  async getMessage(messageId: string): Promise<Message | null> {
    return null;
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    return [];
  }

  async saveSession(session: Session): Promise<void> {}

  async getSession(sessionId: string): Promise<Session | null> {
    return null;
  }

  async getAllSessions(): Promise<Session[]> {
    return [];
  }

  async deleteSession(sessionId: string): Promise<void> {}

  async saveState(sessionId: string, state: AgentLoopState): Promise<void> {}

  async getState(sessionId: string): Promise<AgentLoopState | null> {
    return null;
  }

  async close(): Promise<void> {}
}
