import * as path from 'node:path';
import { parse } from 'shell-quote';

export type BashPolicyMode = 'guarded' | 'permissive';
export type BashPolicyEffect = 'allow' | 'ask' | 'deny';

export interface BashDangerousPattern {
  pattern: RegExp;
  reason: string;
}

export interface EvaluateBashPolicyOptions {
  platform?: NodeJS.Platform;
  mode?: BashPolicyMode;
  allowlistMissEffect?: Extract<BashPolicyEffect, 'ask' | 'deny'>;
  allowlistMissReason?: (commandName: string) => string;
  allowlistBypassed?: boolean;
}

export interface EvaluateBashPolicyResult {
  effect: BashPolicyEffect;
  reason?: string;
  commands: string[];
}

const MAX_POLICY_RECURSION_DEPTH = 4;

const COMMON_DANGEROUS_COMMANDS = new Set([
  'sudo',
  'su',
  'passwd',
  'visudo',
  'useradd',
  'userdel',
  'groupadd',
  'groupdel',
  'shutdown',
  'reboot',
  'halt',
  'poweroff',
  'mkfs',
  'fdisk',
  'diskutil',
  'mount',
  'umount',
  'systemctl',
  'service',
  'launchctl',
]);

const WINDOWS_DANGEROUS_COMMANDS = new Set([
  'format',
  'diskpart',
  'bcdedit',
  'vssadmin',
  'wbadmin',
  'reg',
  'sc',
]);

const COMMON_ALLOWED_COMMANDS = new Set([
  'ls',
  'pwd',
  'cat',
  'head',
  'tail',
  'echo',
  'printf',
  'wc',
  'sort',
  'uniq',
  'cut',
  'awk',
  'sed',
  'grep',
  'egrep',
  'fgrep',
  'rg',
  'find',
  'stat',
  'du',
  'df',
  'tree',
  'which',
  'whereis',
  'dirname',
  'basename',
  'realpath',
  'readlink',
  'file',
  'env',
  'printenv',
  'date',
  'uname',
  'whoami',
  'id',
  'hostname',
  'ps',
  'top',
  'uptime',
  'git',
  'gh',
  'npm',
  'pnpm',
  'yarn',
  'bun',
  'node',
  'npx',
  'tsx',
  'ts-node',
  'tsc',
  'python',
  'python3',
  'pip',
  'pip3',
  'uv',
  'poetry',
  'pytest',
  'go',
  'cargo',
  'rustc',
  'rustup',
  'javac',
  'java',
  'mvn',
  'gradle',
  'dotnet',
  'docker-compose',
  'helm',
  'make',
  'cmake',
  'ninja',
  'cp',
  'mv',
  'mkdir',
  'touch',
  'ln',
  'chmod',
  'chown',
  'tar',
  'zip',
  'unzip',
  'gzip',
  'gunzip',
  'rsync',
  'sh',
  'bash',
  'zsh',
  'true',
  'false',
  'test',
  'cd',
  'export',
  'unset',
  'set',
  'source',
  'curl',
  'wget',
  'ping',
  'nc',
  'ssh',
  'scp',
  'jq',
  'yq',
  'fzf',
  'bat',
  'exa',
  'fd',
  'ripgrep',
  'code',
  'vim',
  'nvim',
]);

const WINDOWS_ALLOWED_COMMANDS = new Set([
  'dir',
  'type',
  'more',
  'findstr',
  'where',
  'copy',
  'move',
  'attrib',
  'icacls',
  'mklink',
  'powershell',
  'pwsh',
  'cmd',
]);

const MACOS_ALLOWED_COMMANDS = new Set(['open', 'pbcopy', 'pbpaste', 'launchctl']);

