import { spawn, spawnSync } from 'node:child_process';
import * as readline from 'node:readline';
import path from 'node:path';
import { rgPath as vscodeRgPath } from '@vscode/ripgrep';
import { z } from 'zod';
import { BaseTool } from './base';
import type { ToolExecutionContext, ToolResult } from './types';
import {
  DEFAULT_IGNORE_GLOBS,
  resolveSearchRoot,
  normalizeAllowedDirectories,
} from './search/common';

const schema = z
  .object({
    pattern: z.string().min(1).describe('Regex pattern to search'),
    path: z.string().optional().describe('Search root directory'),
    glob: z.string().optional().describe('Glob filter for candidate files, for example "**/*.ts"'),
    timeout_ms: z.number().int().min(100).max(600000).optional().default(60000),
    max_results: z.number().int().min(1).max(5000).optional().default(200),
  })
  .strict();

type GrepArgs = z.infer<typeof schema>;

interface GrepMatch {
  line: number | null;
  column: number | null;
  text: string;
}

interface GrepFileResult {
  file: string;
  matchCount: number;
  matches: GrepMatch[];
}

export interface GrepToolOptions {
  allowedDirectories?: string[];
  rgPath?: string;
}

const MAX_PREVIEW_MATCHES_PER_FILE = 20;
const MAX_PREVIEW_FILES = 20;

function toRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : null;
}

function decodeTextField(raw: unknown): string {
  const record = toRecord(raw);
  if (!record) return '';
  if (typeof record.text === 'string') return record.text;
  if (typeof record.bytes === 'string') {
    try {
      return Buffer.from(record.bytes, 'base64').toString('utf8');
    } catch {
      return '';
    }
  }
  return '';
}

function normalizeOutputPath(rootPath: string, rawPath: string): string {
  const absolutePath = path.isAbsolute(rawPath) ? rawPath : path.resolve(rootPath, rawPath);
  return absolutePath.split(path.sep).join('/');
}

function locateRipgrep(customRgPath?: string): { found: boolean; bin?: string; error?: string } {
  const candidates: Array<{ label: string; bin: string }> = [];

  if (customRgPath?.trim()) {
    candidates.push({ label: 'custom option', bin: customRgPath.trim() });
  }
  if (process.env.RIPGREP_PATH?.trim()) {
    candidates.push({ label: 'RIPGREP_PATH', bin: process.env.RIPGREP_PATH.trim() });
  }
  if (vscodeRgPath?.trim()) {
    candidates.push({ label: '@vscode/ripgrep', bin: vscodeRgPath.trim() });
  }
  candidates.push({ label: 'system rg', bin: 'rg' });

  const deduped = Array.from(
    new Map(candidates.map((candidate) => [candidate.bin, candidate])).values()
  );

  for (const candidate of deduped) {
    const probe = spawnSync(candidate.bin, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      return { found: true, bin: candidate.bin };
    }
  }

  return {
    found: false,
    error: `RIPGREP_NOT_FOUND: no usable ripgrep binary found. Tried: ${deduped
      .map((item) => `${item.label} (${item.bin})`)
      .join(', ')}`,
  };
}

function toErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class GrepTool extends BaseTool<typeof schema> {
  private readonly allowedDirectories: string[];
  private readonly rgPath?: string;

  constructor(options: GrepToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(
      options.allowedDirectories ?? [process.cwd()]
    );
    this.rgPath = options.rgPath;
    this.timeout = 60000;
  }

  get meta() {
    return {
      name: 'grep',
      description:
        'Search file contents with ripgrep regex. Parameters are intentionally minimal for predictable behavior.',
      parameters: schema,
      category: 'filesystem',
      tags: ['search', 'grep', 'regex'],
    };
  }

  async execute(args: GrepArgs, _context: ToolExecutionContext): Promise<ToolResult> {
    try {
      const { rootPath } = await resolveSearchRoot({
        requestedPath: args.path,
        allowedDirectories: this.allowedDirectories,
      });

      const located = locateRipgrep(this.rgPath);
      if (!located.found || !located.bin) {
        return this.failure(located.error ?? 'RIPGREP_NOT_FOUND: ripgrep binary not found', {
          error: 'RIPGREP_NOT_FOUND',
        });
      }

      const commandArgs = this.buildCommandArgs(args, rootPath);
      const result = await this.runRipgrep(located.bin, commandArgs, rootPath, args);
      return this.success(result.data, result.output);
    } catch (error) {
      const message = toErrorMessage(error);
      const errorCode = this.extractErrorCode(message);
      return this.failure(message, {
        error: errorCode,
        message,
      });
    }
  }

  private buildCommandArgs(args: GrepArgs, rootPath: string): string[] {
    const commandArgs: string[] = ['--json', '--no-messages', '--smart-case', '--line-number'];

    if (args.glob) {
      commandArgs.push('--glob', args.glob);
    }

    for (const pattern of DEFAULT_IGNORE_GLOBS) {
      commandArgs.push('--glob', `!${pattern}`);
    }

    commandArgs.push('--', args.pattern, rootPath);
    return commandArgs;
  }

  private async runRipgrep(
    rgBin: string,
    commandArgs: string[],
    rootPath: string,
    args: GrepArgs
  ): Promise<{ data: Record<string, unknown>; output: string }> {
    const fileMap = new Map<string, GrepFileResult>();
    let totalMatches = 0;
    let timedOut = false;
    let truncated = false;
    let stderr = '';

    const child = spawn(rgBin, commandArgs, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      const content = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderr += content;
    });

    const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
      }
    );

    const kill = (): void => {
      try {
        if (!child.killed) {
          child.kill();
        }
      } catch {
        // ignore
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      truncated = true;
      kill();
    }, args.timeout_ms);

    if (!child.stdout) {
      throw new Error('RIPGREP_ERROR: failed to capture ripgrep stdout stream');
    }

    let streamError: Error | undefined;
    const rl = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    try {
      for await (const line of rl) {
        if (!line) {
          continue;
        }

        let event: unknown;
        try {
          event = JSON.parse(line);
        } catch {
          continue;
        }

        const eventRecord = toRecord(event);
        if (!eventRecord || eventRecord.type !== 'match') {
          continue;
        }

        const eventData = toRecord(eventRecord.data);
        if (!eventData) {
          continue;
        }

        const fileRaw = decodeTextField(eventData.path);
        if (!fileRaw) {
          continue;
        }

        const file = normalizeOutputPath(rootPath, fileRaw);
        const entry =
          fileMap.get(file) ??
          ({
            file,
            matchCount: 0,
            matches: [],
          } satisfies GrepFileResult);

        const lineText = decodeTextField(eventData.lines).replace(/\r?\n$/g, '');
        const submatches = Array.isArray(eventData.submatches) ? eventData.submatches : [];
        const firstSubmatch = toRecord(submatches[0]);
        const start = typeof firstSubmatch?.start === 'number' ? firstSubmatch.start : undefined;

        entry.matchCount += 1;
        if (entry.matches.length < MAX_PREVIEW_MATCHES_PER_FILE) {
          entry.matches.push({
            line: typeof eventData.line_number === 'number' ? eventData.line_number : null,
            column: typeof start === 'number' ? start + 1 : null,
            text: lineText.trimEnd(),
          });
        }

        fileMap.set(file, entry);

        totalMatches += 1;
        if (totalMatches >= args.max_results) {
          truncated = true;
          kill();
          rl.close();
          break;
        }
      }
    } catch (error) {
      if (!timedOut && !truncated) {
        streamError = error instanceof Error ? error : new Error(toErrorMessage(error));
      }
    } finally {
      clearTimeout(timer);
      rl.close();
    }

    const { code: exitCode, signal: exitSignal } = await closePromise;

    if (streamError) {
      throw new Error(`RIPGREP_STREAM_ERROR: ${streamError.message}`);
    }

    if (timedOut) {
      return this.buildSuccessResult(fileMap, totalMatches, {
        pattern: args.pattern,
        rootPath,
        truncated: true,
        timedOut: true,
        message: `Search timed out after ${args.timeout_ms}ms`,
      });
    }

    if (exitSignal && !truncated) {
      throw new Error(`RIPGREP_ERROR: ripgrep terminated by signal ${exitSignal}`);
    }

    if (exitCode === 2) {
      throw new Error(`RIPGREP_ERROR: ${stderr.trim() || 'ripgrep execution failed'}`);
    }

    if (exitCode === 1 && totalMatches === 0) {
      return {
        data: {
          pattern: args.pattern,
          path: rootPath,
          countFiles: 0,
          countMatches: 0,
          results: [],
          truncated: false,
          timed_out: false,
        },
        output: 'No matches found',
      };
    }

    if (exitCode !== null && exitCode !== 0 && exitCode !== 1) {
      throw new Error(`RIPGREP_ERROR: ripgrep exited with code ${exitCode}`);
    }

    return this.buildSuccessResult(fileMap, totalMatches, {
      pattern: args.pattern,
      rootPath,
      truncated,
      timedOut: false,
      message: 'Search completed',
    });
  }

  private buildSuccessResult(
    fileMap: Map<string, GrepFileResult>,
    totalMatches: number,
    options: {
      pattern: string;
      rootPath: string;
      truncated: boolean;
      timedOut: boolean;
      message: string;
    }
  ): { data: Record<string, unknown>; output: string } {
    const results = Array.from(fileMap.values()).sort((left, right) =>
      left.file.localeCompare(right.file)
    );

    const headline = `Found ${totalMatches} matches in ${results.length} files${
      options.truncated ? ' (truncated)' : ''
    }${options.timedOut ? ' (timed out)' : ''}`;

    const previewLines: string[] = [headline];
    for (const fileResult of results.slice(0, MAX_PREVIEW_FILES)) {
      previewLines.push(`\n${fileResult.file} (${fileResult.matchCount} matches):`);
      for (const match of fileResult.matches.slice(0, 10)) {
        const lineLabel = match.line !== null ? `Line ${match.line}` : 'Line ?';
        previewLines.push(`  ${lineLabel}: ${match.text}`);
      }
      if (fileResult.matchCount > fileResult.matches.length) {
        previewLines.push(
          `  ... and ${fileResult.matchCount - fileResult.matches.length} more matches`
        );
      }
    }

    if (results.length > MAX_PREVIEW_FILES) {
      previewLines.push(`\n... and ${results.length - MAX_PREVIEW_FILES} more files`);
    }

    return {
      data: {
        pattern: options.pattern,
        path: options.rootPath,
        countFiles: results.length,
        countMatches: totalMatches,
        results,
        truncated: options.truncated,
        timed_out: options.timedOut,
      },
      output:
        options.message === 'Search completed'
          ? previewLines.join('\n')
          : `${options.message}\n${previewLines.join('\n')}`,
    };
  }

  private extractErrorCode(message: string): string {
    const matched = message.match(/^([A-Z][A-Z0-9_]{2,})(?::|$)/);
    if (matched) {
      return matched[1];
    }
    return 'GREP_EXECUTION_ERROR';
  }
}

export default GrepTool;
