import type { ToolStreamEvent } from '../core/types';
import { LiveRegionManager } from './live-region';
import { MarkdownRenderer } from './markdown-renderer';
import type { TerminalUiEvent, TerminalUiState } from './types';

export interface TerminalUiOptions {
  sessionId?: string;
  modelId?: string;
  stream?: NodeJS.WriteStream;
}

const ANSI = {
  reset: '\u001B[0m',
  dim: '\u001B[2m',
  bold: '\u001B[1m',
  red: '\u001B[31m',
  green: '\u001B[32m',
  gray: '\u001B[90m',
};

function style(text: string, ...codes: string[]): string {
  return `${codes.join('')}${text}${ANSI.reset}`;
}

function nowOf(now: number | undefined): number {
  return now ?? Date.now();
}

function compactChunk(text: string, enabled: boolean): string {
  if (!enabled || text.length <= 900) {
    return text;
  }
  const head = text.slice(0, 560);
  const tail = text.slice(-240);
  const omitted = text.length - head.length - tail.length;
  return `${head}\n...[${omitted} chars omitted]...\n${tail}`;
}

function safeParseJsonObject(input: string | undefined): Record<string, unknown> {
  if (!input) {
    return {};
  }
  try {
    const value = JSON.parse(input) as unknown;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      return value as Record<string, unknown>;
    }
  } catch {
    // ignore
  }
  return {};
}

function shortToolName(name: string): string {
  switch (name) {
    case 'file_read':
      return 'Read';
    case 'file_write':
      return 'Write';
    case 'file_edit':
      return 'Edit';
    case 'file_stat':
      return 'Stat';
    case 'bash':
      return 'Bash';
    case 'glob':
      return 'Glob';
    case 'grep':
      return 'Grep';
    default:
      return name;
  }
}

function formatToolTitle(toolName: string, args: Record<string, unknown>): string {
  if (
    toolName === 'file_read' ||
    toolName === 'file_write' ||
    toolName === 'file_edit' ||
    toolName === 'file_stat'
  ) {
    const path = typeof args['path'] === 'string' ? args['path'] : '';
    return `${shortToolName(toolName)}(${path})`;
  }
  if (toolName === 'bash') {
    const command = typeof args['command'] === 'string' ? args['command'] : '';
    return `Bash(${command})`;
  }
  if (toolName === 'glob') {
    const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '';
    return `Glob(${pattern})`;
  }
  if (toolName === 'grep') {
    const pattern = typeof args['pattern'] === 'string' ? args['pattern'] : '';
    return `Grep(${pattern})`;
  }
  return `${shortToolName(toolName)}()`;
}

interface ToolRunBuffer {
  toolName: string;
  title: string;
  stdout: string;
  stderr: string;
}

type LogWriteMode = 'block-start' | 'block-start-tight' | 'block-continue';

function extractToolResultData(event: ToolStreamEvent): {
  success?: boolean;
  result?: { success?: boolean; data?: unknown; error?: string };
} {
  if (!event.data || typeof event.data !== 'object') {
    return {};
  }
  const data = event.data as Record<string, unknown>;
  const result = data['result'];
  return {
    success: typeof data['success'] === 'boolean' ? data['success'] : undefined,
    result:
      result && typeof result === 'object'
        ? (result as { success?: boolean; data?: unknown; error?: string })
        : undefined,
  };
}

function createInitialState(input?: { sessionId?: string; modelId?: string }): TerminalUiState {
  return {
    sessionId: input?.sessionId ?? 'unknown-session',
    modelId: input?.modelId,
    status: 'idle',
    runId: undefined,
    turnCount: 0,
    loopIndex: 0,
    stepIndex: 0,
    compactToolOutput: true,
    toolEventCount: 0,
    totalUsage: undefined,
    completionReason: undefined,
    completionMessage: undefined,
    errorMessage: undefined,
    inputPlaceholder: 'Type a message. Use /exit to quit.',
    updatedAt: Date.now(),
  };
}

export class TerminalUi {
  private readonly stream: NodeJS.WriteStream;
  private readonly liveRegion: LiveRegionManager;
  private readonly markdownRenderer: MarkdownRenderer;

  private state: TerminalUiState;
  private disposed = false;

