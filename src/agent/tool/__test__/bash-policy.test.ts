import { describe, expect, it } from 'vitest';
import {
  evaluateBashPolicy,
  extractSegmentCommands,
  getBashDangerousCommands,
  getBashDangerousPatterns,
} from '../bash-policy';

describe('extractSegmentCommands', () => {
  it('extracts single command', () => {
    const result = extractSegmentCommands('ls -la');
    expect(result).toEqual(['ls']);
  });

  it('extracts multiple commands with pipes', () => {
    const result = extractSegmentCommands('ls -la | grep test');
    expect(result).toEqual(['ls', 'grep']);
  });

  it('extracts commands with semicolons', () => {
    const result = extractSegmentCommands('ls; cd /tmp; pwd');
    expect(result).toEqual(['ls', 'cd', 'pwd']);
  });

  it('extracts commands with && and ||', () => {
    const result = extractSegmentCommands('ls && cd /tmp || pwd');
    expect(result).toEqual(['ls', 'cd', 'pwd']);
  });

  it('handles commands with paths', () => {
    const result = extractSegmentCommands('/usr/bin/ls -la');
    // Commands are normalized to lowercase basename
    expect(result).toEqual(['ls']);
  });

  it('handles commands with environment variables', () => {
    const result = extractSegmentCommands('VAR=value ls -la');
    expect(result).toEqual(['ls']);
  });

  it('handles empty command', () => {
    const result = extractSegmentCommands('');
    expect(result).toEqual([]);
  });

  it('handles command with only whitespace', () => {
    const result = extractSegmentCommands('   ');
    expect(result).toEqual([]);
  });

  it('handles complex command with subshells', () => {
    const result = extractSegmentCommands('$(echo ls) -la');
    // extractSegmentCommands extracts $ as a token
    expect(result).toEqual(['$']);
  });

  it('handles command with quotes', () => {
    const result = extractSegmentCommands('echo "hello world"');
    expect(result).toEqual(['echo']);
  });
});

describe('getBashDangerousCommands', () => {
  it('returns Set of dangerous commands', () => {
    const commands = getBashDangerousCommands();
    expect(commands).toBeInstanceOf(Set);
    expect(commands.size).toBeGreaterThan(0);
  });

  it('contains expected dangerous commands', () => {
    const commands = getBashDangerousCommands();
    // Commands are stored in lowercase
    expect(commands.has('sudo')).toBe(true);
    expect(commands.has('su')).toBe(true);
    expect(commands.has('rm')).toBe(false); // rm is not in the dangerous commands set
    expect(commands.has('mkfs')).toBe(true);
    expect(commands.has('fdisk')).toBe(true);
  });

  it('does not contain safe commands', () => {
    const commands = getBashDangerousCommands();
    expect(commands.has('ls')).toBe(false);
    expect(commands.has('cat')).toBe(false);
    expect(commands.has('echo')).toBe(false);
  });

  it('includes platform-specific dangerous commands', () => {
    const linuxCommands = getBashDangerousCommands('linux');
    const darwinCommands = getBashDangerousCommands('darwin');
    const win32Commands = getBashDangerousCommands('win32');

    // All platforms should have common dangerous commands
    expect(linuxCommands.has('sudo')).toBe(true);
    expect(darwinCommands.has('sudo')).toBe(true);
    expect(win32Commands.has('sudo')).toBe(true);
  });
});

describe('getBashDangerousPatterns', () => {
  it('returns array of dangerous patterns', () => {
    const patterns = getBashDangerousPatterns();
    expect(Array.isArray(patterns)).toBe(true);
    expect(patterns.length).toBeGreaterThan(0);
  });

  it('each pattern has pattern and reason', () => {
    const patterns = getBashDangerousPatterns();
    patterns.forEach((p) => {
      expect(p).toHaveProperty('pattern');
      expect(p).toHaveProperty('reason');
      expect(p.pattern).toBeInstanceOf(RegExp);
      expect(typeof p.reason).toBe('string');
    });
  });

  it('includes rm -rf pattern', () => {
    const patterns = getBashDangerousPatterns();
    const rmPattern = patterns.find((p) => p.reason.toLowerCase().includes('deletion'));
    expect(rmPattern).toBeDefined();
  });

  it('includes fork bomb pattern', () => {
    const patterns = getBashDangerousPatterns();
    const forkBomb = patterns.find((p) => p.reason.toLowerCase().includes('fork'));
    expect(forkBomb).toBeDefined();
  });

  it('returns platform-specific patterns', () => {
    const linuxPatterns = getBashDangerousPatterns('linux');
    const darwinPatterns = getBashDangerousPatterns('darwin');
    const win32Patterns = getBashDangerousPatterns('win32');

    // All platforms should have common patterns
    expect(linuxPatterns.length).toBeGreaterThan(0);
    expect(darwinPatterns.length).toBeGreaterThan(0);
    expect(win32Patterns.length).toBeGreaterThan(0);
  });
});

