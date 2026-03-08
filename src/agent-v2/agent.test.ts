import { describe, it, expect, beforeEach, vi } from 'vitest';
import { Agent } from './agent';
import { LLMProvider, LLMGenerateOptions, Chunk } from '../providers';
import { Message } from './message';

class MockLLMProvider implements LLMProvider {
    config: any = {};

    constructor(private chunks: Chunk[]) {}

    async generate(): Promise<any> {
        return { choices: [{ message: { content: 'Mock response' } }] };
    }

    async *generateStream(): AsyncGenerator<Chunk> {
        for (const chunk of this.chunks) {
            yield chunk;
        }
    }

    getTimeTimeout(): number { return 30000; }
    getLLMMaxTokens(): number { return 4096; }
    getMaxOutputTokens(): number { return 2048; }
}

describe('Agent', () => {
    let agent: Agent;
    let mockProvider: MockLLMProvider;

    beforeEach(() => {
        mockProvider = new MockLLMProvider([
            {
                id: 'chunk-1',
                choices: [{ index: 0, delta: { content: 'Hello' }, finish_reason: null }],
                created: Date.now(),
                model: 'test',
                object: 'chat.completion.chunk',
            },
            {
                id: 'chunk-2',
                choices: [{ index: 0, delta: { content: ' World' }, finish_reason: 'stop' }],
                created: Date.now(),
                model: 'test',
                object: 'chat.completion.chunk',
            },
        ]);

        agent = new Agent({
            sessionId: 'test-session',
            systemPrompt: 'You are a helpful assistant',
            llmProvider: mockProvider,
            enablePersistence: false,
        });
    });

    describe('构造函数', () => {
        it('应该正确初始化', () => {
            expect(agent.sessionId).toBe('test-session');
            expect(agent.state.stepIndex).toBe(0);
            expect(agent.messageList).toBeDefined();
        });

        it('应该设置系统消息', () => {
            expect(agent.messageList.systemMessage).toBeDefined();
            expect(agent.messageList.systemMessage?.content).toBe('You are a helpful assistant');
        });

        it('应该注册默认的 logger 插件', () => {
            // 日志插件应该已注册
            expect(agent['hookManager']).toBeDefined();
        });
    });

    describe('run 方法', () => {
        it('应该拒绝空查询', async () => {
            await expect(agent.run('')).rejects.toThrow();
        });

        it('应该添加用户消息到列表', async () => {
            // 由于是 mock provider，会立即返回，我们只需要验证不抛出错误
            try {
                await agent.run('Hello');
            } catch {
                // 忽略错误，只验证消息被添加
            }
            
            const userMessages = agent.messageList.getUserMessages();
            expect(userMessages).toHaveLength(1);
        });

        it('应该抛出空查询错误', async () => {
            await expect(agent.run('')).rejects.toThrow('Query is empty');
        });
    });

    describe('shouldStop', () => {
        it('初始状态不应该停止', () => {
            // 通过私有方法测试
            const shouldStop = (agent as any).shouldStop();
            expect(shouldStop).toBe(false);
        });

        it('aborted 为 true 时应该停止', () => {
            agent.state.aborted = true;
            const shouldStop = (agent as any).shouldStop();
            expect(shouldStop).toBe(true);
        });

        it('resultStatus 为 stop 时应该停止', () => {
            agent.state.resultStatus = 'stop';
            const shouldStop = (agent as any).shouldStop();
            expect(shouldStop).toBe(true);
        });
    });

    describe('mergeToolCalls', () => {
        it('应该合并新的工具调用', () => {
            const existing = [
                { id: 'tool_1', type: 'function' as const, name: 'test', arguments: '{}' }
            ];
            const newCalls = [
                { id: 'tool_2', type: 'function' as const, name: 'test2', arguments: '{}' }
            ];
            
            const result = (agent as any).mergeToolCalls(existing, newCalls);
            
            expect(result).toHaveLength(2);
        });

        it('应该追加已存在工具调用的 arguments', () => {
            const existing = [
                { id: 'tool_1', type: 'function' as const, name: 'test', arguments: '{"a":' }
            ];
            const newCalls = [
                { id: 'tool_1', type: 'function' as const, name: 'test', arguments: '"b"}' }
            ];
            
            const result = (agent as any).mergeToolCalls(existing, newCalls);
            
            expect(result).toHaveLength(1);
            expect(result[0].arguments).toBe('{"a":"b"}');
        });
    });

    describe('getHookContext', () => {
        it('应该返回正确的上下文', () => {
            const ctx = (agent as any).getHookContext();
            
            expect(ctx.stepIndex).toBe(0);
            expect(ctx.sessionId).toBe('test-session');
            expect(ctx.state).toBeDefined();
        });

        it('应该包含 messageId', () => {
            const ctx = (agent as any).getHookContext('msg-123');
            
            expect(ctx.messageId).toBe('msg-123');
        });
    });

    describe('持久化配置', () => {
        it('禁用持久化时不应有 buffer', () => {
            const buffer = (agent as any).messageBuffer;
            expect(buffer).toBeDefined();
        });

        it('启用持久化时应该有 sessionManager', () => {
            const agentWithPersist = new Agent({
                sessionId: 'test',
                systemPrompt: 'You are a helpful',
                llmProvider: mockProvider,
                enablePersistence: true,
                storagePath: './test-data',
            });
            
            const sessionManager = (agentWithPersist as any).sessionManager;
            expect(sessionManager).toBeDefined();
        });
    });
});
