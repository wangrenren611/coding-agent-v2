import { describe, expect, it } from 'vitest';
import { detectCommand, parseCliArgs } from '../args';

describe('parseCliArgs', () => {
  it('parses prompt positional args', () => {
    const parsed = parseCliArgs(['hello', 'world']);
    expect(parsed.positional).toEqual(['hello', 'world']);
    expect(parsed.quiet).toBe(false);
  });

  it('parses quiet mode with model', () => {
    const parsed = parseCliArgs(['-q', '-m', 'glm-4.7', 'test']);
    expect(parsed.quiet).toBe(true);
    expect(parsed.model).toBe('glm-4.7');
    expect(parsed.positional).toEqual(['test']);
  });

  it('throws when resume and continue are both set', () => {
    expect(() => parseCliArgs(['--resume', 's1', '--continue'])).toThrow(
      'Cannot use --resume and --continue together'
    );
  });

  it('throws when new-session conflicts with continue/resume', () => {
    expect(() => parseCliArgs(['--new-session', '--continue'])).toThrow(
      'Cannot use --new-session and --continue together'
    );
    expect(() => parseCliArgs(['--new-session', '--resume', 's1'])).toThrow(
      'Cannot use --new-session and --resume together'
    );
  });

  it('parses short new-session flag', () => {
    const parsed = parseCliArgs(['-n', 'hello']);
    expect(parsed.newSession).toBe(true);
    expect(parsed.positional).toEqual(['hello']);
  });

  it('supports tools json option', () => {
    const parsed = parseCliArgs(['--tools', '{"bash":false}']);
    expect(parsed.tools).toBe('{"bash":false}');
  });
});

describe('detectCommand', () => {
  it('detects supported command', () => {
    const parsed = parseCliArgs(['session', 'list']);
    expect(detectCommand(parsed)).toBe('session');
  });

  it('detects task command', () => {
    const parsed = parseCliArgs(['task', 'help']);
    expect(detectCommand(parsed)).toBe('task');
  });

  it('returns undefined for prompt input', () => {
    const parsed = parseCliArgs(['build', 'a', 'cli']);
    expect(detectCommand(parsed)).toBeUndefined();
  });
});
