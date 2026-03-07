import { describe, expect, it } from 'vitest';
import {
  appendedSuffix,
  buildVisualInputBuffer,
  buildInputFrame,
  formatInputDraftForDisplay,
  reconcileCollapsedPastes,
  renderBufferWithCollapsedPastes,
  shouldSuppressSubmitAfterBracketedPasteChunk,
  shouldCollapsePastedAppend,
  upsertCollapsedPasteSegment,
  type CollapsedPasteSegment,
} from '../controller';

describe('formatInputDraftForDisplay', () => {
  it('renders single-line input with prompt prefix', () => {
    const out = formatInputDraftForDisplay('你好');
    expect(out).toBe('❯ 你好');
  });

  it('renders multiline input like textarea and keeps tail content visible', () => {
    const out = formatInputDraftForDisplay('第一行内容很长很长\n第二行后续输入');
    expect(out).toBe('❯ 第一行内容很长很长\n第二行后续输入');
    expect(out).toContain('第二行后续输入');
  });

  it('strips control characters but preserves newlines', () => {
    const out = formatInputDraftForDisplay('abc\u0007\u001B[31m\ndef');
    expect(out).toBe('❯ abc\ndef');
  });

  it('collapses long pasted multiline append into a placeholder', () => {
    const pasted = `line1\nline2\nline3\nline4\nline5\nline6\nline7`;
    expect(shouldCollapsePastedAppend('\u001B[200~' + pasted + '\u001B[201~', pasted)).toBe(true);

    const segment: CollapsedPasteSegment = {
      id: 1,
      start: 0,
      end: pasted.length,
      lineCount: pasted.split('\n').length,
    };
    const rendered = renderBufferWithCollapsedPastes(pasted, [segment]);
    expect(rendered).toBe('[Pasted text #1 +6 lines]');
    expect(formatInputDraftForDisplay(rendered)).toBe('❯ [Pasted text #1 +6 lines]');
  });

  it('drops collapsed segment metadata when underlying buffer shrinks past segment end', () => {
    const previous = 'prefix\nline2\nline3\nline4\nline5\nline6\nline7';
    const current = 'prefix';
    const segments: CollapsedPasteSegment[] = [
      { id: 1, start: 6, end: previous.length, lineCount: 7 },
    ];
    const next = reconcileCollapsedPastes(segments, previous, current);
    expect(next).toEqual([]);
    expect(appendedSuffix(previous, current)).toBe('');
  });

  it('builds wrapped input frame and keeps cursor on last line', () => {
    const built = buildInputFrame('第一行很长很长很长很长很长很长\n第二行后续内容', 20);
    const lines = built.frame.split('\n');
    expect(lines.length).toBeGreaterThan(1);
    expect(lines[0]?.startsWith('❯ ')).toBe(true);
    const last = lines[lines.length - 1] ?? '';
    expect(built.cursorCol).toBeGreaterThan(0);
    expect(last.length).toBeGreaterThan(0);
  });

  it('merges consecutive collapsed segments from one continuous paste stream', () => {
    const buffer = 'A\nB\nC\nD\nE\nF\nG\nH\nI\nJ\nK\nL';
    const first: CollapsedPasteSegment = {
      id: 1,
      start: 0,
      end: 11,
      lineCount: 6,
    };
    const second: CollapsedPasteSegment = {
      id: 2,
      start: 11,
      end: buffer.length,
      lineCount: 6,
    };

    const merged = upsertCollapsedPasteSegment([first], buffer, second);
    expect(merged.consumedNewId).toBe(false);
    expect(merged.segments).toHaveLength(1);
    expect(merged.segments[0]?.id).toBe(1);
    expect(merged.segments[0]?.lineCount).toBe(12);

    const rendered = renderBufferWithCollapsedPastes(buffer, merged.segments);
    expect(rendered).toBe('[Pasted text #1 +11 lines]');
  });

  it('hides in-progress bracketed paste content before collapse', () => {
    const stateBuffer = 'prefix\nhidden line1\nhidden line2';
    const visual = buildVisualInputBuffer(stateBuffer, [], true, 6);
    expect(visual).toBe('prefix');
    expect(visual).not.toContain('hidden line1');
  });

  it('suppresses auto-submit when bracketed paste chunk ends with trailing newline', () => {
    const chunk = '\u001B[200~hello\nworld\u001B[201~\n';
    expect(shouldSuppressSubmitAfterBracketedPasteChunk(chunk, true, true)).toBe(true);
    expect(shouldSuppressSubmitAfterBracketedPasteChunk(chunk, false, true)).toBe(false);
    expect(shouldSuppressSubmitAfterBracketedPasteChunk(chunk, true, false)).toBe(false);
  });
});
