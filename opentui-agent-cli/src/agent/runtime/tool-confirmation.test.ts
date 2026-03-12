import { describe, expect, it, vi } from 'vitest';

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

describe('resolveToolConfirmDecision', () => {
  it('asks the UI callback when registered', async () => {
    const { resolveToolConfirmDecision } =
      await vi.importActual<typeof import('./tool-confirmation')>('./tool-confirmation');
    const calls: AgentToolConfirmEvent[] = [];
    const onToolConfirmRequest: NonNullable<
      AgentEventHandlers['onToolConfirmRequest']
    > = async event => {
      calls.push(event);
      return {
        approved: false,
        message: 'Denied by user',
      };
    };

    const decision = await resolveToolConfirmDecision(TOOL_CONFIRM_EVENT, { onToolConfirmRequest });

    expect(decision).toEqual({
      approved: false,
      message: 'Denied by user',
    });
    expect(calls).toEqual([TOOL_CONFIRM_EVENT]);
  });

  it('falls back to approve when no UI callback is registered', async () => {
    const { resolveToolConfirmDecision } =
      await vi.importActual<typeof import('./tool-confirmation')>('./tool-confirmation');
    const decision = await resolveToolConfirmDecision(TOOL_CONFIRM_EVENT, {});

    expect(decision).toEqual({
      approved: true,
    });
  });
});
