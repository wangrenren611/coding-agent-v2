import { spawn, spawnSync } from 'child_process';
import * as readline from 'node:readline';
import { promises as fs } from 'node:fs';
import path from 'node:path';
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
    file_pattern: z
      .string()
      .optional()
      .describe('Glob filter for candidate files, for example "*.ts"'),
    path: z.string().optional().describe('Search root directory'),
    case_mode: z.enum(['smart', 'sensitive', 'insensitive']).optional().default('smart'),
    word: z.boolean().optional().default(false),
    multiline: z.boolean().optional().default(false),
    pcre2: z.boolean().optional().default(false),
    include_hidden: z.boolean().optional().default(false),
    no_ignore: z.boolean().optional().default(false),
    timeout: z.number().int().min(100).max(600000).optional().default(60000),
    max_files: z.number().int().min(1).max(1000).optional().default(100),
    max_matches_per_file: z.number().int().min(1).max(500).optional().default(50),
  })
  .strict();

type GrepArgs = z.infer<typeof schema>;

interface GrepMatch {
  line: number | null;
  column: number | null;
  content: string;
  matchText?: string;
  start?: number;
  end?: number;
}

interface GrepFileResult {
  file: string;
  mtimeMs: number | null;
  mtimeIso: string | null;
  matches: GrepMatch[];
  totalMatches: number;
}

