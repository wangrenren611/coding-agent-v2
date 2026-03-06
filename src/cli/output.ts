import type { AgentResult } from '../agent';
import type { Plugin, ToolStreamEvent } from '../hook';
import type { OutputFormat, RunRenderer } from './types';

function writeLine(message: string): void {
  process.stdout.write(`${message}\n`);
}

function safeJson(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return JSON.stringify({ error: 'UNSERIALIZABLE' });
  }
}

function printToolEventReadable(event: ToolStreamEvent): void {
  const prefix = `[tool:${event.toolName}:${event.type}]`;
  if (event.content && event.content.length > 0) {
    writeLine(`${prefix} ${event.content}`);
    return;
  }
  if (event.data !== undefined) {
    writeLine(`${prefix} ${safeJson(event.data)}`);
    return;
  }
  writeLine(prefix);
}

export interface InkRendererCallbacks {
  onTextDelta?: (payload: { text: string; isReasoning: boolean; messageId?: string }) => void;
  onToolEvent?: (payload: { event: ToolStreamEvent; messageId?: string }) => void;
  onStep?: (step: {
    stepIndex: number;
    finishReason?: string;
    toolCallsCount: number;
    messageId?: string;
  }) => void;
  onResult?: (result: AgentResult) => void;
}

export function createInkRenderer(callbacks: InkRendererCallbacks): RunRenderer {
  const plugin: Plugin = {
    name: 'cli-ink-renderer',
    textDelta: ({ text, isReasoning, messageId }) => {
      callbacks.onTextDelta?.({
        text,
        isReasoning: isReasoning === true,
        messageId,
      });
    },
    toolStream: (event, ctx) => {
      callbacks.onToolEvent?.({ event, messageId: ctx.messageId });
    },
    step: (step, ctx) => {
      callbacks.onStep?.({ ...step, messageId: ctx.messageId });
    },
  };

  return {
    plugin,
    flush: (result) => {
      callbacks.onResult?.(result);
    },
  };
}

export function createInteractiveRenderer(): RunRenderer {
  let hasText = false;
  const plugin: Plugin = {
    name: 'cli-interactive-renderer',
    textDelta: ({ text, isReasoning }) => {
      if (!text) return;
      hasText = true;
      if (isReasoning === true) {
        process.stdout.write(`[thinking] ${text}`);
        return;
      }
      process.stdout.write(text);
    },
    toolStream: (event) => {
      if (event.type === 'stdout' || event.type === 'stderr') {
        const content = event.content ?? '';
        if (content.length > 0) {
          process.stdout.write(content);
          if (!content.endsWith('\n')) {
            process.stdout.write('\n');
          }
        }
        return;
      }
      printToolEventReadable(event);
    },
  };

  return {
    plugin,
    flush: (result: AgentResult) => {
      if (!hasText && result.text) {
        writeLine(result.text);
      }
      process.stdout.write('\n');
    },
  };
}

export function createQuietRenderer(format: OutputFormat): RunRenderer {
  if (format === 'stream-json') {
    const plugin: Plugin = {
      name: 'cli-stream-json-renderer',
      textDelta: ({ text, isReasoning }) => {
        writeLine(
          safeJson({
            type: 'text_delta',
            text,
            isReasoning: isReasoning === true,
          })
        );
      },
      toolStream: (event) => {
        writeLine(
          safeJson({
            type: 'tool_stream',
            event,
          })
        );
      },
      step: (step) => {
        writeLine(
          safeJson({
            type: 'step',
            step,
          })
        );
      },
      stop: (reason) => {
        writeLine(
          safeJson({
            type: 'stop',
            reason,
          })
        );
      },
    };

    return {
      plugin,
      flush: (result: AgentResult) => {
        writeLine(
          safeJson({
            type: 'result',
            text: result.text,
            completionReason: result.completionReason,
            completionMessage: result.completionMessage,
            loopCount: result.loopCount,
            usage: result.totalUsage,
          })
        );
      },
    };
  }

  const plugin: Plugin = {
    name: 'cli-quiet-renderer',
  };

  return {
    plugin,
    flush: (result: AgentResult) => {
      if (format === 'json') {
        writeLine(
          JSON.stringify(
            {
              text: result.text,
              completionReason: result.completionReason,
              completionMessage: result.completionMessage,
              loopCount: result.loopCount,
              usage: result.totalUsage,
            },
            null,
            2
          )
        );
        return;
      }

      writeLine(result.text || '');
    },
  };
}
