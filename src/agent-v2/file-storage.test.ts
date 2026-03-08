import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { FileStorage, createFileStorage } from './file-storage';
import { MessageFactory } from './message';
import { createInitialState } from './state';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

describe('FileStorage', () => {
    let storage: FileStorage;
    let testDir: string;

    beforeEach(async () => {
        testDir = path.join(os.tmpdir(), `test-storage-${Date.now()}`);
        storage = createFileStorage({ storagePath: testDir });
        await storage.initialize();
    });

    afterEach(async () => {
        await storage.close();
        try {
            await fs.promises.rm(testDir, { recursive: true, force: true });
        } catch {}
    });

    describe('初始化', () => {
        it('应该创建必要的目录', async () => {
            const dirs = ['sessions', 'messages', 'states'];
            for (const dir of dirs) {
                const dirPath = path.join(testDir, dir);
                const exists = await fs.promises.access(dirPath).then(() => true).catch(() => false);
                expect(exists).toBe(true);
            }
        });
    });

    describe('会话管理', () => {
        it('应该保存会话', async () => {
            const session = {
                id: 'test-session',
                createdAt: Date.now(),
                updatedAt: Date.now(),
                messages: [],
            };
            
            await storage.saveSession(session);
            
            const loaded = await storage.getSession('test-session');
            expect(loaded?.id).toBe('test-session');
        });

        it('应该获取所有会话', async () => {
            await storage.saveSession({ id: 's1', createdAt: 1, updatedAt: 1, messages: [] });
            await storage.saveSession({ id: 's2', createdAt: 2, updatedAt: 2, messages: [] });
            
            const sessions = await storage.getAllSessions();
            expect(sessions).toHaveLength(2);
        });

        it('应该删除会话', async () => {
            await storage.saveSession({ id: 'to-delete', createdAt: 1, updatedAt: 1, messages: [] });
            
            await storage.deleteSession('to-delete');
            
            const session = await storage.getSession('to-delete');
            expect(session).toBeNull();
        });

        it('获取不存在的会话应返回 null', async () => {
            const session = await storage.getSession('non-existent');
            expect(session).toBeNull();
        });
    });

    describe('消息管理', () => {
        it('应该保存消息', async () => {
            const message = MessageFactory.createUserMessage('Hello');
            message.sessionId = 'test-session';
            
            await storage.saveMessage(message);
            
            const loaded = await storage.getMessage(message.messageId);
            expect(loaded?.content).toBe('Hello');
        });

        it('应该更新消息', async () => {
            const message = MessageFactory.createUserMessage('Original');
            message.sessionId = 'test-session';
            await storage.saveMessage(message);
            
            await storage.updateMessage(message.messageId, { content: 'Updated' });
            
            const loaded = await storage.getMessage(message.messageId);
            expect(loaded?.content).toBe('Updated');
        });

        it('应该获取会话的所有消息', async () => {
            const msg1 = MessageFactory.createUserMessage('1');
            const msg2 = MessageFactory.createUserMessage('2');
            msg1.sessionId = 'test-session';
            msg2.sessionId = 'test-session';
            
            await storage.saveMessage(msg1);
            await storage.saveMessage(msg2);
            
            const messages = await storage.getMessages('test-session');
            expect(messages).toHaveLength(2);
        });

        it('应该更新已存在的消息', async () => {
            const message = MessageFactory.createUserMessage('First');
            message.sessionId = 'test';
            await storage.saveMessage(message);
            
            message.content = 'Second';
            await storage.saveMessage(message);
            
            const messages = await storage.getMessages('test');
            expect(messages).toHaveLength(1);
            expect(messages[0].content).toBe('Second');
        });
    });

    describe('状态管理', () => {
        it('应该保存状态', async () => {
            const state = createInitialState();
            state.stepIndex = 5;
            
            await storage.saveState('test-session', state);
            
            const loaded = await storage.getState('test-session');
            expect(loaded?.stepIndex).toBe(5);
        });

        it('应该获取保存的状态', async () => {
            const state = createInitialState();
            await storage.saveState('test-session', state);
            
            const loaded = await storage.getState('test-session');
            expect(loaded).not.toBeNull();
        });

        it('获取不存在状态应返回 null', async () => {
            const state = await storage.getState('non-existent');
            expect(state).toBeNull();
        });
    });
});
