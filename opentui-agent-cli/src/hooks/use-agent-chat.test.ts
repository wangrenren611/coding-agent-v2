import { describe, expect, it, beforeEach, afterEach } from 'bun:test';
import { act, renderHook } from '@testing-library/react';

import type { AgentToolConfirmEvent } from '../agent/runtime/types';
import { useAgentChat } from './use-agent-chat';

// Mock dependencies
const mockResolveSlashCommand = vi.fn();
const mockGetAgentModelLabel = vi.fn();
const mockRunAgentPrompt = vi.fn();
const mockRequestExit = vi.fn();
const mockBuildAgentEventHandlers = vi.fn();

// Set up vi.fn if not available (for Bun test runner)
const vi = globalThis.vi || {
  fn: (impl?: any) => {
    const fn = (...args: any[]) => {
      fn.mock.calls.push(args);
      return impl ? impl(...args) : undefined;
    };
    fn.mock = { calls: [] };
    fn.mockReturnValue = (value: any) => {
      return vi.fn(() => value);
    };
    fn.mockResolvedValue = (value: any) => {
      return vi.fn(() => Promise.resolve(value));
    };
    fn.mockImplementation = (impl: any) => {
      return vi.fn(impl);
    };
    return fn;
  },
  clearAllMocks: () => {},
  restoreAllMocks: () => {},
};

// Mock modules
vi.fn(() => ({
  resolveSlashCommand: mockResolveSlashCommand,
}));

vi.fn(() => ({
  getAgentModelLabel: mockGetAgentModelLabel,
  runAgentPrompt: mockRunAgentPrompt,
}));

vi.fn(() => ({
  requestExit: mockRequestExit,
}));

vi.fn(() => ({
  buildAgentEventHandlers: mockBuildAgentEventHandlers,
}));

vi.fn(() => ({
  buildHelpSegments: vi.fn(),
  buildUnsupportedSegments: vi.fn(),
  extractErrorMessage: vi.fn(),
}));

vi.fn(() => ({
  appendNoteLine: vi.fn(),
  appendToSegment: vi.fn(),
  createStreamingReply: vi.fn(),
  orderReplySegments: vi.fn(),
  patchTurn: vi.fn(),
  setReplyStatus: vi.fn(),
}));

describe('useAgentChat', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    
    // Default mocks
    mockGetAgentModelLabel.mockResolvedValue('glm-5');
    mockResolveSlashCommand.mockReturnValue(null);
    mockRunAgentPrompt.mockImplementation(async (prompt, handlers) => {
      // Simulate some thinking
      handlers.onTextDelta?.({ text: 'Thinking...', isReasoning: true });
      handlers.onTextDelta?.({ text: 'Response', isReasoning: false });
      handlers.onTextComplete?.('');
      return { success: true };
    });
    
    mockBuildAgentEventHandlers.mockReturnValue({
      onTextDelta: vi.fn(),
      onTextComplete: vi.fn(),
      onToolUse: vi.fn(),
      onToolStream: vi.fn(),
      onToolResult: vi.fn(),
      onToolConfirm: vi.fn(),
      onUsage: vi.fn(),
      onFinish: vi.fn(),
      onError: vi.fn(),
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should initialize with default state', () => {
    const { result } = renderHook(() => useAgentChat());

    expect(result.current.turns).toEqual([]);
    expect(result.current.inputValue).toBe('');
    expect(result.current.isThinking).toBe(false);
    expect(result.current.modelLabel).toBe('glm-5'); // Default from mock
    expect(result.current.contextUsagePercent).toBe(null);
    expect(result.current.pendingToolConfirm).toBe(null);
  });

  it('should update input value', () => {
    const { result } = renderHook(() => useAgentChat());

    act(() => {
      result.current.setInputValue('test input');
    });

    expect(result.current.inputValue).toBe('test input');
  });

  it('should clear input', () => {
    const { result } = renderHook(() => useAgentChat());

    act(() => {
      result.current.setInputValue('test input');
    });
    expect(result.current.inputValue).toBe('test input');

    act(() => {
      result.current.clearInput();
    });
    expect(result.current.inputValue).toBe('');
  });
});