const COMMON_DANGEROUS_PATTERNS: BashDangerousPattern[] = [
  { pattern: /\brm\s+-rf\s+\/(\s|$)/i, reason: 'Refusing destructive root deletion command' },
  {
    pattern: /\brm\s+-rf\s+--no-preserve-root\b/i,
    reason: 'Refusing destructive root deletion command',
  },
  { pattern: /:\(\)\s*\{\s*:\|:&\s*\};:/, reason: 'Refusing fork bomb pattern' },
  {
    pattern: /\b(curl|wget)[^|\n]*\|\s*(sh|bash|zsh)\b/i,
    reason: 'Refusing remote script pipe execution',
  },
  {
    pattern: /\b(eval|source)\s+<\s*\((curl|wget)\b/i,
    reason: 'Refusing remote script evaluation',
  },
  {
    pattern: /\bdd\s+[^|\n]*\bof=\/dev\/(sd|disk|nvme|rdisk)/i,
    reason: 'Refusing raw disk write command',
  },
  {
    pattern:
      />{1,2}\s*\/(etc|bin|sbin|usr|boot|proc|sys)\b|>{1,2}\s*\/dev(?:\/(?!null\b|stdout\b|stderr\b)[^\s;|&]+|(?=[\s;|&]|$))/i,
    reason: 'Refusing write redirection to protected system path',
  },
  {
    pattern:
      /\btee\s+\/(etc|bin|sbin|usr|boot|proc|sys)\b|\btee\s+\/dev(?:\/(?!null\b|stdout\b|stderr\b)[^\s;|&]+|(?=[\s;|&]|$))/i,
    reason: 'Refusing write to protected system path',
  },
  {
    pattern: /\b(sh|bash|zsh)\s+-[a-z]*c[a-z]*\b/i,
    reason: 'Nested shell execution is blocked by policy',
  },
  {
    pattern: /\b(sh|bash|zsh)\s+--command\b/i,
    reason: 'Nested shell execution is blocked by policy',
  },
  {
    pattern: /\beval\s+/i,
    reason: 'eval command is blocked for security reasons',
  },
  {
    pattern: /\bexec\s+/i,
    reason: 'exec command is blocked for security reasons',
  },
  {
    pattern: /\bpython(?:3)?\s+-[a-z]*c[a-z]*\b/i,
    reason: 'Inline Python execution is blocked for security reasons',
  },
  {
    pattern: /\b(node|nodejs)\s+(?:--eval|-e)\b/i,
    reason: 'Inline Node.js execution is blocked for security reasons',
  },
];

const WINDOWS_DANGEROUS_PATTERNS: BashDangerousPattern[] = [
  {
    pattern: /\b(rd|rmdir)\s+\/s\s+\/q\s+[a-z]:\\\s*$/i,
    reason: 'Refusing recursive drive root deletion command',
  },
  {
    pattern: /\b(del|erase)\s+\/[a-z]*\s+[a-z]:\\\*\s*$/i,
    reason: 'Refusing destructive drive wildcard deletion command',
  },
  {
    pattern: />{1,2}\s*[a-z]:\\(windows|program files|programdata)\\?/i,
    reason: 'Refusing write redirection to protected Windows path',
  },
  {
    pattern: /\breg\s+(add|delete)\s+hk(lm|cu)\\(software|system)(\\|$)/i,
    reason: 'Refusing registry mutation on critical hive',
  },
];

const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.cmd', '.bat', '.com', '.ps1']);

function normalizeCommandToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) {
    return '';
  }

  const unixLikePath = trimmed.replace(/\\/g, '/');
  const basename = path.posix.basename(unixLikePath);
  const lower = basename.toLowerCase();
  const extension = path.posix.extname(lower);

  if (WINDOWS_EXECUTABLE_EXTENSIONS.has(extension)) {
    return lower.slice(0, -extension.length);
  }

  return lower;
}

function collectParenthesizedSubcommands(command: string, marker: '$(' | '<(' | '>('): string[] {
  const snippets: string[] = [];
  const markerLength = marker.length;
  const length = command.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < length; i += 1) {
    const char = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote) {
      continue;
    }

    if (!command.startsWith(marker, i)) {
      continue;
    }

    const contentStart = i + markerLength;
    let depth = 1;
    let innerSingleQuote = false;
    let innerDoubleQuote = false;
    let innerEscaped = false;
    let closedAt = -1;

    for (let j = contentStart; j < length; j += 1) {
      const innerChar = command[j];
      if (innerEscaped) {
        innerEscaped = false;
        continue;
      }

      if (innerChar === '\\' && !innerSingleQuote) {
        innerEscaped = true;
        continue;
      }

      if (innerChar === "'" && !innerDoubleQuote) {
        innerSingleQuote = !innerSingleQuote;
        continue;
      }

      if (innerChar === '"' && !innerSingleQuote) {
        innerDoubleQuote = !innerDoubleQuote;
        continue;
      }

      if (innerSingleQuote || innerDoubleQuote) {
        continue;
      }

      if (
        j + 1 < length &&
        (command[j] === '$' || command[j] === '<' || command[j] === '>') &&
        command[j + 1] === '('
      ) {
        depth += 1;
        j += 1;
        continue;
      }

      if (innerChar === ')') {
        depth -= 1;
        if (depth === 0) {
          closedAt = j;
          break;
        }
      }
    }

    if (closedAt > contentStart) {
      const snippet = command.slice(contentStart, closedAt).trim();
      if (snippet) {
        snippets.push(snippet);
      }
      i = closedAt;
    }
  }

  return snippets;
}

function collectBacktickSubcommands(command: string): string[] {
  const snippets: string[] = [];
  const length = command.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let captureStart = -1;

  for (let i = 0; i < length; i += 1) {
    const char = command[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }

    if (char === "'" && captureStart === -1 && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }

    if (char === '"' && captureStart === -1 && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }

    if (inSingleQuote) {
      continue;
    }

    if (char !== '`') {
      continue;
    }

    if (captureStart === -1) {
      captureStart = i + 1;
      continue;
    }

    if (i > captureStart) {
      const snippet = command.slice(captureStart, i).trim();
      if (snippet) {
        snippets.push(snippet);
      }
    }
    captureStart = -1;
  }

  return snippets;
}

function extractNestedCommands(command: string): string[] {
  return [
    ...collectParenthesizedSubcommands(command, '$('),
    ...collectParenthesizedSubcommands(command, '<('),
    ...collectParenthesizedSubcommands(command, '>('),
    ...collectBacktickSubcommands(command),
  ];
}

