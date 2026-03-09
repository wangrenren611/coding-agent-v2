import { describe, expect, it, vi } from 'vitest';
import type { ToolCall } from '../../../providers';
import { mergeToolCalls } from '../tool-call-merge';

describe('tool-call-merge', () => {
  it('merges fragmented tool call arguments and keeps stable ordering', async () => {
    const existing: ToolCall[] = [
      {
        id: 'a',
        type: 'function',
        index: 0,
        function: { name: '', arguments: '{"x":' },
      },
    ];
    const incoming: ToolCall[] = [
      {
        id: 'a',
        type: 'function',
        index: 0,
        function: { name: 'bash', arguments: '1}' },
      },
      {
        id: 'b',
        type: 'function',
        index: 1,
        function: { name: 'write_file', arguments: '{}' },
      },
    ];

    const onArgumentsChunk = vi.fn(async () => undefined);
    const merged = await mergeToolCalls({
      existing,
      incoming,
      messageId: 'm1',
      onArgumentsChunk,
    });

    expect(merged).toHaveLength(2);
    expect(merged[0]).toMatchObject({
      id: 'a',
      function: { name: 'bash', arguments: '{"x":1}' },
    });
    expect(merged[1]).toMatchObject({ id: 'b' });
    expect(onArgumentsChunk).toHaveBeenCalledTimes(2);
  });

  it('merges follow-up fragments by index when id/name are omitted', async () => {
    const existing: ToolCall[] = [
      {
        id: 'call_1',
        type: 'function',
        index: 0,
        function: { name: 'bash', arguments: '{' },
      },
    ];
    const incoming = [
      {
        function: { arguments: '"command":"ls -la"}' },
        index: 0,
      },
    ] as unknown as ToolCall[];

    const onArgumentsChunk = vi.fn(async () => undefined);
    const merged = await mergeToolCalls({
      existing,
      incoming,
      messageId: 'm2',
      onArgumentsChunk,
    });

    expect(merged).toHaveLength(1);
    expect(merged[0]).toMatchObject({
      id: 'call_1',
      type: 'function',
      index: 0,
      function: { name: 'bash', arguments: '{"command":"ls -la"}' },
    });
    expect(onArgumentsChunk).toHaveBeenCalledTimes(1);
  });
});
