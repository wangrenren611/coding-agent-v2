/**
 * Bash 命令安全策略模块
 *
 * 提供命令白名单/黑名单验证、危险模式检测
 */

import path from 'path';
import { parse } from 'shell-quote';

// =============================================================================
// 类型定义
// =============================================================================

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

// =============================================================================
// 命令列表
// =============================================================================

/**
 * 通用危险命令（始终阻止）
 */
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

/**
 * Windows 危险命令
 */
const WINDOWS_DANGEROUS_COMMANDS = new Set([
  'format',
  'diskpart',
  'bcdedit',
  'vssadmin',
  'wbadmin',
  'reg',
  'sc',
]);

/**
 * 通用允许命令（白名单）
 */
const COMMON_ALLOWED_COMMANDS = new Set([
  // 文件系统
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
  // 系统信息
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
  // 开发工具
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
  'docker',
  'docker-compose',
  'kubectl',
  'helm',
  'make',
  'cmake',
  'ninja',
  // 文件操作
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
  // Shell 内置
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
  // 网络
  'curl',
  'wget',
  'ping',
  'nc',
  'ssh',
  'scp',
  'rsync',
  // 其他
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

/**
 * Windows 允许命令
 */
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

/**
 * macOS 允许命令
 */
const MACOS_ALLOWED_COMMANDS = new Set(['open', 'pbcopy', 'pbpaste', 'launchctl']);

// =============================================================================
// 危险模式
// =============================================================================

/**
 * 通用危险模式
 */
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
    pattern: /\b(dd)\s+[^|\n]*\bof=\/dev\/(sd|disk|nvme|rdisk)/i,
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

/**
 * Windows 危险模式
 */
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

/**
 * Windows 可执行文件扩展名
 */
const WINDOWS_EXECUTABLE_EXTENSIONS = new Set(['.exe', '.cmd', '.bat', '.com', '.ps1']);

// =============================================================================
// 辅助函数
// =============================================================================

/**
 * 规范化命令令牌
 */
function normalizeCommandToken(token: string): string {
  const trimmed = token.trim();
  if (!trimmed) return '';

  const unixLikePath = trimmed.replace(/\\/g, '/');
  const basename = path.posix.basename(unixLikePath);
  const lower = basename.toLowerCase();
  const ext = path.posix.extname(lower);

  if (WINDOWS_EXECUTABLE_EXTENSIONS.has(ext)) {
    return lower.slice(0, -ext.length);
  }
  return lower;
}

function collectParenthesizedSubcommands(command: string, marker: '$(' | '<(' | '>('): string[] {
  const snippets: string[] = [];
  const markerLength = marker.length;
  const len = command.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;

  for (let i = 0; i < len; i += 1) {
    const ch = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }
    if (ch === "'" && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote) {
      continue;
    }

    if (command.startsWith(marker, i)) {
      const contentStart = i + markerLength;
      let depth = 1;
      let innerSingleQuote = false;
      let innerDoubleQuote = false;
      let innerEscaped = false;
      let closedAt = -1;

      for (let j = contentStart; j < len; j += 1) {
        const innerCh = command[j];
        if (innerEscaped) {
          innerEscaped = false;
          continue;
        }
        if (innerCh === '\\' && !innerSingleQuote) {
          innerEscaped = true;
          continue;
        }
        if (innerCh === "'" && !innerDoubleQuote) {
          innerSingleQuote = !innerSingleQuote;
          continue;
        }
        if (innerCh === '"' && !innerSingleQuote) {
          innerDoubleQuote = !innerDoubleQuote;
          continue;
        }
        if (innerSingleQuote || innerDoubleQuote) {
          continue;
        }

        if (
          j + 1 < len &&
          (command[j] === '$' || command[j] === '<' || command[j] === '>') &&
          command[j + 1] === '('
        ) {
          depth += 1;
          j += 1;
          continue;
        }

        if (innerCh === ')') {
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
  }

  return snippets;
}

function collectBacktickSubcommands(command: string): string[] {
  const snippets: string[] = [];
  const len = command.length;
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let escaped = false;
  let captureStart = -1;

  for (let i = 0; i < len; i += 1) {
    const ch = command[i];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (ch === '\\' && !inSingleQuote) {
      escaped = true;
      continue;
    }
    if (ch === "'" && captureStart === -1 && !inDoubleQuote) {
      inSingleQuote = !inSingleQuote;
      continue;
    }
    if (ch === '"' && captureStart === -1 && !inSingleQuote) {
      inDoubleQuote = !inDoubleQuote;
      continue;
    }
    if (inSingleQuote) {
      continue;
    }

    if (ch === '`') {
      if (captureStart === -1) {
        captureStart = i + 1;
      } else if (i > captureStart) {
        const snippet = command.slice(captureStart, i).trim();
        if (snippet) {
          snippets.push(snippet);
        }
        captureStart = -1;
      } else {
        captureStart = -1;
      }
    }
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

  // 空命令允许
  if (!normalizedCommand) {
    return { effect: 'allow', commands: [] };
  }

  // 检查危险模式
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
          nestedResult.reason ??
          `Nested command "${nestedCommand}" is blocked by security policy`,
        commands: nestedExtractedCommands,
      };
    }
  }

  // 提取命令
  const commands = extractSegmentCommands(normalizedCommand);
  if (commands.length === 0) {
    return {
      effect: 'deny',
      reason: 'Unable to parse executable command',
      commands: nestedExtractedCommands,
    };
  }

  const allCommands = [...nestedExtractedCommands, ...commands];

  // 检查危险命令
  const dangerousCommands = getBashDangerousCommands(platform);
  for (const cmd of allCommands) {
    if (dangerousCommands.has(cmd)) {
      return {
        effect: 'deny',
        reason: `Command "${cmd}" is blocked by security policy`,
        commands: allCommands,
      };
    }
  }

  // 在 guarded 模式下检查白名单
  if (mode === 'guarded' && !options.allowlistBypassed) {
    const allowedCommands = getBashAllowedCommands(platform);
    for (const cmd of allCommands) {
      if (!allowedCommands.has(cmd)) {
        return {
          effect: allowlistMissEffect,
          reason: allowlistMissReason(cmd),
          commands: allCommands,
        };
      }
    }
  }

  return { effect: 'allow', commands: allCommands };
}

/**
 * 从命令字符串中提取所有命令
 */
export function extractSegmentCommands(command: string): string[] {
  const tokens = parse(command);
  const commands: string[] = [];
  let expectingCommand = true;

  for (const token of tokens) {
    // 处理操作符
    if (typeof token === 'object' && token !== null && 'op' in token) {
      const op = String(token.op || '');
      if (op === '|' || op === '||' || op === '&&' || op === ';' || op === '&' || op === '\n') {
        expectingCommand = true;
      }
      continue;
    }

    if (typeof token !== 'string' || !expectingCommand) {
      continue;
    }

    // 跳过环境变量赋值
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) {
      continue;
    }

    const normalized = normalizeCommandToken(token);
    if (normalized) {
      commands.push(normalized);
      expectingCommand = false;
    }
  }

  return commands;
}

/**
 * 获取允许的命令列表
 */
export function getBashAllowedCommands(platform: NodeJS.Platform = process.platform): Set<string> {
  const commands = new Set(COMMON_ALLOWED_COMMANDS);

  if (platform === 'win32') {
    for (const command of WINDOWS_ALLOWED_COMMANDS) {
      commands.add(command);
    }
  }

  if (platform === 'darwin') {
    for (const command of MACOS_ALLOWED_COMMANDS) {
      commands.add(command);
    }
  }

  return commands;
}

/**
 * 获取危险命令列表
 */
export function getBashDangerousCommands(
  platform: NodeJS.Platform = process.platform
): Set<string> {
  const commands = new Set(COMMON_DANGEROUS_COMMANDS);

  if (platform === 'win32') {
    for (const command of WINDOWS_DANGEROUS_COMMANDS) {
      commands.add(command);
    }
  }

  return commands;
}

/**
 * 获取危险模式列表
 */
export function getBashDangerousPatterns(
  platform: NodeJS.Platform = process.platform
): BashDangerousPattern[] {
  if (platform === 'win32') {
    return [...COMMON_DANGEROUS_PATTERNS, ...WINDOWS_DANGEROUS_PATTERNS];
  }
  return [...COMMON_DANGEROUS_PATTERNS];
}

// =============================================================================
// 主函数
// =============================================================================

/**
 * 评估 Bash 命令安全策略
 *
 * @param command 要检查的命令
 * @param options 评估选项
 * @returns 评估结果
 */
export function evaluateBashPolicy(
  command: string,
  options: EvaluateBashPolicyOptions = {}
): EvaluateBashPolicyResult {
  return evaluateBashPolicyInternal(command, options);
}
