import { describe, expect, it, vi } from 'vitest';

import { resolveAutoToolDecision, resolveToolConfirmDecision } from './tool-confirmation';
import type { AgentEventHandlers, AgentToolConfirmEvent } from './types';

const TOOL_CONFIRM_EVENT: AgentToolConfirmEvent = {
  toolCallId: 'call_1',
  toolName: 'glob',
  args: {
    pattern: '**/*sandbox*',
    path: '/tmp/project',
  },
  rawArgs: {
    pattern: '**/*sandbox*',
    path: '/tmp/project',
  },
  reason: 'SEARCH_PATH_NOT_ALLOWED: /tmp/project is outside allowed directories: /workspace',
  metadata: {
    requestedPath: '/tmp/project',
    allowedDirectories: ['/workspace'],
  },
};

describe('resolveAutoToolDecision', () => {
  it('returns approve for truthy values', () => {
    expect(resolveAutoToolDecision('true')).toEqual({ approved: true });
    expect(resolveAutoToolDecision('1')).toEqual({ approved: true });
  });

  it('returns deny for falsey values', () => {
    expect(resolveAutoToolDecision('false')).toEqual({
      approved: false,
      message: 'Tool call denied by AGENT_AUTO_CONFIRM_TOOLS.',
    });
  });

  it('returns null when no auto decision is configured', () => {
    expect(resolveAutoToolDecision(undefined)).toBeNull();
    expect(resolveAutoToolDecision('')).toBeNull();
  });
});

describe('resolveToolConfirmDecision', () => {
  it('prefers configured auto decision over UI callback', async () => {
    const onToolConfirmRequest = vi.fn();
    const decision = await resolveToolConfirmDecision(
      TOOL_CONFIRM_EVENT,
      { onToolConfirmRequest },
      'true'
    );

    expect(decision).toEqual({ approved: true });
    expect(onToolConfirmRequest).not.toHaveBeenCalled();
  });

  it('asks the UI callback when no auto decision is configured', async () => {
    const onToolConfirmRequest: NonNullable<AgentEventHandlers['onToolConfirmRequest']> = vi.fn(
      async () => ({
        approved: false,
        message: 'Denied by user',
      })
    );

    const decision = await resolveToolConfirmDecision(
      TOOL_CONFIRM_EVENT,
      { onToolConfirmRequest },
      undefined
    );

    expect(decision).toEqual({
      approved: false,
      message: 'Denied by user',
    });
    expect(onToolConfirmRequest).toHaveBeenCalledWith(TOOL_CONFIRM_EVENT);
  });

  it('falls back to approve when no UI callback is registered', async () => {
    await expect(resolveToolConfirmDecision(TOOL_CONFIRM_EVENT, {}, undefined)).resolves.toEqual({
      approved: true,
    });
  });
});
