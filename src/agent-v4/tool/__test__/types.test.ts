import { describe, expect, it } from 'vitest';
import { AGENT_V4_TOOL_TYPES_MODULE } from '../types';
import type {
  Tool,
  ToolCall,
  ToolConfirmInfo,
  ToolDecision,
  ToolExecutionContext,
  ToolStreamEventInput,
} from '../types';

describe('tool/types runtime contract', () => {
  it('accepts representative typed objects', () => {
    const tool: Tool = {
      name: 'bash',
      description: 'run shell command',
      parameters: { type: 'object' },
    };

    const call: ToolCall = {
      id: 'call_1',
      type: 'function',
      index: 0,
      function: {
        name: 'bash',
        arguments: '{"command":"echo ok"}',
      },
    };

    const info: ToolConfirmInfo = {
      toolCallId: call.id,
      toolName: tool.name,
      arguments: call.function.arguments,
    };

    const decision: ToolDecision = { approved: true };
    const chunk: ToolStreamEventInput = { type: 'stdout', content: 'ok' };
    const context: ToolExecutionContext = {
      toolCallId: call.id,
      loopIndex: 1,
      agent: {},
      onChunk: () => undefined,
      onConfirm: async () => decision,
    };

    expect(tool.name).toBe('bash');
    expect(info.toolName).toBe('bash');
    expect(chunk.type).toBe('stdout');
    expect(context.loopIndex).toBe(1);
    expect(AGENT_V4_TOOL_TYPES_MODULE).toBe('agent-v4-tool-types');
  });
});
