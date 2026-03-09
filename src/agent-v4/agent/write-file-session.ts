import type { ToolCall } from '../../providers';
import {
  appendContent,
  appendRawArgs,
  cleanupWriteBufferSessionFiles,
  createWriteBufferSession,
  loadWriteBufferSession,
  type WriteBufferSessionMeta,
} from './write-buffer';

export const WRITE_FILE_TOOL_NAME = 'write_file';

export interface WriteBufferRuntime {
  session: WriteBufferSessionMeta;
  bufferedContentChars: number;
}

interface WriteFileProtocolPayload {
  ok: boolean;
  code: 'OK' | 'WRITE_FILE_PARTIAL_BUFFERED' | 'WRITE_FILE_NEED_RESUME' | 'WRITE_FILE_FINALIZE_OK';
  nextAction: 'resume' | 'finalize' | 'none';
}

export function buildWriteFileSessionKey(params: {
  executionId?: string;
  stepIndex: number;
  toolCallId: string;
}): string {
  const { executionId, stepIndex, toolCallId } = params;
  const executionKey = executionId && executionId.trim().length > 0 ? executionId : '__anonymous__';
  return `${executionKey}:${stepIndex}:${toolCallId}`;
}

export function isWriteFileToolCall(toolCall: ToolCall): boolean {
  return toolCall.function.name?.trim() === WRITE_FILE_TOOL_NAME;
}

export function extractWriteFileContentPrefix(argumentsText: string): string | null {
  const contentMarkerMatch = /"content"\s*:\s*"/.exec(argumentsText);
  if (!contentMarkerMatch || typeof contentMarkerMatch.index !== 'number') {
    return null;
  }

  let cursor = contentMarkerMatch.index + contentMarkerMatch[0].length;
  let output = '';

  while (cursor < argumentsText.length) {
    const ch = argumentsText[cursor];
    if (ch === '"') {
      return output;
    }

    if (ch !== '\\') {
      output += ch;
      cursor += 1;
      continue;
    }

    if (cursor + 1 >= argumentsText.length) {
      return output;
    }

    const esc = argumentsText[cursor + 1];
    if (esc === '"' || esc === '\\' || esc === '/') {
      output += esc;
      cursor += 2;
    } else if (esc === 'b') {
      output += '\b';
      cursor += 2;
    } else if (esc === 'f') {
      output += '\f';
      cursor += 2;
    } else if (esc === 'n') {
      output += '\n';
      cursor += 2;
    } else if (esc === 'r') {
      output += '\r';
      cursor += 2;
    } else if (esc === 't') {
      output += '\t';
      cursor += 2;
    } else if (esc === 'u') {
      const unicodeHex = argumentsText.slice(cursor + 2, cursor + 6);
      if (!/^[0-9a-fA-F]{4}$/.test(unicodeHex)) {
        return output;
      }
      output += String.fromCharCode(parseInt(unicodeHex, 16));
      cursor += 6;
    } else {
      output += esc;
      cursor += 2;
    }
  }

  return output;
}

export async function bufferWriteFileToolCallChunk(params: {
  toolCall: ToolCall;
  argumentsChunk: string;
  messageId: string;
  sessionKey?: string;
  sessions: Map<string, WriteBufferRuntime>;
  onError?: (error: unknown) => void;
}): Promise<void> {
  const { toolCall, argumentsChunk, messageId, sessionKey, sessions, onError } = params;
  if (!isWriteFileToolCall(toolCall)) {
    return;
  }

  try {
    const runtimeKey = sessionKey || toolCall.id;
    let runtime = sessions.get(runtimeKey);
    if (!runtime) {
      const session = await createWriteBufferSession({
        messageId,
        toolCallId: toolCall.id,
      });
      runtime = {
        session,
        bufferedContentChars: 0,
      };
      sessions.set(runtimeKey, runtime);
    }

    if (argumentsChunk) {
      await appendRawArgs(runtime.session, argumentsChunk);
    }

    const decodedContentPrefix = extractWriteFileContentPrefix(toolCall.function.arguments);
    if (decodedContentPrefix === null) {
      return;
    }

    if (decodedContentPrefix.length <= runtime.bufferedContentChars) {
      return;
    }

    const contentDelta = decodedContentPrefix.slice(runtime.bufferedContentChars);
    await appendContent(runtime.session, contentDelta);
    runtime.bufferedContentChars = decodedContentPrefix.length;
  } catch (error) {
    onError?.(error);
  }
}

export async function enrichWriteFileToolError(
  toolCall: ToolCall,
  content: string,
  sessions: Map<string, WriteBufferRuntime>,
  sessionKey?: string
): Promise<string> {
  if (!isWriteFileToolCall(toolCall)) {
    return content;
  }
  const runtime = sessions.get(sessionKey || toolCall.id);
  if (!runtime) {
    return JSON.stringify({
      ok: false,
      code: 'WRITE_FILE_NEED_RESUME',
      message: content,
      nextAction: 'resume',
    });
  }
  try {
    const meta = await loadWriteBufferSession(runtime.session.metaPath);
    return JSON.stringify({
      ok: false,
      code: 'WRITE_FILE_PARTIAL_BUFFERED',
      message: content,
      buffer: {
        bufferId: meta.bufferId,
        path: meta.targetPath || '',
        bufferedBytes: meta.contentBytes,
        maxChunkBytes: 32768,
      },
      nextAction: 'resume',
    });
  } catch {
    return JSON.stringify({
      ok: false,
      code: 'WRITE_FILE_NEED_RESUME',
      message: content,
      nextAction: 'resume',
    });
  }
}

export function isWriteFileProtocolOutput(content: string | undefined): content is string {
  if (!content || content.trim().length === 0) {
    return false;
  }
  try {
    const parsed = JSON.parse(content) as Partial<WriteFileProtocolPayload>;
    if (!parsed || typeof parsed !== 'object') {
      return false;
    }
    return (
      typeof parsed.code === 'string' &&
      typeof parsed.ok === 'boolean' &&
      (parsed.nextAction === 'resume' ||
        parsed.nextAction === 'finalize' ||
        parsed.nextAction === 'none')
    );
  } catch {
    return false;
  }
}

export function shouldEnrichWriteFileFailure(
  error: { name?: string } | undefined,
  output?: string
): boolean {
  if (isWriteFileProtocolOutput(output)) {
    return false;
  }
  const errorName = error?.name;
  return errorName === 'InvalidArgumentsError' || errorName === 'ToolValidationError';
}

export async function cleanupWriteFileBufferIfNeeded(
  toolCall: ToolCall,
  sessions: Map<string, WriteBufferRuntime>,
  sessionKey?: string
): Promise<void> {
  if (!isWriteFileToolCall(toolCall)) {
    return;
  }
  const runtimeKey = sessionKey || toolCall.id;
  const runtime = sessions.get(runtimeKey);
  if (!runtime) {
    return;
  }
  sessions.delete(runtimeKey);
  await cleanupWriteBufferSessionFiles(runtime.session);
}