  private assistantBuffer = '';
  private assistantBlockOpen = false;
  private readonly runningTools = new Map<string, ToolRunBuffer>();
  private logBlockCount = 0;
  private readonly streamedContentCharsByMessageId = new Map<string, number>();
  private readonly streamedReasoningCharsByMessageId = new Map<string, number>();
  private inputActive = false;
  private inputDraft = '';

  private statusTimer: NodeJS.Timeout | undefined;
  private statusStartedAt: number | undefined;
  private statusFrameIndex = 0;
  private readonly statusFrames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

  constructor(options?: TerminalUiOptions) {
    this.stream = options?.stream ?? process.stdout;
    this.liveRegion = new LiveRegionManager(this.stream);
    this.markdownRenderer = new MarkdownRenderer({
      width: this.stream.columns ?? 80,
    });
    this.state = createInitialState({
      sessionId: options?.sessionId,
      modelId: options?.modelId,
    });
  }

  getState(): Readonly<TerminalUiState> {
    return this.state;
  }

  dispatch(event: TerminalUiEvent): void {
    if (this.disposed) {
      return;
    }

    this.updateState(event);
    this.renderEvent(event);
  }

  async withSuspendedRender<T>(run: () => Promise<T>): Promise<T> {
    return this.liveRegion.withHidden(run);
  }

  renderNow(): void {
    this.renderLiveOverlay();
  }

  beginInput(): void {
    this.inputActive = true;
    this.inputDraft = '';
    this.renderLiveOverlay();
  }

  updateInputDraft(text: string): void {
    if (!this.inputActive) {
      return;
    }
    this.inputDraft = text.replace(/[\r\n]+/g, ' ');
    this.renderLiveOverlay();
  }

  endInput(): void {
    if (!this.inputActive && this.inputDraft.length === 0) {
      return;
    }
    this.inputActive = false;
    this.inputDraft = '';
    this.renderLiveOverlay();
  }

  close(): void {
    if (this.disposed) {
      return;
    }
    this.disposed = true;

    this.stopLiveStatus();
    this.flushAssistantBuffer();
    this.liveRegion.clear();
  }

  private updateState(event: TerminalUiEvent): void {
    const timestamp = nowOf(event.now);
    this.state = {
      ...this.state,
      updatedAt: timestamp,
    };

    switch (event.type) {
      case 'init':
        this.state.sessionId = event.sessionId;
        this.state.modelId = event.modelId ?? this.state.modelId;
        return;
      case 'message.user':
        this.state.turnCount += 1;
        this.state.status = 'idle';
        this.state.errorMessage = undefined;
        this.state.completionReason = undefined;
        this.state.completionMessage = undefined;
        return;
      case 'run.start':
        this.state.runId = event.runId;
        this.state.status = 'running';
        this.state.errorMessage = undefined;
        this.state.completionReason = undefined;
        this.state.completionMessage = undefined;
        return;
      case 'stream.tool':
        this.state.toolEventCount += 1;
        if (this.state.status !== 'waiting_confirm') {
          this.state.status = 'running';
        }
        return;
      case 'tool.confirm.request':
        this.state.status = 'waiting_confirm';
        return;
      case 'tool.confirm.decision':
        this.state.status = 'running';
        return;
      case 'step':
        this.state.stepIndex = Math.max(this.state.stepIndex, event.stepIndex);
        this.state.loopIndex = event.loopIndex
          ? Math.max(this.state.loopIndex, event.loopIndex)
          : this.state.loopIndex;
        if (this.state.status !== 'waiting_confirm') {
          this.state.status = 'running';
        }
        return;
      case 'stop':
        this.state.status = this.state.status === 'error' ? 'error' : 'completed';
        this.state.completionReason = event.reason;
        this.state.completionMessage = event.message;
        return;
      case 'run.finish':
        this.state.status = this.state.status === 'error' ? 'error' : 'completed';
        this.state.completionReason = event.completionReason;
        this.state.completionMessage = event.completionMessage;
        this.state.totalUsage = event.usage ?? this.state.totalUsage;
        return;
      case 'run.error':
        this.state.status = 'error';
        this.state.errorMessage = event.error;
        return;
      case 'input.placeholder':
        this.state.inputPlaceholder = event.text;
        return;
      case 'setting.compactToolOutput':
        this.state.compactToolOutput = event.compact;
        return;
      case 'exit':
        this.state.status = 'exiting';
        return;
      default:
        return;
    }
  }

