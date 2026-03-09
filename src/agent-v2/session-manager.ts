/**
 * 会话管理器
 *
 * 负责会话的创建、恢复、保存快照
 */

import type { Message } from './message';
import type { AgentLoopState } from './types';
import type { StorageBackend, Session } from './storage';

export interface SessionManagerOptions {
  storage: StorageBackend;
  autoSaveInterval?: number;
  autoSaveEnabled?: boolean;
}

export class SessionManager {
  private storage: StorageBackend;
  private currentSession?: Session;
  private autoSaveTimer?: NodeJS.Timeout;
  private autoSaveInterval: number;
  private autoSaveEnabled: boolean;
  private dirty: boolean = false;

  constructor(options: SessionManagerOptions) {
    this.storage = options.storage;
    this.autoSaveInterval = options.autoSaveInterval || 5000;
    this.autoSaveEnabled = options.autoSaveEnabled ?? true;
  }

  async initialize(): Promise<void> {
    await this.storage.initialize();

    if (this.autoSaveEnabled) {
      this.startAutoSave();
    }
  }

  async createSession(sessionId: string, initialState?: AgentLoopState): Promise<Session> {
    const session: Session = {
      id: sessionId,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      messages: [],
      state: initialState,
    };

    await this.storage.saveSession(session);
    this.currentSession = session;
    this.dirty = false;

    return session;
  }

  async resumeSession(sessionId: string): Promise<Session | null> {
    const session = await this.storage.getSession(sessionId);

    if (session) {
      this.currentSession = session;
      this.dirty = false;
    }

    return session;
  }

  async saveSnapshot(state: AgentLoopState): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.state = state;
    this.currentSession.updatedAt = Date.now();
    await this.storage.saveSession(this.currentSession);
    this.dirty = false;
  }

  async addMessage(message: Message): Promise<void> {
    if (!this.currentSession) return;

    this.currentSession.messages.push(message);
    this.currentSession.updatedAt = Date.now();
    this.dirty = true;
  }

  async updateMessage(messageId: string, updates: Partial<Message>): Promise<void> {
    if (!this.currentSession) return;

    const index = this.currentSession.messages.findIndex((m) => m.messageId === messageId);

    if (index >= 0) {
      this.currentSession.messages[index] = {
        ...this.currentSession.messages[index],
        ...updates,
      } as Message;
      this.currentSession.updatedAt = Date.now();
      this.dirty = true;
    }
  }

  async flush(): Promise<void> {
    if (!this.currentSession || !this.dirty) return;

    await this.storage.saveSession(this.currentSession);
    this.dirty = false;
  }

  getCurrentSession(): Session | undefined {
    return this.currentSession;
  }

  getSessionId(): string | undefined {
    return this.currentSession?.id;
  }

  isDirty(): boolean {
    return this.dirty;
  }

  private startAutoSave(): void {
    this.autoSaveTimer = setInterval(async () => {
      if (this.dirty) {
        await this.flush();
      }
    }, this.autoSaveInterval);
  }

  async close(): Promise<void> {
    if (this.autoSaveTimer) {
      clearInterval(this.autoSaveTimer);
    }

    if (this.dirty) {
      await this.flush();
    }

    await this.storage.close();
  }
}

export function createSessionManager(options: SessionManagerOptions): SessionManager {
  return new SessionManager(options);
}
