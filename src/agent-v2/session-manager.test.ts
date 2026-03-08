import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManager, createSessionManager } from './session-manager';
import { StorageBackend, Session } from './storage';
import { createInitialState } from './state';
import { MessageFactory } from './message';

class MockStorage implements StorageBackend {
    options = {};
    private sessions: Map<string, Session> = new Map();

    async initialize(): Promise<void> {}
    
    async saveMessage(): Promise<void> {}
    async updateMessage(): Promise<void> {}
    async getMessage(): Promise<any> { return null; }
    async getMessages(): Promise<any[]> { return []; }
    
    async saveSession(session: Session): Promise<void> {
        this.sessions.set(session.id, session);
    }
    
    async getSession(sessionId: string): Promise<Session | null> {
        return this.sessions.get(sessionId) || null;
    }
    
    async getAllSessions(): Promise<Session[]> {
        return Array.from(this.sessions.values());
    }
    
    async deleteSession(sessionId: string): Promise<void> {
        this.sessions.delete(sessionId);
    }
    
    async saveState(): Promise<void> {}
    async getState(): Promise<any> { return null; }
    async close(): Promise<void> {}
}

describe('SessionManager', () => {
    let sessionManager: SessionManager;
    let mockStorage: MockStorage;

    beforeEach(() => {
        mockStorage = new MockStorage();
        sessionManager = createSessionManager({
            storage: mockStorage,
            autoSaveEnabled: false,
        });
    });

    describe('初始化', () => {
        it('应该正确初始化', async () => {
            await sessionManager.initialize();
            expect(sessionManager.getSessionId()).toBeUndefined();
        });

        it('应该创建新会话', async () => {
            await sessionManager.initialize();
            const state = createInitialState();
            
            const session = await sessionManager.createSession('test-session', state);
            
            expect(session.id).toBe('test-session');
            expect(session.state).toBe(state);
            expect(session.messages).toHaveLength(0);
        });

        it('应该恢复已存在的会话', async () => {
            await sessionManager.initialize();
            const state = createInitialState();
            
            await sessionManager.createSession('test-session', state);
            const resumed = await sessionManager.resumeSession('test-session');
            
            expect(resumed).not.toBeNull();
            expect(resumed?.id).toBe('test-session');
        });

        it('恢复不存在的会话应返回 null', async () => {
            await sessionManager.initialize();
            
            const session = await sessionManager.resumeSession('non-existent');
            
            expect(session).toBeNull();
        });
    });

    describe('消息管理', () => {
        beforeEach(async () => {
            await sessionManager.initialize();
            await sessionManager.createSession('test-session');
        });

        it('应该添加消息', async () => {
            const message = MessageFactory.createUserMessage('Hello');
            
            await sessionManager.addMessage(message);
            
            const session = sessionManager.getCurrentSession();
            expect(session?.messages).toHaveLength(1);
            expect(session?.messages[0].content).toBe('Hello');
        });

        it('应该更新消息', async () => {
            const message = MessageFactory.createUserMessage('Original');
            await sessionManager.addMessage(message);
            
            await sessionManager.updateMessage(message.messageId, { content: 'Updated' });
            
            const session = sessionManager.getCurrentSession();
            expect(session?.messages[0].content).toBe('Updated');
        });

        it('dirty 标志应该在消息变更后变为 true', async () => {
            expect(sessionManager.isDirty()).toBe(false);
            
            const message = MessageFactory.createUserMessage('Test');
            await sessionManager.addMessage(message);
            
            expect(sessionManager.isDirty()).toBe(true);
        });
    });

    describe('快照管理', () => {
        beforeEach(async () => {
            await sessionManager.initialize();
            await sessionManager.createSession('test-session');
        });

        it('应该保存快照', async () => {
            const state = createInitialState();
            state.stepIndex = 5;
            
            await sessionManager.saveSnapshot(state);
            
            const session = await mockStorage.getSession('test-session');
            expect(session?.state?.stepIndex).toBe(5);
        });

        it('flush 应该保存会话', async () => {
            const message = MessageFactory.createUserMessage('Test');
            await sessionManager.addMessage(message);
            
            await sessionManager.flush();
            
            const session = await mockStorage.getSession('test-session');
            expect(session?.messages).toHaveLength(1);
            expect(sessionManager.isDirty()).toBe(false);
        });
    });

    describe('当前会话信息', () => {
        it('应该返回当前会话 ID', async () => {
            await sessionManager.initialize();
            await sessionManager.createSession('my-session');
            
            expect(sessionManager.getSessionId()).toBe('my-session');
        });

        it('未初始化时应返回 undefined', () => {
            expect(sessionManager.getSessionId()).toBeUndefined();
        });

        it('应该返回当前会话副本', async () => {
            await sessionManager.initialize();
            await sessionManager.createSession('test');
            
            const session = sessionManager.getCurrentSession();
            expect(session?.id).toBe('test');
        });
    });

    describe('生命周期', () => {
        it('应该正确关闭', async () => {
            await sessionManager.initialize();
            await sessionManager.createSession('test');
            
            await expect(sessionManager.close()).resolves.not.toThrow();
        });
    });
});