  private renderEvent(event: TerminalUiEvent): void {
    switch (event.type) {
      case 'init':
      case 'input.placeholder':
        return;

      case 'message.user':
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.clearAssistantStreamTracking();
        this.writeLogLine(`❯ ${event.text}`, 'block-start-tight');
        return;

      case 'message.system':
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.writeLogLine(`${style('•', ANSI.gray)} ${event.text}`);
        return;

      case 'run.start':
        this.startLiveStatus();
        return;

      case 'stream.text':
        if (event.messageId) {
          if (!event.isReasoning) {
            const prev = this.streamedContentCharsByMessageId.get(event.messageId) ?? 0;
            this.streamedContentCharsByMessageId.set(event.messageId, prev + event.text.length);
          }
        }
        if (event.isReasoning) {
          return;
        }
        this.assistantBuffer += event.text;
        this.flushAssistantBufferIncremental();
        return;

      case 'assistant.snapshot':
        this.renderAssistantSnapshot(event);
        this.closeAssistantBlock();
        return;

      case 'stream.tool':
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.handleToolEvent(event.event);
        return;

      case 'tool.confirm.request':
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.writeLogLine(
          `${style('?', ANSI.bold)} Confirm ${event.request.toolName}(${event.request.toolCallId}) ${style(`reason=${event.request.reason ?? 'n/a'}`, ANSI.dim)}`
        );
        return;

      case 'tool.confirm.decision':
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.writeLogLine(
          `${style('•', ANSI.gray)} Decision ${event.decision} for ${event.request.toolName}(${event.request.toolCallId})`
        );
        return;

      case 'step':
      case 'stop':
        return;

      case 'run.finish':
        this.stopLiveStatus();
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.clearAssistantStreamTracking();
        return;

      case 'run.error':
        this.stopLiveStatus();
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.clearAssistantStreamTracking();
        this.writeLogLine(`${style('*', ANSI.red)} ${event.error}`);
        return;

      case 'setting.compactToolOutput':
        this.writeLogLine(
          `${style('•', ANSI.gray)} tool output mode=${event.compact ? 'compact' : 'full'}`
        );
        return;

      case 'exit':
        this.stopLiveStatus();
        this.flushAssistantBuffer();
        this.closeAssistantBlock();
        this.clearAssistantStreamTracking();
        this.writeLogLine(`${style('•', ANSI.gray)} exiting.`);
        return;

      default: {
        const _exhaustive: never = event;
        return _exhaustive;
      }
    }
  }

  private flushAssistantBufferIncremental(): void {
    const lines = this.assistantBuffer.split('\n');
    if (lines.length <= 1) {
      return;
    }

    const completedLines = lines.slice(0, -1);
    this.assistantBuffer = lines[lines.length - 1] ?? '';

    for (const line of completedLines) {
      this.writeAssistantLine(line);
    }
  }

  private flushAssistantBuffer(): void {
    if (this.assistantBuffer.length === 0) {
      return;
    }
    const text = this.assistantBuffer.replace(/\s+$/, '');
    this.assistantBuffer = '';
    if (text.length > 0) {
      this.writeAssistantLine(text);
    }
  }

  private writeAssistantLine(text: string): void {
    if (!this.assistantBlockOpen) {
      this.assistantBlockOpen = true;
      this.writeLogLine(`${style('●', ANSI.gray)} ${text}`, 'block-start');
      return;
    }
    this.writeLogLine(`  ${text}`, 'block-continue');
  }

  private closeAssistantBlock(): void {
    this.assistantBlockOpen = false;
  }

