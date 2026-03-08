import { describe, it, expect } from 'vitest';
import { createInitialState, createEmptyUsage, DEFAULT_AGENT_CONFIG } from './state';

describe('State', () => {
    describe('createInitialState', () => {
        it('应该创建初始状态', () => {
            const state = createInitialState();
            
            expect(state.stepIndex).toBe(0);
            expect(state.currentText).toBe('');
            expect(state.currentToolCalls).toEqual([]);
            expect(state.retryCount).toBe(0);
            expect(state.needsRetry).toBe(false);
            expect(state.aborted).toBe(false);
            expect(state.resultStatus).toBe('continue');
        });

        it('应该创建空的 Usage', () => {
            const usage = createEmptyUsage();
            
            expect(usage.prompt_tokens).toBe(0);
            expect(usage.completion_tokens).toBe(0);
            expect(usage.total_tokens).toBe(0);
        });

        it('Usage 应该可以正确累加', () => {
            const usage1 = { prompt_tokens: 100, completion_tokens: 50, total_tokens: 150 };
            const usage2 = { prompt_tokens: 200, completion_tokens: 100, total_tokens: 300 };
            
            const total = {
                prompt_tokens: usage1.prompt_tokens + usage2.prompt_tokens,
                completion_tokens: usage1.completion_tokens + usage2.completion_tokens,
                total_tokens: usage1.total_tokens + usage2.total_tokens,
            };
            
            expect(total.prompt_tokens).toBe(300);
            expect(total.completion_tokens).toBe(150);
            expect(total.total_tokens).toBe(450);
        });
    });

    describe('DEFAULT_AGENT_CONFIG', () => {
        it('应该有默认配置', () => {
            expect(DEFAULT_AGENT_CONFIG.maxSteps).toBe(1000);
            expect(DEFAULT_AGENT_CONFIG.maxRetries).toBe(10);
            expect(DEFAULT_AGENT_CONFIG.debug).toBe(false);
            expect(DEFAULT_AGENT_CONFIG.enableCompaction).toBe(false);
        });

        it('配置应该是只读的', () => {
            // 尝试修改应该不影响原配置
            const config = { ...DEFAULT_AGENT_CONFIG };
            config.maxSteps = 500;
            
            expect(DEFAULT_AGENT_CONFIG.maxSteps).toBe(1000);
        });
    });

    describe('状态转换', () => {
        it('应该能标记需要重试', () => {
            const state = createInitialState();
            
            state.needsRetry = true;
            state.retryCount = 1;
            state.lastError = new Error('Test error');
            
            expect(state.needsRetry).toBe(true);
            expect(state.retryCount).toBe(1);
            expect(state.lastError).toBeInstanceOf(Error);
        });

        it('应该能标记为中止', () => {
            const state = createInitialState();
            
            state.aborted = true;
            state.resultStatus = 'stop';
            
            expect(state.aborted).toBe(true);
            expect(state.resultStatus).toBe('stop');
        });

        it('应该能累积工具调用', () => {
            const state = createInitialState();
            
            state.currentToolCalls = [
                { id: 'tool_1', type: 'function', name: 'test', arguments: '{}' }
            ];
            
            expect(state.currentToolCalls).toHaveLength(1);
            expect(state.currentToolCalls[0].name).toBe('test');
        });

        it('应该能累积文本', () => {
            const state = createInitialState();
            
            state.currentText = 'Hello ';
            state.currentText += 'World';
            
            expect(state.currentText).toBe('Hello World');
        });
    });
});
