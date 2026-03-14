import { spawn, spawnSync } from 'node:child_process';
import * as path from 'node:path';
import * as readline from 'node:readline';
import { rgPath as vscodeRgPath } from '@vscode/ripgrep';
import { z } from 'zod';
import { BaseTool, type ToolConfirmDetails, type ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import type { ToolExecutionContext } from './types';
import { DEFAULT_IGNORE_GLOBS, resolveSearchRoot } from './search/common';
import {
  assessPathAccess,
  ensurePathWithinAllowed,
  normalizeAllowedDirectories,
  resolveRequestedPath,
  toPosixPath,
} from './path-security';
import { GREP_TOOL_DESCRIPTION } from './tool-prompts';

const schema = z
  .object({
    pattern: z.string().min(1).describe('Regex pattern'),
    path: z.string().optional().describe('Search root'),
    glob: z.string().optional().describe('Glob include filter'),
    timeout_ms: z
      .number()
      .int()
      .min(100)
      .max(600000)
      .optional()
      .default(60000)
      .describe('Search timeout in milliseconds'),
    max_results: z
      .number()
      .int()
      .min(1)
      .max(5000)
      .optional()
      .default(200)
      .describe('Maximum number of matches to collect before truncation'),
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

interface GrepSummary {
  pattern: string;
  path: string;
  countFiles: number;
  countMatches: number;
  results: GrepFileResult[];
  truncated: boolean;
  timed_out: boolean;
}

export interface GrepToolOptions {
  allowedDirectories?: string[];
  rgPath?: string;
}

const MAX_PREVIEW_MATCHES_PER_FILE = 20;
const MAX_PREVIEW_FILES = 20;

function toRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function decodeTextField(raw: unknown): string {
  const record = toRecord(raw);
  if (!record) {
    return '';
  }
  if (typeof record.text === 'string') {
    return record.text;
  }
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
  const absolute = path.isAbsolute(rawPath) ? rawPath : path.resolve(rootPath, rawPath);
  return toPosixPath(absolute);
}

function locateRipgrep(
  customPath?: string
): { found: true; bin: string } | { found: false; error: string } {
  const candidates: Array<{ label: string; bin: string }> = [];

  if (customPath?.trim()) {
    candidates.push({ label: 'custom option', bin: customPath.trim() });
  }
  if (process.env.RIPGREP_PATH?.trim()) {
    candidates.push({ label: 'RIPGREP_PATH', bin: process.env.RIPGREP_PATH.trim() });
  }
  if (vscodeRgPath?.trim()) {
    candidates.push({ label: '@vscode/ripgrep', bin: vscodeRgPath.trim() });
  }
  candidates.push({ label: 'system rg', bin: 'rg' });

  const uniqueCandidates = Array.from(
    new Map(candidates.map((candidate) => [candidate.bin, candidate])).values()
  );

  for (const candidate of uniqueCandidates) {
    const probe = spawnSync(candidate.bin, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      return { found: true, bin: candidate.bin };
    }
  }

  return {
    found: false,
    error: `RIPGREP_NOT_FOUND: no usable ripgrep binary found. Tried: ${uniqueCandidates
      .map((candidate) => `${candidate.label} (${candidate.bin})`)
      .join(', ')}`,
  };
}

export class GrepTool extends BaseTool<typeof schema> {
  name = 'grep';
  description = GREP_TOOL_DESCRIPTION;
  parameters = schema;

  private readonly allowedDirectories: string[];
  private readonly rgPath?: string;

  constructor(options: GrepToolOptions = {}) {
    super();
    this.allowedDirectories = normalizeAllowedDirectories(options.allowedDirectories);
    this.rgPath = options.rgPath;
  }

  override getConcurrencyMode(): 'parallel-safe' {
    return 'parallel-safe';
  }

  override getConcurrencyLockKey(args: GrepArgs): string {
    return `grep:${args.path || process.cwd()}:${args.pattern}`;
  }

  override getConfirmDetails(args: GrepArgs): ToolConfirmDetails | null {
    const requestedPath = args.path?.trim().length ? args.path : process.cwd();
    const absolute = resolveRequestedPath(requestedPath);
    const assessment = assessPathAccess(
      absolute,
      this.allowedDirectories,
      'SEARCH_PATH_NOT_ALLOWED'
    );
    if (assessment.allowed) {
      return null;
    }
    return {
      reason: assessment.message,
      metadata: {
        requestedPath: absolute,
        allowedDirectories: this.allowedDirectories,
        errorCode: 'SEARCH_PATH_NOT_ALLOWED',
      },
    };
  }

  async execute(args: GrepArgs, context?: ToolExecutionContext): Promise<ToolResult> {
    try {
      let rootPath: string;
      if (context?.confirmationApproved === true) {
        const requestedPath = args.path?.trim().length ? args.path : process.cwd();
        const absolute = resolveRequestedPath(requestedPath);
        rootPath = ensurePathWithinAllowed(
          absolute,
          this.allowedDirectories,
          'SEARCH_PATH_NOT_ALLOWED',
          true
        );
      } else {
        ({ rootPath } = await resolveSearchRoot({
          requestedPath: args.path,
          allowedDirectories: this.allowedDirectories,
        }));
      }

      const located = locateRipgrep(this.rgPath);
      if (!located.found) {
        return this.buildFailureResult(located.error, 'RIPGREP_NOT_FOUND');
      }

      const commandArgs = this.buildCommandArgs(args, rootPath);
      const result = await this.runRipgrep(located.bin, commandArgs, rootPath, args, context);

      return {
        success: true,
        output: result.output,
        metadata: result.data as unknown as Record<string, unknown>,
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return this.buildFailureResult(message, this.extractErrorCode(message));
    }
  }

  private buildCommandArgs(args: GrepArgs, rootPath: string): string[] {
    const commandArgs: string[] = ['--json', '--no-messages', '--smart-case', '--line-number'];

    if (args.glob) {
      commandArgs.push('--glob', args.glob);
    }

    for (const ignorePattern of DEFAULT_IGNORE_GLOBS) {
      commandArgs.push('--glob', `!${ignorePattern}`);
    }

    commandArgs.push('--', args.pattern, rootPath);
    return commandArgs;
  }

  private async runRipgrep(
    ripgrepBinary: string,
    commandArgs: string[],
    rootPath: string,
    args: GrepArgs,
    context?: ToolExecutionContext
  ): Promise<{ data: GrepSummary; output: string }> {
    const fileMap = new Map<string, GrepFileResult>();
    let totalMatches = 0;
    let timedOut = false;
    let truncated = false;
    let stderr = '';

    const child = spawn(ripgrepBinary, commandArgs, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', (chunk: string | Buffer) => {
      const text = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderr += text;
      void context?.onChunk?.({ type: 'stderr', data: text, content: text });
    });

    const closePromise = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>(
      (resolve, reject) => {
        child.on('error', reject);
        child.on('close', (code, signal) => resolve({ code, signal }));
      }
    );

    const killChild = (): void => {
      try {
        if (!child.killed) {
          child.kill();
        }
      } catch {
        // ignore
      }
    };

    const timeout = setTimeout(() => {
      timedOut = true;
      truncated = true;
      killChild();
    }, args.timeout_ms);

    if (!child.stdout) {
      clearTimeout(timeout);
      throw new Error('RIPGREP_ERROR: failed to capture ripgrep stdout stream');
    }

    const lineReader = readline.createInterface({
      input: child.stdout,
      crlfDelay: Infinity,
    });

    let streamError: Error | undefined;

    try {
      for await (const line of lineReader) {
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

        const rawFilePath = decodeTextField(eventData.path);
        if (!rawFilePath) {
          continue;
        }

        const file = normalizeOutputPath(rootPath, rawFilePath);
        const entry =
          fileMap.get(file) ||
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
          killChild();
          lineReader.close();
          break;
        }
      }
    } catch (error) {
      if (!timedOut && !truncated) {
        streamError = error instanceof Error ? error : new Error(String(error));
      }
    } finally {
      clearTimeout(timeout);
      lineReader.close();
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
  ): { data: GrepSummary; output: string } {
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

    const summary: GrepSummary = {
      pattern: options.pattern,
      path: options.rootPath,
      countFiles: results.length,
      countMatches: totalMatches,
      results,
      truncated: options.truncated,
      timed_out: options.timedOut,
    };

    return {
      data: summary,
      output:
        options.message === 'Search completed'
          ? previewLines.join('\n')
          : `${options.message}\n${previewLines.join('\n')}`,
    };
  }

  private buildFailureResult(message: string, errorCode: string): ToolResult {
    return {
      success: false,
      output: message,
      error: new ToolExecutionError(message),
      metadata: {
        error: errorCode,
        message,
      },
    };
  }

  private extractErrorCode(message: string): string {
    const matched = message.match(/^([A-Z][A-Z0-9_]{2,})(?::|$)/);
    if (matched?.[1]) {
      return matched[1];
    }
    return 'GREP_EXECUTION_ERROR';
  }
}

export default GrepTool;