  private renderAssistantSnapshot(
    event: Extract<TerminalUiEvent, { type: 'assistant.snapshot' }>
  ): void {
    const content = event.content ?? '';
    const reasoningContent = event.reasoningContent ?? '';
    const streamedContentChars =
      event.messageId !== undefined
        ? (this.streamedContentCharsByMessageId.get(event.messageId) ?? 0)
        : 0;
    const streamedReasoningChars =
      event.messageId !== undefined
        ? (this.streamedReasoningCharsByMessageId.get(event.messageId) ?? 0)
        : 0;
    const missingContent = this.sliceUnrenderedSuffix(content, streamedContentChars);
    const missingReasoning = this.sliceUnrenderedSuffix(reasoningContent, streamedReasoningChars);

    if (missingReasoning.length > 0) {
      this.writeReasoningTextBlock(missingReasoning);
    }

    if (content.length > 0) {
      if (this.assistantBuffer.length > 0) {
        this.assistantBuffer += missingContent;
        this.flushAssistantBuffer();
      } else if (missingContent.length > 0 || streamedContentChars === 0) {
        this.writeAssistantTextBlock(streamedContentChars === 0 ? content : missingContent);
      }
    } else {
      this.flushAssistantBuffer();
    }

    if (event.messageId) {
      this.streamedContentCharsByMessageId.set(event.messageId, content.length);
      this.streamedReasoningCharsByMessageId.set(event.messageId, reasoningContent.length);
    }
  }

  private sliceUnrenderedSuffix(text: string, renderedChars: number): string {
    if (renderedChars <= 0) {
      return text;
    }
    if (renderedChars >= text.length) {
      return '';
    }
    return text.slice(renderedChars);
  }

  private writeAssistantTextBlock(text: string): void {
    const rendered = this.renderAssistantMarkdown(text);
    const normalized = rendered.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (normalized.length === 0) {
      return;
    }
    const lines = normalized.split('\n');
    for (const line of lines) {
      this.writeAssistantLine(line);
    }
    this.closeAssistantBlock();
  }

  private renderAssistantMarkdown(markdownText: string): string {
    try {
      return this.markdownRenderer.render(markdownText);
    } catch {
      return markdownText;
    }
  }