describe('evaluateBashPolicy', () => {
  it('allows safe commands in permissive mode', () => {
    const result = evaluateBashPolicy('ls -la', {
      mode: 'permissive',
    });

    expect(result.effect).toBe('allow');
    expect(result.commands).toEqual(['ls']);
  });

  it('denies dangerous commands in permissive mode', () => {
    const result = evaluateBashPolicy('sudo ls', {
      mode: 'permissive',
    });

    // In permissive mode, dangerous commands should still be denied
    expect(result.effect).toBe('deny');
    expect(result.reason).toContain('sudo');
  });

  it('denies dangerous commands in guarded mode', () => {
    const result = evaluateBashPolicy('sudo ls', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('deny');
    expect(result.reason).toContain('sudo');
  });

  it('allows safe commands in guarded mode', () => {
    const result = evaluateBashPolicy('ls -la', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
  });

  it('handles multiple dangerous commands', () => {
    const result = evaluateBashPolicy('sudo rm -rf /', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('deny');
    // When a dangerous pattern is matched, commands array is empty
    expect(result.commands).toEqual([]);
  });

  it('handles commands with pipes', () => {
    const result = evaluateBashPolicy('ls | grep test', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
    expect(result.commands).toEqual(['ls', 'grep']);
  });

  it('handles empty command', () => {
    const result = evaluateBashPolicy('', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
    expect(result.commands).toEqual([]);
  });

  it('handles command with only whitespace', () => {
    const result = evaluateBashPolicy('   ', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
    expect(result.commands).toEqual([]);
  });

  it('uses allowlistMissEffect when provided', () => {
    const result = evaluateBashPolicy('unknown-command', {
      mode: 'guarded',
      allowlistMissEffect: 'deny',
    });

    expect(result.effect).toBe('deny');
  });

  it('uses allowlistMissReason when provided', () => {
    const result = evaluateBashPolicy('unknown-command', {
      mode: 'guarded',
      allowlistMissEffect: 'deny',
      allowlistMissReason: (cmd) => `Command ${cmd} is not allowed`,
    });

    expect(result.reason).toContain('unknown-command');
  });

  it('handles allowlistBypassed flag', () => {
    const result = evaluateBashPolicy('sudo ls', {
      mode: 'guarded',
      allowlistBypassed: true,
    });

    // When allowlist is bypassed, dangerous commands should still be denied
    expect(result.effect).toBe('deny');
  });

  it('handles platform-specific commands', () => {
    const result = evaluateBashPolicy('diskutil list', {
      mode: 'guarded',
      platform: 'darwin',
    });

    expect(result.effect).toBe('deny');
    expect(result.reason).toContain('diskutil');
  });

  it('handles Windows-specific commands', () => {
    const result = evaluateBashPolicy('format C:', {
      mode: 'guarded',
      platform: 'win32',
    });

    expect(result.effect).toBe('deny');
  });

  it('handles Linux-specific commands', () => {
    const result = evaluateBashPolicy('systemctl start service', {
      mode: 'guarded',
      platform: 'linux',
    });

    expect(result.effect).toBe('deny');
    expect(result.reason).toContain('systemctl');
  });

  it('handles command with redirection', () => {
    const result = evaluateBashPolicy('echo "test" > /etc/passwd', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('deny');
  });

  it('handles command with background process', () => {
    const result = evaluateBashPolicy('sleep 10 &', {
      mode: 'guarded',
    });

    // sleep is not in the allowed commands list
    expect(result.effect).toBe('deny');
  });

  it('handles command with command substitution', () => {
    const result = evaluateBashPolicy('$(rm -rf /)', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('deny');
  });

  it('handles command with variable assignment', () => {
    const result = evaluateBashPolicy('VAR=value ls', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
  });

  it('handles command with multiple statements', () => {
    const result = evaluateBashPolicy('ls; cd /tmp; pwd', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
    expect(result.commands).toEqual(['ls', 'cd', 'pwd']);
  });

  it('handles command with conditional execution', () => {
    const result = evaluateBashPolicy('ls && cd /tmp || pwd', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
    expect(result.commands).toEqual(['ls', 'cd', 'pwd']);
  });

  it('handles command with subshell', () => {
    const result = evaluateBashPolicy('(ls -la)', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
  });

  it('handles command with function definition', () => {
    const result = evaluateBashPolicy('function test() { ls; }', {
      mode: 'guarded',
    });

    // function is not in the allowed commands list
    expect(result.effect).toBe('deny');
  });

  it('handles command with here document', () => {
    const result = evaluateBashPolicy('cat << EOF\nhello\nEOF', {
      mode: 'guarded',
    });

    expect(result.effect).toBe('allow');
  });

  it('handles command with process substitution', () => {
    const result = evaluateBashPolicy('diff <(ls dir1) <(ls dir2)', {
      mode: 'guarded',
    });

    // diff is not in the allowed commands list
    expect(result.effect).toBe('deny');
  });
});
