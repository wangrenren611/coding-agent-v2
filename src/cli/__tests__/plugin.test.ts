import { describe, expect, it } from 'vitest';
import { createTerminalUiAgentPlugin } from '../plugin';

describe('terminal ui plugin', () => {
  it('dispatches hook events as terminal ui events', async () => {
    const events: unknown[] = [];
    const plugin = createTerminalUiAgentPlugin((event) => {
      events.push(event);
    });

    await plugin.textDelta?.({ text: 'a', messageId: 'm1' }, {} as never);
    await plugin.toolStream?.(
      {
        toolCallId: 't1',
        toolName: 'bash',
        type: 'start',
        sequence: 1,
        timestamp: Date.now(),
      },
      {} as never
    );
    await plugin.step?.({ stepIndex: 1, finishReason: 'tool_calls', toolCallsCount: 1 }, {
      loopIndex: 4,
    } as never);
    await plugin.stop?.({ reason: 'stop', message: 'done' }, {} as never);

    expect(events).toHaveLength(4);
    expect(events[0]).toMatchObject({ type: 'stream.text' });
    expect(events[1]).toMatchObject({ type: 'stream.tool' });
    expect(events[2]).toMatchObject({ type: 'step', loopIndex: 4, stepIndex: 1 });
    expect(events[3]).toMatchObject({ type: 'stop', reason: 'stop' });
  });

  it('dispatches assistant snapshot on step when final content exists', async () => {
    const events: unknown[] = [];
    const plugin = createTerminalUiAgentPlugin((event) => {
      events.push(event);
    });

    await plugin.step?.(
      {
        stepIndex: 2,
        finishReason: 'tool_calls',
        toolCallsCount: 1,
        assistantMessageId: 'm-step-2',
        assistantContent: '当前工作目录是 /Users/wrr/work/coding-agent-v2',
        assistantReasoningContent: '先确认 cwd 再回复用户。',
      },
      { loopIndex: 1 } as never
    );

    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ type: 'step', stepIndex: 2, loopIndex: 1 });
    expect(events[1]).toMatchObject({
      type: 'assistant.snapshot',
      messageId: 'm-step-2',
      content: '当前工作目录是 /Users/wrr/work/coding-agent-v2',
      reasoningContent: '先确认 cwd 再回复用户。',
    });
  });
});
