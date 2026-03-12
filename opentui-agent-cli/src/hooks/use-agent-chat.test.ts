import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../commands/slash-commands', () => ({
  resolveSlashCommand: vi.fn(),
}));

vi.mock('../agent/runtime/runtime', () => ({
  getAgentModelAttachmentCapabilities: vi.fn(),
  getAgentModelLabel: vi.fn(),
  runAgentPrompt: vi.fn(),
}));

vi.mock('../runtime/exit', () => ({
  requestExit: vi.fn(),
}));

import * as runtime from '../agent/runtime/runtime';
import { useAgentChat } from './use-agent-chat';

describe('useAgentChat', () => {
  const mockGetAgentModelLabel = runtime.getAgentModelLabel as unknown as ReturnType<typeof vi.fn>;
  const mockGetAgentModelAttachmentCapabilities =
    runtime.getAgentModelAttachmentCapabilities as unknown as ReturnType<typeof vi.fn>;
  const mockRunAgentPrompt = runtime.runAgentPrompt as unknown as ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetAgentModelLabel.mockResolvedValue('glm-5');
    mockGetAgentModelAttachmentCapabilities.mockResolvedValue({
      image: false,
      audio: false,
      video: false,
    });
    mockRunAgentPrompt.mockResolvedValue({ success: true });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('initializes with default state and resolves the model label', async () => {
    const { result } = renderHook(() => useAgentChat());

    expect(result.current.turns).toEqual([]);
    expect(result.current.inputValue).toBe('');
    expect(result.current.isThinking).toBe(false);
    expect(result.current.contextUsagePercent).toBe(null);
    expect(result.current.pendingToolConfirm).toBe(null);

    await waitFor(() => {
      expect(result.current.modelLabel).toBe('glm-5');
    });
  });

  it('updates input value', () => {
    const { result } = renderHook(() => useAgentChat());

    act(() => {
      result.current.setInputValue('test input');
    });

    expect(result.current.inputValue).toBe('test input');
  });

  it('clears input', () => {
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
