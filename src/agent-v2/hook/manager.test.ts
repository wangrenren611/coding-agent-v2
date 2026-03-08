import { describe, it, expect, beforeEach } from 'vitest';
import { HookManager } from './manager';
import { Plugin } from './types';
import { createInitialState } from '../state';

describe('HookManager', () => {
    let hookManager: HookManager;
    const mockContext = {
        stepIndex: 1,
        sessionId: 'test-session',
        state: createInitialState(),
    };

    beforeEach(() => {
        hookManager = new HookManager();
    });

    describe('基础功能', () => {
        it('应该创建一个空的 HookManager', () => {
            expect(hookManager.getPlugins()).toHaveLength(0);
        });

        it('应该正确注册单个插件', () => {
            const plugin: Plugin = {
                name: 'test-plugin',
                step: async () => {},
            };
            
            hookManager.use(plugin);
            
            expect(hookManager.getPlugins()).toHaveLength(1);
            expect(hookManager.getPlugins()[0].name).toBe('test-plugin');
        });

        it('应该正确批量注册插件', () => {
            const plugins: Plugin[] = [
                { name: 'plugin-1', step: async () => {} },
                { name: 'plugin-2', step: async () => {} },
            ];
            
            hookManager.useMany(plugins);
            
            expect(hookManager.getPlugins()).toHaveLength(2);
        });

        it('应该正确移除插件', () => {
            const plugin: Plugin = { name: 'test-plugin', step: async () => {} };
            hookManager.use(plugin);
            
            const result = hookManager.remove('test-plugin');
            
            expect(result).toBe(true);
            expect(hookManager.getPlugins()).toHaveLength(0);
        });

        it('移除不存在的插件应返回 false', () => {
            const result = hookManager.remove('non-existent');
            expect(result).toBe(false);
        });
    });

    describe('Step Hook', () => {
        it('应该正确执行 step hooks', async () => {
            let executed = false;
            const plugin: Plugin = {
                name: 'test',
                step: async () => { executed = true; },
            };
            
            hookManager.use(plugin);
            await hookManager.executeStepHooks({ stepIndex: 1, finishReason: 'stop', toolCallsCount: 0 }, mockContext);
            
            expect(executed).toBe(true);
        });

        it('应该执行多个 step hooks', async () => {
            const order: number[] = [];
            const plugins: Plugin[] = [
                { name: 'first', step: async () => { order.push(1); } },
                { name: 'second', step: async () => { order.push(2); } },
            ];
            
            hookManager.useMany(plugins);
            await hookManager.executeStepHooks({ stepIndex: 1, finishReason: 'stop', toolCallsCount: 0 }, mockContext);
            
            expect(order).toEqual([1, 2]);
        });

        it('hook 错误不应中断执行', async () => {
            const plugin1: Plugin = {
                name: 'error-plugin',
                step: async () => { throw new Error('Test error'); },
            };
            let plugin2Executed = false;
            const plugin2: Plugin = {
                name: 'normal-plugin',
                step: async () => { plugin2Executed = true; },
            };
            
            hookManager.useMany([plugin1, plugin2]);
            
            await expect(
                hookManager.executeStepHooks({ stepIndex: 1, finishReason: 'stop', toolCallsCount: 0 }, mockContext)
            ).resolves.not.toThrow();
            expect(plugin2Executed).toBe(true);
        });
    });

    describe('Stop Hook', () => {
        it('应该正确执行 stop hooks', async () => {
            let executed = false;
            const plugin: Plugin = {
                name: 'test',
                stop: async () => { executed = true; },
            };
            
            hookManager.use(plugin);
            await hookManager.executeStopHooks({ reason: 'completed' }, mockContext);
            
            expect(executed).toBe(true);
        });
    });

    describe('LLM Config Hook', () => {
        it('应该正确执行 llmConfig hooks', async () => {
            let capturedConfig: any;
            const plugin: Plugin = {
                name: 'test',
                llmConfig: async (config) => {
                    capturedConfig = config;
                    return { ...config, temperature: 0.8 };
                },
            };
            
            hookManager.use(plugin);
            const result = await hookManager.executeLLMConfigHooks({ temperature: 0.5 }, mockContext);
            
            expect(capturedConfig?.temperature).toBe(0.5);
            expect(result.temperature).toBe(0.8);
        });

        it('应该链式执行多个 llmConfig hooks', async () => {
            const plugins: Plugin[] = [
                { name: 'first', llmConfig: async (config) => ({ ...config, temperature: 0.6 }) },
                { name: 'second', llmConfig: async (config) => ({ ...config, temperature: config.temperature! + 0.1 }) },
            ];
            
            hookManager.useMany(plugins);
            const result = await hookManager.executeLLMConfigHooks({ temperature: 0.5 }, mockContext);
            
            expect(result.temperature).toBe(0.7);
        });
    });

    describe('MessageList Hook', () => {
        it('应该正确执行 messageList hooks', async () => {
            const mockMessages = { length: 0 } as any;
            let captured: any;
            
            const plugin: Plugin = {
                name: 'test',
                messageList: async (messages) => {
                    captured = messages;
                    return { ...messages, length: 1 } as any;
                },
            };
            
            hookManager.use(plugin);
            const result = await hookManager.executeMessageListHooks(mockMessages, mockContext);
            
            expect(captured).toBe(mockMessages);
            expect(result.length).toBe(1);
        });
    });

    describe('Tool Hooks', () => {
        it('应该正确执行 toolUse hooks', async () => {
            const toolCall = { id: 'tool_1', name: 'test', arguments: '{}' };
            let captured: any;
            
            const plugin: Plugin = {
                name: 'test',
                toolUse: async (tc) => {
                    captured = tc;
                    return { ...tc, name: 'modified' };
                },
            };
            
            hookManager.use(plugin);
            const result = await hookManager.executeToolUseHooks(toolCall as any, mockContext);
            
            expect(captured).toBe(toolCall);
            expect(result.name).toBe('modified');
        });

        it('应该正确执行 toolResult hooks', async () => {
            const toolCall = { id: 'tool_1', name: 'test', arguments: '{}' };
            const result = { toolCall, result: { id: 'tool_1', result: 'original', isError: false } };
            
            let captured: any;
            const plugin: Plugin = {
                name: 'test',
                toolResult: async (r) => {
                    captured = r;
                    return { ...r, result: { ...r.result, result: 'modified' } };
                },
            };
            
            hookManager.use(plugin);
            const final = await hookManager.executeToolResultHooks(result as any, mockContext);
            
            expect(captured).toBe(result);
            expect(final.result.result).toBe('modified');
        });
    });

    describe('Plugin 链式调用', () => {
        it('use 方法应返回 this 支持链式调用', () => {
            const result = hookManager
                .use({ name: 'p1', step: async () => {} })
                .use({ name: 'p2', step: async () => {} });
            
            expect(result).toBe(hookManager);
            expect(hookManager.getPlugins()).toHaveLength(2);
        });

        it('useMany 方法应返回 this 支持链式调用', () => {
            const result = hookManager.useMany([
                { name: 'p1', step: async () => {} },
                { name: 'p2', step: async () => {} },
            ]);
            
            expect(result).toBe(hookManager);
            expect(hookManager.getPlugins()).toHaveLength(2);
        });
    });
});