export interface GrepToolOptions {
  allowedDirectories?: string[];
  rgPath?: string;
}

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
  const candidates: string[] = [];
  if (customRgPath?.trim()) {
    candidates.push(customRgPath.trim());
  }
  if (process.env.RIPGREP_PATH?.trim()) {
    candidates.push(process.env.RIPGREP_PATH.trim());
  }
  candidates.push('rg');

  const deduped = Array.from(new Set(candidates));
  for (const candidate of deduped) {
    const probe = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
    if (!probe.error && probe.status === 0) {
      return { found: true, bin: candidate };
    }
  }

  return {
    found: false,
    error: `RIPGREP_NOT_FOUND: ripgrep binary not found. Candidates: ${deduped.join(', ')}`,
  };
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
        'Search file contents with ripgrep regular expressions. Returns matched files and line-level snippets.',
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
      const message = error instanceof Error ? error.message : String(error);
      const errorCode = this.extractErrorCode(message);
      return this.failure(message, {
        error: errorCode,
        message,
      });
    }
  }

  private buildCommandArgs(args: GrepArgs, rootPath: string): string[] {
    const commandArgs: string[] = ['--json', '--no-messages'];

    if (args.file_pattern) {
      commandArgs.push('--glob', args.file_pattern);
    }

    if (!args.no_ignore) {
      for (const pattern of DEFAULT_IGNORE_GLOBS) {
        commandArgs.push('--glob', `!${pattern}`);
      }
    }

    if (args.include_hidden) commandArgs.push('--hidden');
    if (args.no_ignore) commandArgs.push('--no-ignore');

    if (args.case_mode === 'smart') commandArgs.push('--smart-case');
    if (args.case_mode === 'insensitive') commandArgs.push('--ignore-case');
    if (args.case_mode === 'sensitive') commandArgs.push('--case-sensitive');

    if (args.word) commandArgs.push('--word-regexp');
    if (args.multiline) commandArgs.push('--multiline');
    if (args.pcre2) commandArgs.push('--pcre2');

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
    let timedOut = false;
    let truncated = false;
    let stderr = '';

    const child = spawn(rgBin, commandArgs, {
      cwd: process.cwd(),
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (chunk: string | Buffer) => {
      const content = typeof chunk === 'string' ? chunk : chunk.toString('utf8');
      stderr += content;
    });

    const kill = (): void => {
      try {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      } catch {
        // ignore
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      truncated = true;
      kill();
    }, args.timeout);

    const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });

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
          mtimeMs: null,
          mtimeIso: null,
          matches: [],
          totalMatches: 0,
        } satisfies GrepFileResult);

      const lineText = decodeTextField(eventData.lines).replace(/\r?\n$/g, '');
      const submatches = Array.isArray(eventData.submatches) ? eventData.submatches : [];
      const firstSubmatch = toRecord(submatches[0]);
      const matchText = firstSubmatch?.match ? decodeTextField(firstSubmatch.match) : undefined;
      const start = typeof firstSubmatch?.start === 'number' ? firstSubmatch.start : undefined;
      const end = typeof firstSubmatch?.end === 'number' ? firstSubmatch.end : undefined;
      const lineNumber = typeof eventData.line_number === 'number' ? eventData.line_number : null;
      const column = typeof start === 'number' ? start + 1 : null;

      entry.totalMatches += 1;
      if (entry.matches.length < args.max_matches_per_file) {
        entry.matches.push({
          line: lineNumber,
          column,
          content: lineText.trimEnd(),
          matchText,
          start,
          end,
        });
      } else {
        truncated = true;
      }
      fileMap.set(file, entry);

      if (fileMap.size >= args.max_files) {
        truncated = true;
        kill();
        rl.close();
        break;
      }
    }

    clearTimeout(timer);

    const exitCode = await new Promise<number>((resolve, reject) => {
      child.on('error', reject);
      child.on('close', (code) => resolve(code ?? 0));
    });

    if (timedOut) {
      return this.buildSuccessResult(fileMap, {
        truncated: true,
        timedOut: true,
        message: `Search timed out after ${args.timeout}ms`,
      });
    }

    if (exitCode === 2) {
      throw new Error(`RIPGREP_ERROR: ${stderr.trim() || 'ripgrep execution failed'}`);
    }

    if (exitCode === 1 && fileMap.size === 0) {
      return {
        data: {
          countFiles: 0,
          countMatches: 0,
          results: [],
          truncated: false,
          timed_out: false,
        },
        output: 'No matches found',
      };
    }

    return this.buildSuccessResult(fileMap, {
      truncated,
      timedOut: false,
      message: 'Search completed',
    });
  }

  private async buildSuccessResult(
    fileMap: Map<string, GrepFileResult>,
    options: { truncated: boolean; timedOut: boolean; message: string }
  ): Promise<{ data: Record<string, unknown>; output: string }> {
    const results = await Promise.all(
      Array.from(fileMap.values()).map(async (entry) => {
        try {
          const stats = await fs.stat(entry.file);
          entry.mtimeMs = stats.mtimeMs;
          entry.mtimeIso = new Date(stats.mtimeMs).toISOString();
        } catch {
          entry.mtimeMs = null;
          entry.mtimeIso = null;
        }
        return entry;
      })
    );

    results.sort((left, right) => (right.mtimeMs ?? 0) - (left.mtimeMs ?? 0));

    const countMatches = results.reduce((sum, item) => sum + item.totalMatches, 0);
    const headline = `Found ${countMatches} matches in ${results.length} files${
      options.truncated ? ' (truncated)' : ''
    }${options.timedOut ? ' (timed out)' : ''}`;

    const previewLines: string[] = [headline];
    for (const fileResult of results.slice(0, 20)) {
      previewLines.push(`\n${fileResult.file}:`);
      for (const match of fileResult.matches.slice(0, 10)) {
        const lineLabel = match.line !== null ? `Line ${match.line}` : 'Line ?';
        previewLines.push(`  ${lineLabel}: ${match.content}`);
      }
      if (fileResult.totalMatches > fileResult.matches.length) {
        previewLines.push(
          `  ... and ${fileResult.totalMatches - fileResult.matches.length} more matches`
        );
      }
    }
    if (results.length > 20) {
      previewLines.push(`\n... and ${results.length - 20} more files`);
    }

    return {
      data: {
        countFiles: results.length,
        countMatches,
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