  private writeReasoningTextBlock(text: string): void {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\s+$/, '');
    if (normalized.length === 0) {
      return;
    }
    const lines = normalized.split('\n');
    const first = lines[0] ?? '';
    this.writeLogLine(`${style('●', ANSI.gray)} ${style(first, ANSI.dim)}`, 'block-start');
    for (let i = 1; i < lines.length; i++) {
      this.writeLogLine(`  ${style(lines[i] ?? '', ANSI.dim)}`, 'block-continue');
    }
  }

  private clearAssistantStreamTracking(): void {
    this.streamedContentCharsByMessageId.clear();
    this.streamedReasoningCharsByMessageId.clear();
  }

  private handleToolEvent(event: ToolStreamEvent): void {
    if (event.type === 'start') {
      const eventData =
        event.data && typeof event.data === 'object' ? (event.data as Record<string, unknown>) : {};
      const args = safeParseJsonObject(
        typeof eventData['arguments'] === 'string' ? eventData['arguments'] : undefined
      );
      const title = formatToolTitle(event.toolName, args);
      this.runningTools.set(event.toolCallId, {
        toolName: event.toolName,
        title,
        stdout: '',
        stderr: '',
      });
      this.writeLogLine(`${style('●', ANSI.green)} ${style(title, ANSI.bold)}`);
      this.renderLiveOverlay();
      return;
    }

    const running = this.runningTools.get(event.toolCallId);
    if (!running) {
      return;
    }

    if (event.type === 'stdout') {
      running.stdout += event.content ?? '';
      return;
    }

    if (event.type === 'stderr') {
      running.stderr += event.content ?? '';
      return;
    }

    if (event.type !== 'end' && event.type !== 'error') {
      return;
    }

    const summaryLines = this.summarizeToolResult(running, event);
    this.writeTreeDetails(summaryLines);
    this.runningTools.delete(event.toolCallId);
    this.renderLiveOverlay();
  }

  private summarizeToolResult(tool: ToolRunBuffer, event: ToolStreamEvent): string[] {
    const lines: string[] = [];
    const envelope = extractToolResultData(event);
    const result = envelope.result;

    const outputFromResult =
      typeof result?.data === 'object' &&
      result.data !== null &&
      'output' in (result.data as Record<string, unknown>) &&
      typeof (result.data as Record<string, unknown>)['output'] === 'string'
        ? ((result.data as Record<string, unknown>)['output'] as string)
        : '';

    const output = tool.stdout.length > 0 ? tool.stdout : outputFromResult;

    if (tool.toolName === 'file_read') {
      const contentFromResult =
        typeof result?.data === 'object' &&
        result.data !== null &&
        'content' in (result.data as Record<string, unknown>) &&
        typeof (result.data as Record<string, unknown>)['content'] === 'string'
          ? ((result.data as Record<string, unknown>)['content'] as string)
          : '';
      const content = contentFromResult.length > 0 ? contentFromResult : output;
      if (content.length > 0) {
        const count = content.replace(/\r\n/g, '\n').split('\n').length;
        lines.push(`Read ${count} lines`);
      } else {
        lines.push('Read complete');
      }
      return lines;
    }

    if (output.length > 0) {
      const compact = compactChunk(output, this.state.compactToolOutput);
      const all = compact
        .split('\n')
        .map((line) => line.trimEnd())
        .filter((line) => line.length > 0);

      const preview = all.slice(0, 3);
      lines.push(...preview);
      if (all.length > 3) {
        lines.push(style(`… +${all.length - 3} lines (ctrl+o to expand)`, ANSI.dim));
      }
    }

    if (tool.stderr.length > 0) {
      const first = tool.stderr
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.length > 0);
      if (first) {
        lines.push(style(first, ANSI.dim));
      }
    }

    if (event.type === 'error' || result?.success === false) {
      lines.push(style(result?.error ?? 'tool failed', ANSI.red));
    }

    if (lines.length === 0) {
      lines.push('Done');
    }
    return lines;
  }

  private writeTreeDetails(lines: string[]): void {
    if (lines.length === 0) {
      return;
    }
    const outputLines: string[] = [`  ${style('└', ANSI.gray)} ${lines[0]}`];
    for (let i = 1; i < lines.length; i++) {
      outputLines.push(`    ${lines[i]}`);
    }
    this.writeLogLines(outputLines, 'block-continue');
  }

  private writeLogLine(text: string, mode: LogWriteMode = 'block-start'): void {
    this.writeLogLines([text], mode);
  }

  private writeLogLines(lines: string[], mode: LogWriteMode = 'block-start'): void {
    if (lines.length === 0) {
      return;
    }
    this.liveRegion.withHidden(() => {
      if (mode === 'block-start' && this.logBlockCount > 0) {
        this.stream.write('\n');
      }
      for (const line of lines) {
        this.stream.write(`${line}\n`);
      }
    });
    if (mode !== 'block-continue' || this.logBlockCount === 0) {
      this.logBlockCount += 1;
    }
    this.renderLiveOverlay();
  }

  private startLiveStatus(): void {
    this.stopLiveStatus();
    this.statusStartedAt = Date.now();
    this.statusFrameIndex = 0;
    this.renderLiveOverlay();
    this.statusTimer = setInterval(() => {
      this.statusFrameIndex = (this.statusFrameIndex + 1) % this.statusFrames.length;
      this.renderLiveOverlay();
    }, 120);
  }

  private stopLiveStatus(): void {
    if (this.statusTimer) {
      clearInterval(this.statusTimer);
      this.statusTimer = undefined;
    }
    this.statusStartedAt = undefined;
    this.liveRegion.clear();
  }

  private renderLiveOverlay(): void {
    const isRunning = this.state.status === 'running' || this.state.status === 'waiting_confirm';
    if (!isRunning && !this.inputActive) {
      this.liveRegion.clear();
      return;
    }

    if (this.inputActive) {
      this.liveRegion.render([`❯ ${this.inputDraft}`]);
      return;
    }

    const elapsedSec =
      this.statusStartedAt !== undefined
        ? Math.max(0, Math.floor((Date.now() - this.statusStartedAt) / 1000))
        : 0;
    const frame = this.statusFrames[this.statusFrameIndex] ?? '⠋';

    const tools = this.runningTools.size > 0 ? ` · tools:${this.runningTools.size}` : '';
    const phase = this.state.status === 'waiting_confirm' ? 'confirming' : 'thinking';

    const statusLine = `${style(`${frame} Thinking...`, ANSI.red)} ${style(`(Esc to interrupt · ${elapsedSec}s · ${phase}${tools})`, ANSI.dim)}`;
    this.liveRegion.render(['', statusLine, '', '❯ ']);
  }
}
