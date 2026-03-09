import { describe, expect, it } from 'vitest';
import type { ToolCall } from '../../../providers';
import {
  bufferWriteFileToolCallChunk,
  buildWriteFileSessionKey,
  cleanupWriteFileBufferIfNeeded,
  enrichWriteFileToolError,
  type WriteBufferRuntime,
} from '../write-file-session';

function createWriteFileToolCall(id: string, content: string): ToolCall {
  return {
    id,
    type: 'function',
    index: 0,
    function: {
      name: 'write_file',
      arguments: JSON.stringify({
        path: 'a.txt',
        content,
      }),
    },
  };
}

describe('write-file-session', () => {
  it('buildWriteFileSessionKey isolates by execution and step', () => {
    const keyA = buildWriteFileSessionKey({
      executionId: 'exec_a',
      stepIndex: 1,
      toolCallId: 'tool_1',
    });
    const keyB = buildWriteFileSessionKey({
      executionId: 'exec_b',
      stepIndex: 1,
      toolCallId: 'tool_1',
    });
    const keyC = buildWriteFileSessionKey({
      executionId: 'exec_a',
      stepIndex: 2,
      toolCallId: 'tool_1',
    });
    expect(keyA).not.toBe(keyB);
    expect(keyA).not.toBe(keyC);
  });

  it('keeps write buffer runtimes isolated for same toolCallId under different session keys', async () => {
    const toolCall = createWriteFileToolCall('wf_same_id', 'partial-content');
    const sessions = new Map<string, WriteBufferRuntime>();
    const sessionKeyA = buildWriteFileSessionKey({
      executionId: 'exec_A',
      stepIndex: 1,
      toolCallId: toolCall.id,
    });
    const sessionKeyB = buildWriteFileSessionKey({
      executionId: 'exec_B',
      stepIndex: 1,
      toolCallId: toolCall.id,
    });

    try {
      await bufferWriteFileToolCallChunk({
        toolCall,
        argumentsChunk: '{"path":"a.txt","content":"partial-content"}',
        messageId: 'msg_A',
        sessionKey: sessionKeyA,
        sessions,
      });
      await bufferWriteFileToolCallChunk({
        toolCall,
        argumentsChunk: '{"path":"a.txt","content":"partial-content"}',
        messageId: 'msg_B',
        sessionKey: sessionKeyB,
        sessions,
      });

      expect(sessions.size).toBe(2);
      const sessionA = sessions.get(sessionKeyA);
      const sessionB = sessions.get(sessionKeyB);
      expect(sessionA).toBeDefined();
      expect(sessionB).toBeDefined();
      expect(sessionA?.session.metaPath).not.toBe(sessionB?.session.metaPath);

      await cleanupWriteFileBufferIfNeeded(toolCall, sessions, sessionKeyA);
      expect(sessions.size).toBe(1);

      const payloadText = await enrichWriteFileToolError(
        toolCall,
        'invalid args',
        sessions,
        sessionKeyB
      );
      const payload = JSON.parse(payloadText) as {
        code: string;
        buffer?: { bufferedBytes: number };
      };
      expect(payload.code).toBe('WRITE_FILE_PARTIAL_BUFFERED');
      expect(payload.buffer?.bufferedBytes).toBeGreaterThan(0);

      await cleanupWriteFileBufferIfNeeded(toolCall, sessions, sessionKeyB);
      expect(sessions.size).toBe(0);
    } finally {
      const remaining = [...sessions.entries()];
      for (const [key] of remaining) {
        await cleanupWriteFileBufferIfNeeded(toolCall, sessions, key);
      }
    }
  });
});
