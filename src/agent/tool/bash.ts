import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import * as fs from 'node:fs';
import * as fsp from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import stripAnsi from 'strip-ansi';
import { z } from 'zod';
import { BaseTool, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import { evaluateBashPolicy, type BashPolicyEffect, type BashPolicyMode } from './bash-policy';
import type { ToolExecutionContext } from './types';
import { BASH_TOOL_DESCRIPTION } from './tool-prompts';

const runInBackgroundSchema = z.preprocess((value) => {
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'true') {
      return true;
    }
    if (normalized === 'false') {
      return false;
    }
  }
  return value;
}, z.boolean());

const schema = z
  .object({
    command: z.string().min(1).describe('The bash command to run'),
    timeout: z
      .number()
      .int()
      .min(0)
      .max(600000)
      .optional()
      .describe('Command timeout in milliseconds'),
    run_in_background: runInBackgroundSchema.optional().describe('Run command in background'),
  })
  .strict();

interface PolicyDecision {
  effect: BashPolicyEffect;
  reason?: string;
}

interface CommandExecutionResult {
  exitCode: number;
  output: string;
  timedOut: boolean;
}

interface BackgroundExecutionResult {
  pid?: number;
  logPath: string;
}

type StreamEscapeParseMode = 'text' | 'escape' | 'csi' | 'osc' | 'dcs' | 'pm' | 'apc' | 'sos';

interface StreamChunkSanitizerState {
  mode: StreamEscapeParseMode;
  awaitingStringTerminator: boolean;
}

export interface BashToolOptions {
  defaultTimeoutMs?: number;
  backgroundLogDir?: string;
  policyMode?: BashPolicyMode;
  maxOutputLength?: number;
}

const CONFIRMABLE_DENY_REASON_PATTERNS: RegExp[] = [
  /Inline Python execution is blocked for security reasons/i,
  /Inline Node\.js execution is blocked for security reasons/i,
  /eval command is blocked for security reasons/i,
  /exec command is blocked for security reasons/i,
];

const WINDOWS_GIT_BASH_PATHS = [
  'C:/Program Files/Git/bin/bash.exe',
  'C:/Program Files (x86)/Git/bin/bash.exe',
];

export class BashTool extends BaseTool<typeof schema> {
  name = 'bash';
  description = BASH_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly defaultTimeoutMs: number;
  private readonly backgroundLogDir: string;
  private readonly policyMode: BashPolicyMode;
  private readonly maxOutputLength: number;

  constructor(options: BashToolOptions = {}) {
    super();
    this.defaultTimeoutMs =
      options.defaultTimeoutMs && options.defaultTimeoutMs > 0 ? options.defaultTimeoutMs : 60000;
    this.backgroundLogDir = options.backgroundLogDir || os.tmpdir();
    this.policyMode = options.policyMode || this.resolvePolicyModeFromEnv();
    this.maxOutputLength =
      options.maxOutputLength && options.maxOutputLength > 0 ? options.maxOutputLength : 30000;
  }

  override shouldConfirm(args: z.infer<typeof schema>): boolean {
    const decision = this.validatePolicy(args.command);
    return decision.effect === 'ask';
  }

