export interface RawInputParseState {
  buffer: string;
  inBracketedPaste: boolean;
  pending: string;
}

export interface RawInputParseResult extends RawInputParseState {
  submitted: boolean;
  aborted: boolean;
}

const BRACKETED_PASTE_START = '\u001B[200~';
const BRACKETED_PASTE_END = '\u001B[201~';

export function createRawInputParseState(): RawInputParseState {
  return {
    buffer: '',
    inBracketedPaste: false,
    pending: '',
  };
}

export function parseRawInputChunk(state: RawInputParseState, chunk: string): RawInputParseResult {
  let remaining = `${state.pending}${chunk}`;
  let buffer = state.buffer;
  let inBracketedPaste = state.inBracketedPaste;
  let submitted = false;
  let aborted = false;

  while (remaining.length > 0 && !submitted && !aborted) {
    if (inBracketedPaste) {
      const endIndex = remaining.indexOf(BRACKETED_PASTE_END);
      if (endIndex < 0) {
        buffer += normalizeNewlines(remaining);
        remaining = '';
        break;
      }
      buffer += normalizeNewlines(remaining.slice(0, endIndex));
      remaining = remaining.slice(endIndex + BRACKETED_PASTE_END.length);
      inBracketedPaste = false;
      continue;
    }

    const startIndex = remaining.indexOf(BRACKETED_PASTE_START);
    if (startIndex >= 0) {
      const head = remaining.slice(0, startIndex);
      const headResult = consumeInteractiveChunk(head, buffer);
      buffer = headResult.buffer;
      submitted = headResult.submitted;
      aborted = headResult.aborted;
      if (submitted || aborted) {
        remaining = '';
        break;
      }
      remaining = remaining.slice(startIndex + BRACKETED_PASTE_START.length);
      inBracketedPaste = true;
      continue;
    }

    const carryLength = getPossibleMarkerPrefixCarryLength(remaining, BRACKETED_PASTE_START);
    const consumable = remaining.slice(0, remaining.length - carryLength);
    const interactive = consumeInteractiveChunk(consumable, buffer);
    buffer = interactive.buffer;
    submitted = interactive.submitted;
    aborted = interactive.aborted;
    remaining = remaining.slice(remaining.length - carryLength);
    break;
  }

  return {
    buffer,
    inBracketedPaste,
    pending: submitted || aborted ? '' : remaining,
    submitted,
    aborted,
  };
}

function consumeInteractiveChunk(
  chunk: string,
  initialBuffer: string
): { buffer: string; submitted: boolean; aborted: boolean } {
  let buffer = initialBuffer;
  let submitted = false;
  let aborted = false;

  if (looksLikeUnwrappedPaste(chunk)) {
    return consumePasteLikeChunk(chunk, buffer);
  }

  for (let i = 0; i < chunk.length; i += 1) {
    const ch = chunk[i] ?? '';
    if (ch === '\u0003') {
      aborted = true;
      break;
    }
    if (ch === '\r' || ch === '\n') {
      submitted = true;
      break;
    }
    if (ch === '\u007F' || ch === '\b') {
      buffer = removeLastCodePoint(buffer);
      continue;
    }
    if (ch === '\u001B') {
      i = skipEscapeSequence(chunk, i);
      continue;
    }
    if (ch >= ' ' || ch === '\t') {
      buffer += ch;
    }
  }

  return { buffer, submitted, aborted };
}

function looksLikeUnwrappedPaste(chunk: string): boolean {
  if (chunk.length <= 8) {
    return false;
  }
  if (!/[\r\n]/.test(chunk) || !/[^\r\n]/.test(chunk)) {
    return false;
  }
  if (looksLikeInteractiveSubmitChunk(chunk)) {
    return false;
  }
  return true;
}

function looksLikeInteractiveSubmitChunk(chunk: string): boolean {
  const trimmedOneTerminator = trimOneLineTerminator(chunk);
  if (trimmedOneTerminator === chunk) {
    return false;
  }
  return !/[\r\n]/.test(trimmedOneTerminator);
}

function trimOneLineTerminator(input: string): string {
  if (input.endsWith('\r\n')) {
    return input.slice(0, -2);
  }
  if (input.endsWith('\n') || input.endsWith('\r')) {
    return input.slice(0, -1);
  }
  return input;
}

function consumePasteLikeChunk(
  chunk: string,
  initialBuffer: string
): { buffer: string; submitted: boolean; aborted: boolean } {
  let buffer = initialBuffer;
  const cleaned = normalizeNewlines(stripEscapeSequences(chunk));

  for (let i = 0; i < cleaned.length; i += 1) {
    const ch = cleaned[i] ?? '';
    if (ch === '\u0003') {
      return { buffer, submitted: false, aborted: true };
    }
    if (ch === '\u007F' || ch === '\b') {
      buffer = removeLastCodePoint(buffer);
      continue;
    }
    if (ch === '\u001B') {
      continue;
    }
    if (ch === '\n') {
      buffer += '\n';
      continue;
    }
    if (ch >= ' ' || ch === '\t') {
      buffer += ch;
    }
  }

  return { buffer, submitted: false, aborted: false };
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
}

function stripEscapeSequences(text: string): string {
  // Limit quantifier to prevent potential ReDoS on pathological input
  return text.replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]{0,16}[ -/]*[@-~]`, 'g'), '');
}

function getPossibleMarkerPrefixCarryLength(text: string, marker: string): number {
  const max = Math.min(text.length, marker.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (text.endsWith(marker.slice(0, length))) {
      return length;
    }
  }
  return 0;
}

function skipEscapeSequence(text: string, startIndex: number): number {
  const next = text[startIndex + 1] ?? '';
  if (next !== '[') {
    return startIndex;
  }
  let i = startIndex + 2;
  while (i < text.length) {
    const code = text.charCodeAt(i);
    if (code >= 0x40 && code <= 0x7e) {
      return i;
    }
    i += 1;
  }
  // Return text.length to indicate we consumed all remaining characters
  // The outer loop's i += 1 won't cause issues since we've reached the end
  return text.length;
}

function removeLastCodePoint(input: string): string {
  const chars = [...input];
  chars.pop();
  return chars.join('');
}
