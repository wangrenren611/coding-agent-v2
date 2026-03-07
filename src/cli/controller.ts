import { createInterface, type Interface as ReadlineInterface } from 'node:readline/promises';
import { createLogUpdate } from 'log-update';
import type { Agent, AgentResult } from '../agent';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../tool';
import { createRawInputParseState, parseRawInputChunk } from './input-parser';
import type { TerminalUi } from './terminal-ui';

export interface TerminalControllerOptions {
  agent: Agent;
  ui: TerminalUi;
  input?: NodeJS.ReadStream;
  output?: NodeJS.WriteStream;
  exitCommands?: string[];
  autoConfirm?: ToolConfirmDecision;
}

export interface ControllerRunResult {
  reason: 'exit' | 'abort' | 'error';
  turns: number;
}

export interface CollapsedPasteSegment {
  id: number;
  start: number;
  end: number;
  lineCount: number;
}

const PASTE_COLLAPSE_MIN_LINES = 6;
const PASTE_COLLAPSE_MIN_CHARS = 400;
const BRACKETED_PASTE_END = '\u001B[201~';

function normalizeAnswer(answer: string): string {
  return answer.trim().toLowerCase();
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`;
  }
  return String(error);
}

export function formatInputDraftForDisplay(raw: string): string {
  // Strip ANSI CSI sequences first, then strip remaining control chars except newlines.
  const withoutAnsi = raw.replace(
    new RegExp(`${String.fromCharCode(27)}\\[[0-?]{0,16}[ -/]*[@-~]`, 'g'),
    ''
  );
  // Strip control characters (except newline which is already normalized)
  // to prevent terminal rendering issues with other special bytes.
  // eslint-disable-next-line no-control-regex
  const safe = withoutAnsi.replace(/[\x00-\x09\x0B-\x1F\x7F]/g, '');
  const normalized = safe.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const lines = normalized.split('\n');

  if (lines.length === 0) {
    return '❯ ';
  }
  const first = lines[0] ?? '';
  const rest = lines.slice(1);
  return [`❯ ${first}`, ...rest].join('\n');
}

function countLines(text: string): number {
  if (text.length === 0) {
    return 0;
  }
  return text.split('\n').length;
}

export function shouldCollapsePastedAppend(chunk: string, appended: string): boolean {
  if (appended.length === 0) {
    return false;
  }
  const lineCount = countLines(appended);
  const isBracketedPasteChunk = chunk.includes('\u001B[200~') || chunk.includes('\u001B[201~');
  if (lineCount >= PASTE_COLLAPSE_MIN_LINES) {
    return true;
  }
  if (appended.length >= PASTE_COLLAPSE_MIN_CHARS) {
    return true;
  }
  return isBracketedPasteChunk && lineCount >= 2;
}

export function appendedSuffix(previous: string, current: string): string {
  if (!current.startsWith(previous)) {
    return '';
  }
  return current.slice(previous.length);
}

export function reconcileCollapsedPastes(
  segments: CollapsedPasteSegment[],
  previousBuffer: string,
  currentBuffer: string
): CollapsedPasteSegment[] {
  if (currentBuffer === previousBuffer) {
    return segments;
  }

  if (currentBuffer.startsWith(previousBuffer)) {
    return segments;
  }

  if (previousBuffer.startsWith(currentBuffer)) {
    const newLength = currentBuffer.length;
    return segments.filter((segment) => segment.end <= newLength);
  }

  return [];
}

export function renderBufferWithCollapsedPastes(
  buffer: string,
  segments: ReadonlyArray<CollapsedPasteSegment>
): string {
  if (segments.length === 0) {
    return buffer;
  }

  let cursor = 0;
  let out = '';
  for (const segment of segments) {
    if (segment.start < cursor || segment.end > buffer.length || segment.end <= segment.start) {
      continue;
    }
    out += buffer.slice(cursor, segment.start);
    const extraLines = Math.max(0, segment.lineCount - 1);
    out += `[Pasted text #${segment.id} +${extraLines} lines]`;
    cursor = segment.end;
  }
  out += buffer.slice(cursor);
  return out;
}

export function upsertCollapsedPasteSegment(
  segments: CollapsedPasteSegment[],
  buffer: string,
  segment: CollapsedPasteSegment
): { segments: CollapsedPasteSegment[]; consumedNewId: boolean } {
  const tail = segments[segments.length - 1];
  if (tail && tail.end === segment.start) {
    const merged: CollapsedPasteSegment = {
      ...tail,
      end: segment.end,
      lineCount: countLines(buffer.slice(tail.start, segment.end)),
    };
    return {
      segments: [...segments.slice(0, -1), merged],
      consumedNewId: false,
    };
  }
  return {
    segments: [...segments, segment],
    consumedNewId: true,
  };
}

export function buildVisualInputBuffer(
  stateBuffer: string,
  segments: ReadonlyArray<CollapsedPasteSegment>,
  pasteIndicatorActive: boolean,
  bracketedPasteStartBufferLength: number | undefined
): string {
  if (!pasteIndicatorActive) {
    return renderBufferWithCollapsedPastes(stateBuffer, segments);
  }

  const cutoff = Math.max(0, Math.min(bracketedPasteStartBufferLength ?? 0, stateBuffer.length));
  const visibleBase = stateBuffer.slice(0, cutoff);
  return renderBufferWithCollapsedPastes(visibleBase, segments);
}

export function shouldSuppressSubmitAfterBracketedPasteChunk(
  chunk: string,
  exitedBracketedPaste: boolean,
  submitted: boolean
): boolean {
  if (!submitted || !exitedBracketedPaste) {
    return false;
  }
  const endIndex = chunk.lastIndexOf(BRACKETED_PASTE_END);
  if (endIndex < 0) {
    return false;
  }
  const tail = chunk.slice(endIndex + BRACKETED_PASTE_END.length);
  if (tail.length === 0) {
    return false;
  }
  return /^[\r\n]+$/.test(tail);
}

function runeWidth(ch: string): number {
  const codePoint = ch.codePointAt(0);
  if (codePoint === undefined) {
    return 0;
  }
  if (codePoint <= 0x1f || (codePoint >= 0x7f && codePoint <= 0x9f)) {
    return 0;
  }
  if (
    codePoint >= 0x1100 &&
    (codePoint <= 0x115f ||
      codePoint === 0x2329 ||
      codePoint === 0x232a ||
      (codePoint >= 0x2e80 && codePoint <= 0xa4cf && codePoint !== 0x303f) ||
      (codePoint >= 0xac00 && codePoint <= 0xd7a3) ||
      (codePoint >= 0xf900 && codePoint <= 0xfaff) ||
      (codePoint >= 0xfe10 && codePoint <= 0xfe19) ||
      (codePoint >= 0xfe30 && codePoint <= 0xfe6f) ||
      (codePoint >= 0xff00 && codePoint <= 0xff60) ||
      (codePoint >= 0xffe0 && codePoint <= 0xffe6))
  ) {
    return 2;
  }
  return 1;
}

function stringWidth(text: string): number {
  let width = 0;
  for (const ch of text) {
    width += runeWidth(ch);
  }
  return width;
}

function wrapLineByWidth(line: string, maxWidth: number): string[] {
  const safeWidth = Math.max(1, maxWidth);
  if (line.length === 0) {
    return [''];
  }

  const out: string[] = [];
  let current = '';
  let currentWidth = 0;
  for (const ch of line) {
    const w = runeWidth(ch);
    if (w > safeWidth) {
      if (current.length > 0) {
        out.push(current);
      }
      out.push(ch);
      current = '';
      currentWidth = 0;
      continue;
    }

    if (currentWidth + w > safeWidth) {
      out.push(current);
      current = ch;
      currentWidth = w;
      continue;
    }

    current += ch;
    currentWidth += w;
  }

  out.push(current);
  return out;
}

export function buildInputFrame(
  text: string,
  columns: number
): { frame: string; cursorCol: number } {
  const display = formatInputDraftForDisplay(text);
  const maxLineWidth = Math.max(8, columns - 1);
  const wrappedLines: string[] = [];
  for (const line of display.split('\n')) {
    wrappedLines.push(...wrapLineByWidth(line, maxLineWidth));
  }
  const lastLine = wrappedLines[wrappedLines.length - 1] ?? '';
  return {
    frame: wrappedLines.join('\n'),
    cursorCol: stringWidth(lastLine),
  };
}

export class AgentTerminalController {
  private readonly agent: Agent;
  private readonly ui: TerminalUi;
  private readonly input: NodeJS.ReadStream;
  private readonly output: NodeJS.WriteStream;
  private readonly exitCommands: Set<string>;
  private readonly autoConfirm?: ToolConfirmDecision;

  private rl: ReadlineInterface | undefined;
  private closed = false;
  private runInFlight = false;
  private cancelInputCapture: (() => void) | undefined;

  private readonly handleSigint = (): void => {
    if (this.runInFlight) {
      this.agent.abort();
      this.ui.dispatch({
        type: 'message.system',
        text: 'SIGINT received, aborting current run...',
      });
      return;
    }

    this.ui.dispatch({
      type: 'message.system',
      text: 'SIGINT received, exiting interactive loop.',
    });
    this.cancelInputCapture?.();
    this.closed = true;
    this.rl?.close();
  };

  constructor(options: TerminalControllerOptions) {
    this.agent = options.agent;
    this.ui = options.ui;
    this.input = options.input ?? process.stdin;
    this.output = options.output ?? process.stdout;
    this.autoConfirm = options.autoConfirm;

    const exitCommands = options.exitCommands ?? ['/exit', '/quit', 'exit', 'quit'];
    this.exitCommands = new Set(exitCommands.map((item) => normalizeAnswer(item)));
  }

  async run(): Promise<ControllerRunResult> {
    this.ui.dispatch({
      type: 'init',
      sessionId: this.agent.getSessionId(),
    });
    this.ui.renderNow();

    let turns = 0;

    this.installSignalHandlers();

    try {
      while (!this.closed) {
        const userInput = await this.askUserInput();
        if (userInput === undefined) {
          this.ui.dispatch({ type: 'exit' });
          return { reason: 'abort', turns };
        }

        const normalized = normalizeAnswer(userInput);
        if (this.exitCommands.has(normalized)) {
          this.ui.dispatch({ type: 'exit' });
          return { reason: 'exit', turns };
        }

        if (normalized.length === 0) {
          continue;
        }

        if (normalized === '?') {
          this.handleSlashCommand('/help');
          continue;
        }

        if (normalized.startsWith('/') && this.handleSlashCommand(userInput)) {
          continue;
        }

        turns += 1;
        const runId = `${Date.now()}-${turns}`;

        this.ui.dispatch({ type: 'message.user', text: userInput });
        this.ui.dispatch({ type: 'run.start', runId, prompt: userInput });
        this.runInFlight = true;

        try {
          const result = await this.agent.run(userInput);
          this.applyRunResult(result);
        } catch (error) {
          this.ui.dispatch({
            type: 'run.error',
            error: toErrorMessage(error),
          });
        } finally {
          this.runInFlight = false;
        }
      }

      return { reason: 'exit', turns };
    } catch (error) {
      this.ui.dispatch({
        type: 'run.error',
        error: toErrorMessage(error),
      });
      return { reason: 'error', turns };
    } finally {
      this.removeSignalHandlers();
      this.close();
    }
  }

  async confirmToolExecution(request: ToolConfirmRequest): Promise<ToolConfirmDecision> {
    if (this.autoConfirm) {
      this.ui.dispatch({
        type: 'tool.confirm.decision',
        request,
        decision: this.autoConfirm,
      });
      return this.autoConfirm;
    }

    if (!this.input.isTTY || !this.output.isTTY) {
      this.ui.dispatch({
        type: 'tool.confirm.decision',
        request,
        decision: 'deny',
      });
      return 'deny';
    }

    const answer = await this.ui.withSuspendedRender(async () => {
      const rl = this.getOrCreateReadline();
      const question =
        `\nApprove tool "${request.toolName}" (id=${request.toolCallId})? [y/N]\n` +
        `reason=${request.reason ?? 'n/a'}\n` +
        `args=${JSON.stringify(request.args)}\n> `;
      return rl.question(question);
    });

    const decision = ['y', 'yes'].includes(normalizeAnswer(answer)) ? 'approve' : 'deny';
    this.ui.dispatch({
      type: 'tool.confirm.decision',
      request,
      decision,
    });
    return decision;
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.removeSignalHandlers();
    this.cancelInputCapture?.();
    this.rl?.close();
    this.ui.close();
  }

  private async askUserInput(): Promise<string | undefined> {
    try {
      this.ui.dispatch({
        type: 'input.placeholder',
        text: 'Waiting for your message... (/exit to quit)',
      });
      this.ui.renderNow();

      if (
        !this.input.isTTY ||
        !this.output.isTTY ||
        typeof (this.input as NodeJS.ReadStream).setRawMode !== 'function'
      ) {
        const rl = this.getOrCreateReadline();
        return await rl.question('❯ ');
      }

      return await this.askUserInputRaw();
    } catch {
      return undefined;
    } finally {
      this.ui.dispatch({
        type: 'input.placeholder',
        text: 'Type a message. Use /exit to quit.',
      });
    }
  }

  private applyRunResult(result: AgentResult): void {
    this.ui.dispatch({
      type: 'run.finish',
      completionReason: result.completionReason,
      completionMessage: result.completionMessage,
      usage: result.totalUsage,
    });
  }

  private installSignalHandlers(): void {
    process.on('SIGINT', this.handleSigint);
  }

  private removeSignalHandlers(): void {
    process.off('SIGINT', this.handleSigint);
  }

  private getOrCreateReadline(): ReadlineInterface {
    if (!this.rl) {
      this.rl = createInterface({
        input: this.input,
        output: this.output,
      });
    }
    return this.rl;
  }

  private async askUserInputRaw(): Promise<string | undefined> {
    const input = this.input as NodeJS.ReadStream & {
      setRawMode: (mode: boolean) => void;
    };

    return await new Promise<string | undefined>((resolve) => {
      let settled = false;
      let state = createRawInputParseState();
      const updateInput = createLogUpdate(this.output, { showCursor: true });
      let collapsedPastes: CollapsedPasteSegment[] = [];
      let nextPasteId = 1;
      let redrawTimer: NodeJS.Timeout | undefined;
      let pasteIndicatorActive = false;
      let bracketedPasteStartBufferLength: number | undefined;

      const cleanup = () => {
        if (redrawTimer) {
          clearTimeout(redrawTimer);
          redrawTimer = undefined;
        }
        input.setRawMode(false);
        this.output.write('\u001B[?2004l');
        updateInput.clear();
      };

      const redrawNow = () => {
        const visualBuffer = buildVisualInputBuffer(
          state.buffer,
          collapsedPastes,
          pasteIndicatorActive,
          bracketedPasteStartBufferLength
        );
        const { frame, cursorCol } = buildInputFrame(visualBuffer, this.output.columns ?? 80);
        updateInput(frame);
        this.output.write('\u001B[1A\r');
        if (cursorCol > 0) {
          this.output.write(`\u001B[${cursorCol}C`);
        }
      };

      const redraw = (immediate = false) => {
        if (immediate) {
          if (redrawTimer) {
            clearTimeout(redrawTimer);
            redrawTimer = undefined;
          }
          redrawNow();
          return;
        }
        if (redrawTimer) {
          return;
        }
        redrawTimer = setTimeout(() => {
          redrawTimer = undefined;
          redrawNow();
        }, 16);
      };

      const finish = (value: string | undefined) => {
        if (settled) {
          return;
        }
        settled = true;
        this.cancelInputCapture = undefined;
        input.off('data', onData);
        cleanup();
        resolve(value);
      };

      const onData = (chunk: string | Buffer) => {
        try {
          const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
          if ((text === '\u007F' || text === '\b') && collapsedPastes.length > 0) {
            const tail = collapsedPastes[collapsedPastes.length - 1];
            if (tail && tail.end === state.buffer.length) {
              state = {
                buffer: state.buffer.slice(0, tail.start),
                inBracketedPaste: state.inBracketedPaste,
                pending: state.pending,
              };
              collapsedPastes = collapsedPastes.slice(0, -1);
              redraw(true);
              return;
            }
          }

          const previousBuffer = state.buffer;
          const wasInBracketedPaste = state.inBracketedPaste;
          const result = parseRawInputChunk(state, text);
          state = {
            buffer: result.buffer,
            inBracketedPaste: result.inBracketedPaste,
            pending: result.pending,
          };
          collapsedPastes = reconcileCollapsedPastes(collapsedPastes, previousBuffer, state.buffer);
          const enteredBracketedPaste = !wasInBracketedPaste && state.inBracketedPaste;
          const exitedBracketedPaste = wasInBracketedPaste && !state.inBracketedPaste;

          if (enteredBracketedPaste) {
            bracketedPasteStartBufferLength = previousBuffer.length;
            pasteIndicatorActive = true;
            redraw(true);
          }

          if (!state.inBracketedPaste && exitedBracketedPaste) {
            const start = Math.max(
              0,
              Math.min(bracketedPasteStartBufferLength ?? 0, state.buffer.length)
            );
            const pasted = state.buffer.slice(start);
            bracketedPasteStartBufferLength = undefined;
            if (shouldCollapsePastedAppend('\u001B[200~\u001B[201~', pasted)) {
              const candidate: CollapsedPasteSegment = {
                id: nextPasteId,
                start,
                end: state.buffer.length,
                lineCount: countLines(pasted),
              };
              const upserted = upsertCollapsedPasteSegment(
                collapsedPastes,
                state.buffer,
                candidate
              );
              collapsedPastes = upserted.segments;
              if (upserted.consumedNewId) {
                nextPasteId += 1;
              }
            }
            pasteIndicatorActive = false;
          }

          if (!result.submitted && !result.aborted && !state.inBracketedPaste) {
            const appended = appendedSuffix(previousBuffer, state.buffer);
            if (shouldCollapsePastedAppend(text, appended)) {
              const candidate: CollapsedPasteSegment = {
                id: nextPasteId,
                start: previousBuffer.length,
                end: state.buffer.length,
                lineCount: countLines(appended),
              };
              const upserted = upsertCollapsedPasteSegment(
                collapsedPastes,
                state.buffer,
                candidate
              );
              collapsedPastes = upserted.segments;
              if (upserted.consumedNewId) {
                nextPasteId += 1;
              }
            }
          }
          redraw(!state.inBracketedPaste);
          if (result.aborted) {
            finish(undefined);
            return;
          }
          if (
            shouldSuppressSubmitAfterBracketedPasteChunk(
              text,
              exitedBracketedPaste,
              result.submitted
            )
          ) {
            return;
          }
          if (result.submitted) {
            finish(state.buffer);
          }
        } catch {
          // On any error, cleanup and abort
          finish(undefined);
        }
      };

      this.cancelInputCapture = () => finish(undefined);
      input.setRawMode(true);
      input.on('data', onData);
      this.output.write('\u001B[?2004h');
      redraw(true);
    });
  }

  private handleSlashCommand(input: string): boolean {
    const trimmed = input.trim();
    const parts = trimmed.split(/\s+/);
    const cmd = parts[0]?.toLowerCase();
    if (!cmd) {
      return false;
    }

    if (cmd === '/help') {
      this.ui.dispatch({
        type: 'message.system',
        text: 'Commands: /help, /status, /tools [compact|full], /abort, /exit',
      });
      return true;
    }

    if (cmd === '/status') {
      const state = this.ui.getState();
      this.ui.dispatch({
        type: 'message.system',
        text:
          `status=${state.status} turns=${state.turnCount} loop=${state.loopIndex} step=${state.stepIndex} ` +
          `tools=${state.toolEventCount} toolMode=${state.compactToolOutput ? 'compact' : 'full'}`,
      });
      return true;
    }

    if (cmd === '/tools') {
      const mode = parts[1]?.toLowerCase();
      if (mode === 'compact') {
        this.ui.dispatch({ type: 'setting.compactToolOutput', compact: true });
        this.ui.dispatch({ type: 'message.system', text: 'Tool output mode set to compact.' });
      } else if (mode === 'full') {
        this.ui.dispatch({ type: 'setting.compactToolOutput', compact: false });
        this.ui.dispatch({ type: 'message.system', text: 'Tool output mode set to full.' });
      } else {
        const state = this.ui.getState();
        this.ui.dispatch({
          type: 'message.system',
          text: `Tool output mode=${state.compactToolOutput ? 'compact' : 'full'}. Use /tools compact|full`,
        });
      }
      return true;
    }

    if (cmd === '/abort') {
      if (this.runInFlight) {
        this.agent.abort();
        this.ui.dispatch({ type: 'message.system', text: 'Abort requested.' });
      } else {
        this.ui.dispatch({ type: 'message.system', text: 'No active run to abort.' });
      }
      return true;
    }

    return false;
  }
}