  async execute(args: z.infer<typeof schema>, context?: ToolExecutionContext): Promise<ToolResult> {
    const policy = this.validatePolicy(args.command);
    if (policy.effect === 'deny') {
      const message = `COMMAND_BLOCKED_BY_POLICY: ${policy.reason || 'Command not allowed'}`;
      return {
        success: false,
        output: message,
        error: new ToolExecutionError(message),
        metadata: {
          error: 'COMMAND_BLOCKED_BY_POLICY',
          reason: policy.reason,
        },
      };
    }

    try {
      if (args.run_in_background) {
        const background = await this.executeInBackground(args.command);
        const output = `BACKGROUND_STARTED: pid=${background.pid ?? 'unknown'}, log=${background.logPath}`;
        await context?.onChunk?.({
          type: 'info',
          data: output,
          content: output,
        });
        return {
          success: true,
          output,
          metadata: {
            pid: background.pid,
            logPath: background.logPath,
            run_in_background: true,
          },
        };
      }

      const timeoutMs = typeof args.timeout === 'number' ? args.timeout : this.defaultTimeoutMs;
      const commandResult = await this.executeForeground(
        args.command,
        timeoutMs,
        context?.toolAbortSignal,
        context
      );

      if (commandResult.timedOut) {
        const timeoutMessage = `COMMAND_TIMEOUT: exceeded ${timeoutMs}ms`;
        return {
          success: false,
          output: timeoutMessage,
          summary: `Command timed out after ${timeoutMs}ms.`,
          payload: {
            exitCode: commandResult.exitCode,
            timeoutMs,
            timedOut: true,
          },
          error: new ToolExecutionError(timeoutMessage),
          metadata: {
            error: 'COMMAND_TIMEOUT',
            timeoutMs,
            exitCode: commandResult.exitCode,
          },
        };
      }

      const sanitized = this.sanitizeOutput(commandResult.output);
      const truncated = this.truncateOutput(sanitized);

      if (commandResult.exitCode === 0) {
        const summary =
          truncated.output.length > 0
            ? truncated.truncated
              ? 'Command completed successfully. Output truncated.'
              : 'Command completed successfully.'
            : 'Command completed successfully with no output.';
        return {
          success: true,
          output: truncated.output,
          summary,
          payload: {
            exitCode: commandResult.exitCode,
            timedOut: false,
            truncated: truncated.truncated,
            hasOutput: truncated.output.length > 0,
          },
          metadata: {
            output: truncated.output,
            exitCode: commandResult.exitCode,
            truncated: truncated.truncated,
          },
        };
      }

      const failureOutput =
        truncated.output || `Command failed with exit code ${commandResult.exitCode}`;
      return {
        success: false,
        output: failureOutput,
        summary: `Command failed with exit code ${commandResult.exitCode}.`,
        payload: {
          exitCode: commandResult.exitCode,
          timedOut: false,
          truncated: truncated.truncated,
        },
        error: new ToolExecutionError(failureOutput),
        metadata: {
          output: truncated.output,
          exitCode: commandResult.exitCode,
          truncated: truncated.truncated,
          error: `EXIT_CODE_${commandResult.exitCode}`,
        },
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const output = `EXECUTION_FAILED: ${message}`;
      return {
        success: false,
        output,
        summary: `Command execution failed: ${message}`,
        error: new ToolExecutionError(output),
        metadata: {
          error: 'EXECUTION_FAILED',
          message,
        },
      };
    }
  }

  private validatePolicy(command: string): PolicyDecision {
    const normalized = command.trim();
    if (!normalized) {
      return { effect: 'deny', reason: 'Command is empty' };
    }

    const decision = evaluateBashPolicy(normalized, {
      mode: this.policyMode,
      allowlistMissEffect: 'ask',
      allowlistMissReason: (commandName) =>
        `Command "${commandName}" is not in allowed command list and requires user confirmation`,
    });

    const denyReason = typeof decision.reason === 'string' ? decision.reason : undefined;
    if (
      decision.effect === 'deny' &&
      denyReason &&
      CONFIRMABLE_DENY_REASON_PATTERNS.some((pattern) => pattern.test(denyReason))
    ) {
      return {
        effect: 'ask',
        reason: `${denyReason} (requires explicit confirmation)`,
      };
    }

    return {
      effect: decision.effect,
      reason: decision.reason,
    };
  }

  private resolvePolicyModeFromEnv(): BashPolicyMode {
    const raw = (process.env.BASH_TOOL_POLICY || 'guarded').trim().toLowerCase();
    return raw === 'permissive' ? 'permissive' : 'guarded';
  }

  private async executeForeground(
    command: string,
    timeoutMs: number,
    abortSignal?: AbortSignal,
    context?: ToolExecutionContext
  ): Promise<CommandExecutionResult> {
    const { shellPath, shellArgs } = this.resolveShell(command);

    return new Promise<CommandExecutionResult>((resolve, reject) => {
      let output = '';
      let timedOut = false;
      let settled = false;
      const stdoutSanitizerState = this.createStreamChunkSanitizerState();
      const stderrSanitizerState = this.createStreamChunkSanitizerState();

      const child = spawn(shellPath, shellArgs, {
        cwd: process.cwd(),
        env: this.getExecutionEnv(),
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
        detached: process.platform !== 'win32',
      });

      const cleanup = () => {
        abortSignal?.removeEventListener('abort', abortHandler);
        if (timeout) {
          clearTimeout(timeout);
        }
      };

      const finish = (result: CommandExecutionResult) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        resolve(result);
      };

      const fail = (error: Error) => {
        if (settled) {
          return;
        }
        settled = true;
        cleanup();
        reject(error);
      };

      const emitChunk = (type: 'stdout' | 'stderr', chunk: Buffer) => {
        const text = chunk.toString('utf8');
        output += text;
        const sanitizerState = type === 'stdout' ? stdoutSanitizerState : stderrSanitizerState;
        const sanitized = this.sanitizeStreamChunk(text, sanitizerState);
        if (!sanitized) {
          return;
        }
        void context?.onChunk?.({
          type,
          data: sanitized,
          content: sanitized,
        });
      };

      child.stdout?.on('data', (chunk: Buffer) => emitChunk('stdout', chunk));
      child.stderr?.on('data', (chunk: Buffer) => emitChunk('stderr', chunk));

      child.once('error', fail);
      child.once('close', (code, signal) => {
        const exitCode = code ?? (signal ? 1 : 0);
        finish({
          exitCode: timedOut ? 124 : exitCode,
          output,
          timedOut,
        });
      });

      const abortHandler = () => {
        timedOut = true;
        this.terminateChildProcess(child);
      };

      if (abortSignal?.aborted) {
        abortHandler();
      } else if (abortSignal) {
        abortSignal.addEventListener('abort', abortHandler, { once: true });
      }

      const timeout =
        timeoutMs > 0
          ? setTimeout(() => {
              timedOut = true;
              this.terminateChildProcess(child);
            }, timeoutMs)
          : undefined;
    });
  }