function isOperatorToken(token: unknown): token is { op: string } {
  return typeof token === 'object' && token !== null && 'op' in token;
}

function evaluateBashPolicyInternal(
  command: string,
  options: EvaluateBashPolicyOptions = {},
  depth = 0
): EvaluateBashPolicyResult {
  if (depth > MAX_POLICY_RECURSION_DEPTH) {
    return {
      effect: 'deny',
      reason: 'Command nesting depth exceeded policy limit',
      commands: [],
    };
  }

  const normalizedCommand = command.trim();
  const mode = options.mode ?? 'guarded';
  const allowlistMissEffect = options.allowlistMissEffect ?? 'deny';
  const allowlistMissReason =
    options.allowlistMissReason ??
    ((commandName: string) =>
      `Command "${commandName}" is not in allowed command list (set BASH_TOOL_POLICY=permissive to bypass)`);
  const platform = options.platform ?? process.platform;

  if (!normalizedCommand) {
    return { effect: 'allow', commands: [] };
  }

  for (const rule of getBashDangerousPatterns(platform)) {
    if (rule.pattern.test(normalizedCommand)) {
      return {
        effect: 'deny',
        reason: rule.reason,
        commands: [],
      };
    }
  }

  const nestedCommands = extractNestedCommands(normalizedCommand);
  const nestedExtractedCommands: string[] = [];

  for (const nestedCommand of nestedCommands) {
    const nestedResult = evaluateBashPolicyInternal(nestedCommand, options, depth + 1);
    nestedExtractedCommands.push(...nestedResult.commands);

    if (nestedResult.effect !== 'allow') {
      return {
        effect: nestedResult.effect,
        reason:
          nestedResult.reason ?? `Nested command "${nestedCommand}" is blocked by security policy`,
        commands: nestedExtractedCommands,
      };
    }
  }

  const commands = extractSegmentCommands(normalizedCommand);
  if (commands.length === 0) {
    return {
      effect: 'deny',
      reason: 'Unable to parse executable command',
      commands: nestedExtractedCommands,
    };
  }

  const allCommands = [...nestedExtractedCommands, ...commands];

  const dangerousCommands = getBashDangerousCommands(platform);
  for (const commandName of allCommands) {
    if (dangerousCommands.has(commandName)) {
      return {
        effect: 'deny',
        reason: `Command "${commandName}" is blocked by security policy`,
        commands: allCommands,
      };
    }
  }

  if (mode === 'guarded' && !options.allowlistBypassed) {
    const allowedCommands = getBashAllowedCommands(platform);
    for (const commandName of allCommands) {
      if (!allowedCommands.has(commandName)) {
        return {
          effect: allowlistMissEffect,
          reason: allowlistMissReason(commandName),
          commands: allCommands,
        };
      }
    }
  }

  return { effect: 'allow', commands: allCommands };
}

export function extractSegmentCommands(command: string): string[] {
  const tokens = parse(command);
  const commands: string[] = [];
  let expectingCommand = true;

  for (const token of tokens) {
    if (isOperatorToken(token)) {
      const operator = String(token.op || '');
      if (
        operator === '|' ||
        operator === '||' ||
        operator === '&&' ||
        operator === ';' ||
        operator === '&' ||
        operator === '\n'
      ) {
        expectingCommand = true;
      }
      continue;
    }

    if (typeof token !== 'string' || !expectingCommand) {
      continue;
    }

    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue;
    }

    const normalized = normalizeCommandToken(token);
    if (!normalized) {
      continue;
    }

    commands.push(normalized);
    expectingCommand = false;
  }

  return commands;
}

export function getBashAllowedCommands(platform: NodeJS.Platform = process.platform): Set<string> {
  const commands = new Set(COMMON_ALLOWED_COMMANDS);

  if (platform === 'win32') {
    for (const commandName of WINDOWS_ALLOWED_COMMANDS) {
      commands.add(commandName);
    }
  }

  if (platform === 'darwin') {
    for (const commandName of MACOS_ALLOWED_COMMANDS) {
      commands.add(commandName);
    }
  }

  return commands;
}

export function getBashDangerousCommands(
  platform: NodeJS.Platform = process.platform
): Set<string> {
  const commands = new Set(COMMON_DANGEROUS_COMMANDS);

  if (platform === 'win32') {
    for (const commandName of WINDOWS_DANGEROUS_COMMANDS) {
      commands.add(commandName);
    }
  }

  return commands;
}

export function getBashDangerousPatterns(
  platform: NodeJS.Platform = process.platform
): BashDangerousPattern[] {
  if (platform === 'win32') {
    return [...COMMON_DANGEROUS_PATTERNS, ...WINDOWS_DANGEROUS_PATTERNS];
  }
  return [...COMMON_DANGEROUS_PATTERNS];
}

export function evaluateBashPolicy(
  command: string,
  options: EvaluateBashPolicyOptions = {}
): EvaluateBashPolicyResult {
  return evaluateBashPolicyInternal(command, options);
}
