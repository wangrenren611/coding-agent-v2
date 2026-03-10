import { describe, expect, it, beforeEach } from 'bun:test';

// 简单测试runtime模块的基础功能
describe('runtime module exports', () => {
  it('should have expected exports', async () => {
    // 动态导入以避免全局模拟问题
    const runtimeModule = await import('./runtime');

    expect(typeof runtimeModule.runAgentPrompt).toBe('function');
    expect(typeof runtimeModule.getAgentModelLabel).toBe('function');
    expect(typeof runtimeModule.getAgentModelId).toBe('function');
    expect(typeof runtimeModule.listAgentModels).toBe('function');
    expect(typeof runtimeModule.switchAgentModel).toBe('function');
    expect(typeof runtimeModule.disposeAgentRuntime).toBe('function');
  });
});
