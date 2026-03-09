/**
 * 本地文件存储实现
 *
 * 参考 OpenClaw 的 "No-DB Persistence" 设计
 * 使用 JSON 文件存储会话和消息
 */

import * as fs from 'fs';
import * as path from 'path';
import type { StorageBackend, StorageOptions, Session } from './storage';
import type { Message } from './message';
import type { AgentLoopState } from './types';

export interface FileStorageOptions extends StorageOptions {
  storagePath?: string;
}

export class FileStorage implements StorageBackend {
  options: StorageOptions;
  private basePath: string;
  private sessionsPath: string;
  private messagesPath: string;
  private statesPath: string;

  constructor(options?: FileStorageOptions) {
    this.options = options || {};
    const defaultPath = process.env.OPENCLAW_DATA_PATH || './data';
    this.basePath = options?.storagePath || defaultPath;
    this.sessionsPath = path.join(this.basePath, 'sessions');
    this.messagesPath = path.join(this.basePath, 'messages');
    this.statesPath = path.join(this.basePath, 'states');
  }

  async initialize(): Promise<void> {
    await this.ensureDir(this.basePath);
    await this.ensureDir(this.sessionsPath);
    await this.ensureDir(this.messagesPath);
    await this.ensureDir(this.statesPath);
  }

  private async ensureDir(dirPath: string): Promise<void> {
    try {
      await fs.promises.access(dirPath);
    } catch {
      await fs.promises.mkdir(dirPath, { recursive: true });
    }
  }

  private getSessionFilePath(sessionId: string): string {
    return path.join(this.sessionsPath, `${sessionId}.json`);
  }

  private getMessageFilePath(sessionId: string): string {
    return path.join(this.messagesPath, `${sessionId}.json`);
  }

  private getStateFilePath(sessionId: string): string {
    return path.join(this.statesPath, `${sessionId}.json`);
  }

  async saveMessage(message: Message): Promise<void> {
    const sessionId = message.sessionId || 'default';
    const filePath = this.getMessageFilePath(sessionId);

    let messages: Message[] = [];
    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      messages = JSON.parse(data);
    } catch {
      messages = [];
    }

    const existingIndex = messages.findIndex((m) => m.messageId === message.messageId);
    if (existingIndex >= 0) {
      messages[existingIndex] = message;
    } else {
      messages.push(message);
    }

    await fs.promises.writeFile(filePath, JSON.stringify(messages, null, 2), 'utf-8');
  }

  async updateMessage(messageId: string, updates: Partial<Message>): Promise<void> {
    const messages = await this.getAllMessages();
    const index = messages.findIndex((m) => m.messageId === messageId);

    if (index >= 0) {
      messages[index] = { ...messages[index], ...updates };
      const sessionId = messages[index].sessionId || 'default';
      await fs.promises.writeFile(
        this.getMessageFilePath(sessionId),
        JSON.stringify(messages, null, 2),
        'utf-8'
      );
    }
  }

  async getMessage(messageId: string): Promise<Message | null> {
    const messages = await this.getAllMessages();
    return messages.find((m) => m.messageId === messageId) || null;
  }

  private async getAllMessages(): Promise<Message[]> {
    try {
      const files = await fs.promises.readdir(this.messagesPath);
      const allMessages: Message[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.messagesPath, file);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        const messages = JSON.parse(data) as Message[];
        allMessages.push(...messages);
      }

      return allMessages;
    } catch {
      return [];
    }
  }

  async getMessages(sessionId: string): Promise<Message[]> {
    const filePath = this.getMessageFilePath(sessionId);

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return [];
    }
  }

  async saveSession(session: Session): Promise<void> {
    const filePath = this.getSessionFilePath(session.id);
    await fs.promises.writeFile(filePath, JSON.stringify(session, null, 2), 'utf-8');
  }

  async getSession(sessionId: string): Promise<Session | null> {
    const filePath = this.getSessionFilePath(sessionId);

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async getAllSessions(): Promise<Session[]> {
    try {
      const files = await fs.promises.readdir(this.sessionsPath);
      const sessions: Session[] = [];

      for (const file of files) {
        if (!file.endsWith('.json')) continue;
        const filePath = path.join(this.sessionsPath, file);
        const data = await fs.promises.readFile(filePath, 'utf-8');
        sessions.push(JSON.parse(data));
      }

      return sessions;
    } catch {
      return [];
    }
  }

  async deleteSession(sessionId: string): Promise<void> {
    const sessionPath = this.getSessionFilePath(sessionId);
    const messagePath = this.getMessageFilePath(sessionId);
    const statePath = this.getStateFilePath(sessionId);

    try {
      await fs.promises.unlink(sessionPath);
    } catch {}

    try {
      await fs.promises.unlink(messagePath);
    } catch {}

    try {
      await fs.promises.unlink(statePath);
    } catch {}
  }

  async saveState(sessionId: string, state: AgentLoopState): Promise<void> {
    const filePath = this.getStateFilePath(sessionId);
    await fs.promises.writeFile(filePath, JSON.stringify(state, null, 2), 'utf-8');
  }

  async getState(sessionId: string): Promise<AgentLoopState | null> {
    const filePath = this.getStateFilePath(sessionId);

    try {
      const data = await fs.promises.readFile(filePath, 'utf-8');
      return JSON.parse(data);
    } catch {
      return null;
    }
  }

  async close(): Promise<void> {
    // 无需关闭文件句柄
  }
}

export function createFileStorage(options?: FileStorageOptions): StorageBackend {
  return new FileStorage(options);
}