  private async executeInBackground(command: string): Promise<BackgroundExecutionResult> {
    await fsp.mkdir(this.backgroundLogDir, { recursive: true });

    const logPath = path.join(
      this.backgroundLogDir,
      `agent-bash-bg-${Date.now()}-${randomUUID().slice(0, 8)}.log`
    );

    await fsp.writeFile(logPath, '', 'utf8');

    const quotedLogPath =
      process.platform === 'win32'
        ? `"${logPath.replace(/"/g, '""')}"`
        : `'${logPath.replace(/'/g, `'\\''`)}'`;
    const redirectedCommand = `${command} >> ${quotedLogPath} 2>&1`;

    const { shellPath, shellArgs } = this.resolveShell(redirectedCommand);

    const child = spawn(shellPath, shellArgs, {
      cwd: process.cwd(),
      env: this.getExecutionEnv(),
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });

    child.unref();

    return {
      pid: child.pid,
      logPath,
    };
  }

  private resolveShell(command: string): { shellPath: string; shellArgs: string[] } {
    if (process.platform === 'win32') {
      const gitBash = this.findGitBashPath();
      if (gitBash) {
        return {
          shellPath: gitBash,
          shellArgs: ['-lc', command],
        };
      }
      return {
        shellPath: process.env.COMSPEC || 'cmd.exe',
        shellArgs: ['/d', '/s', '/c', command],
      };
    }

    return {
      shellPath: '/bin/bash',
      shellArgs: ['-lc', command],
    };
  }

  private findGitBashPath(): string | null {
    if (process.platform !== 'win32') {
      return null;
    }

    const configured = process.env.BASH_TOOL_SHELL;
    if (configured && fs.existsSync(configured)) {
      return configured;
    }

    for (const candidate of WINDOWS_GIT_BASH_PATHS) {
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }

    try {
      const probe = spawnSync('where', ['git'], {
        stdio: 'pipe',
        encoding: 'utf8',
      });
      if (probe.status === 0 && probe.stdout) {
        const gitPath = String(probe.stdout).split(/\r?\n/)[0]?.trim();
        if (gitPath && fs.existsSync(gitPath)) {
          const gitDir = path.dirname(gitPath);
          const gitRoot = path.dirname(gitDir);
          const inferred = path.join(gitRoot, 'bin', 'bash.exe');
          if (fs.existsSync(inferred)) {
            return inferred;
          }
        }
      }
    } catch {
      return null;
    }

    return null;
  }

  private getExecutionEnv(): NodeJS.ProcessEnv {
    const env = { ...process.env };

    if (process.platform === 'win32') {
      env['CHCP'] = '65001';
      env['ANSICON'] = '';
      env['ConEmuANSI'] = 'OFF';
      env['TERM'] = 'dumb';
    }

    env['LANG'] = 'en_US.UTF-8';
    env['LC_ALL'] = 'en_US.UTF-8';

    return env;
  }

  private createStreamChunkSanitizerState(): StreamChunkSanitizerState {
    return {
      mode: 'text',
      awaitingStringTerminator: false,
    };
  }

  private stripStreamControlSequences(input: string, state: StreamChunkSanitizerState): string {
    if (!input) {
      return input;
    }

    let plainText = '';

    for (let index = 0; index < input.length; index += 1) {
      const char = input[index];
      const code = input.charCodeAt(index);
      if (!char || Number.isNaN(code)) {
        continue;
      }

      if (state.mode === 'text') {
        if (char === '\u001b') {
          state.mode = 'escape';
          state.awaitingStringTerminator = false;
          continue;
        }
        if (code === 0x9b) {
          state.mode = 'csi';
          state.awaitingStringTerminator = false;
          continue;
        }
        plainText += char;
        continue;
      }

      if (state.mode === 'escape') {
        if (char === '[') {
          state.mode = 'csi';
        } else if (char === ']') {
          state.mode = 'osc';
          state.awaitingStringTerminator = false;
        } else if (char === 'P') {
          state.mode = 'dcs';
          state.awaitingStringTerminator = false;
        } else if (char === '^') {
          state.mode = 'pm';
          state.awaitingStringTerminator = false;
        } else if (char === '_') {
          state.mode = 'apc';
          state.awaitingStringTerminator = false;
        } else if (char === 'X') {
          state.mode = 'sos';
          state.awaitingStringTerminator = false;
        } else {
          state.mode = 'text';
          state.awaitingStringTerminator = false;
        }
        continue;
      }

      if (state.mode === 'csi') {
        if (code >= 0x40 && code <= 0x7e) {
          state.mode = 'text';
          state.awaitingStringTerminator = false;
        }
        continue;
      }

      if (state.awaitingStringTerminator) {
        if (char === '\\') {
          state.mode = 'text';
          state.awaitingStringTerminator = false;
          continue;
        }
        state.awaitingStringTerminator = false;
      }

      if (code === 0x07 || code === 0x9c) {
        state.mode = 'text';
        continue;
      }

      if (char === '\u001b') {
        state.awaitingStringTerminator = true;
      }
    }

    return plainText;
  }

  private sanitizeStreamChunk(output: string, state: StreamChunkSanitizerState): string {
    if (!output) {
      return output;
    }

    let sanitized = this.stripStreamControlSequences(output, state);
    sanitized = stripAnsi(sanitized);
    sanitized = sanitized.replace(/\uFFFD/g, '');
    sanitized = sanitized.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    sanitized = this.stripUnsupportedControlChars(sanitized);

    return sanitized;
  }

  private stripUnsupportedControlChars(value: string): string {
    if (!value) {
      return value;
    }

    let normalized = '';
    for (const char of value) {
      const code = char.charCodeAt(0);
      const isAllowedWhitespace = code === 0x09 || code === 0x0a;
      const isPrintableAscii = code >= 0x20 && code <= 0x7e;
      const isNonAscii = code >= 0x80;
      if (isAllowedWhitespace || isPrintableAscii || isNonAscii) {
        normalized += char;
      }
    }

    return normalized;
  }

  private sanitizeOutput(output: string): string {
    if (!output) {
      return output;
    }

    const streamState = this.createStreamChunkSanitizerState();
    let sanitized = this.sanitizeStreamChunk(output, streamState);
    sanitized = sanitized.replace(/\n{3,}/g, '\n\n');

    return sanitized.trim();
  }

  private truncateOutput(output: string): { output: string; truncated: boolean } {
    const maxLength = this.maxOutputLength;
    if (output.length <= maxLength) {
      return { output, truncated: false };
    }

    const marker = '[... Output Truncated for Brevity ...]';
    const separator = '\n\n';
    const reserved = marker.length + separator.length * 2;
    const available = maxLength - reserved;

    if (available <= 20) {
      return {
        output: output.slice(0, maxLength),
        truncated: true,
      };
    }

    const headLength = Math.min(3000, Math.floor(available / 2));
    const tailLength = Math.min(3000, available - headLength);

    return {
      output:
        output.slice(0, headLength) +
        `${separator}${marker}${separator}` +
        output.slice(Math.max(0, output.length - tailLength)),
      truncated: true,
    };
  }

  private terminateChildProcess(child: ChildProcess): void {
    if (!child.pid) {
      return;
    }

    if (process.platform === 'win32') {
      try {
        const killer = spawn('taskkill', ['/pid', String(child.pid), '/f', '/t'], {
          stdio: 'ignore',
          windowsHide: true,
        });
        killer.unref();
      } catch {
        // ignore
      }
      return;
    }

    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      try {
        child.kill('SIGTERM');
      } catch {
        // ignore
      }
    }

    setTimeout(() => {
      if (!child.killed) {
        try {
          process.kill(-child.pid!, 'SIGKILL');
        } catch {
          try {
            child.kill('SIGKILL');
          } catch {
            // ignore
          }
        }
      }
    }, 200);
  }
}

export default BashTool;
