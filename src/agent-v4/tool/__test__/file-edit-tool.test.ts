import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { FileEditTool } from '../file-edit-tool';
import { FileReadTool } from '../file-read-tool';

describe('FileEditTool', () => {
  let rootDir: string;
  let outsideDir: string;
  let editTool: FileEditTool;
  let readTool: FileReadTool;

  beforeEach(async () => {
    rootDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-file-edit-tool-'));
    outsideDir = await fs.mkdtemp(path.join(os.tmpdir(), 'agent-v4-file-edit-outside-'));

    editTool = new FileEditTool({ allowedDirectories: [rootDir] });
    readTool = new FileReadTool({ allowedDirectories: [rootDir] });
  });

  afterEach(async () => {
    await fs.rm(rootDir, { recursive: true, force: true });
    await fs.rm(outsideDir, { recursive: true, force: true });
  });

  it('previews and applies edits', async () => {
    const targetPath = path.join(rootDir, 'edit.txt');
    await fs.writeFile(targetPath, 'const value = 1;\nconsole.log(value);\n', 'utf8');

    const preview = await editTool.execute({
      path: targetPath,
      edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
      dry_run: true,
    });

    expect(preview.success).toBe(true);
    expect(preview.output).toContain('value = 2');
    expect((preview.metadata as { changed: boolean }).changed).toBe(true);

    const apply = await editTool.execute({
      path: targetPath,
      edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
    });

    expect(apply.success).toBe(true);
    expect((apply.metadata as { changed: boolean }).changed).toBe(true);

    const readBack = await readTool.execute({ path: targetPath });
    expect(readBack.success).toBe(true);
    expect(readBack.output).toContain('value = 2');
  });

  it('returns no-change metadata when replacement is identical', async () => {
    const targetPath = path.join(rootDir, 'same.txt');
    await fs.writeFile(targetPath, 'const answer = 42;\n', 'utf8');

    const result = await editTool.execute({
      path: targetPath,
      edits: [{ oldText: 'const answer = 42;', newText: 'const answer = 42;' }],
    });

    expect(result.success).toBe(true);
    expect((result.metadata as { changed: boolean }).changed).toBe(false);
    expect(result.output).toContain('Index:');
  });

  it('returns EDIT_CONFLICT when oldText does not match', async () => {
    const targetPath = path.join(rootDir, 'conflict.txt');
    await fs.writeFile(targetPath, 'const answer = 42;\n', 'utf8');

    const result = await editTool.execute({
      path: targetPath,
      edits: [{ oldText: 'const answer = 100;', newText: 'const answer = 7;' }],
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('EDIT_CONFLICT');

    const metadata = result.metadata as {
      error: string;
      code: string;
      recoverable: boolean;
      next_actions: string[];
    };

    expect(metadata.error).toBe('EDIT_CONFLICT');
    expect(metadata.code).toBe('EDIT_CONFLICT');
    expect(metadata.recoverable).toBe(true);
    expect(metadata.next_actions).toEqual(['file_read', 'file_edit']);
  });

  it('rejects path outside allowed directories', async () => {
    const outsidePath = path.join(outsideDir, 'outside.txt');
    await fs.writeFile(outsidePath, 'x', 'utf8');

    const result = await editTool.execute({
      path: outsidePath,
      edits: [{ oldText: 'x', newText: 'y' }],
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('FILE_EDIT_FAILED');
    expect(result.output).toContain('PATH_NOT_ALLOWED');
  });

  it('always requires confirmation', () => {
    expect(editTool.shouldConfirm()).toBe(true);
  });

  it('returns failure when target path is not a file', async () => {
    const result = await editTool.execute({
      path: rootDir,
      edits: [{ oldText: 'a', newText: 'b' }],
    });

    expect(result.success).toBe(false);
    expect(result.output).toContain('FILE_EDIT_FAILED');
    expect(result.output).toContain('FILE_EDIT_NOT_FILE');
  });

  it('supports whitespace-tolerant edit matching', async () => {
    const targetPath = path.join(rootDir, 'whitespace.txt');
    await fs.writeFile(targetPath, '  const answer = 42;\n', 'utf8');

    const result = await editTool.execute({
      path: targetPath,
      edits: [{ oldText: 'const answer = 42;', newText: 'const answer = 7;' }],
    });

    expect(result.success).toBe(true);

    const readBack = await readTool.execute({ path: targetPath });
    expect(readBack.success).toBe(true);
    expect(readBack.output).toContain('const answer = 7;');
  });

  it('rebuilds relative indentation for multi-line tolerant matches', async () => {
    const targetPath = path.join(rootDir, 'indent-relative.ts');
    await fs.writeFile(
      targetPath,
      ['  if (flag) {', '    console.log("old");', '  }', ''].join('\n'),
      'utf8'
    );

    const result = await editTool.execute({
      path: targetPath,
      edits: [
        {
          oldText: ['if (flag) {', '  console.log("old");', '}'].join('\n'),
          newText: ['if (flag) {', '    console.log("new");', '}'].join('\n'),
        },
      ],
    });

    expect(result.success).toBe(true);
    const readBack = await readTool.execute({ path: targetPath });
    expect(readBack.success).toBe(true);
    expect(readBack.output).toContain('  if (flag) {');
    expect(readBack.output).toContain('    console.log("new");');
  });

  it('keeps replacement line as-is when indent mapping cannot be derived', async () => {
    const targetPath = path.join(rootDir, 'indent-fallback.ts');
    await fs.writeFile(targetPath, ['  if (ready) {', '    work();', '  }', ''].join('\n'), 'utf8');

    const result = await editTool.execute({
      path: targetPath,
      edits: [
        {
          oldText: ['if (ready) {', '  work();', '}'].join('\n'),
          newText: ['if (ready) {', 'workNow();', '}'].join('\n'),
        },
      ],
    });

    expect(result.success).toBe(true);
    const readBack = await readTool.execute({ path: targetPath });
    expect(readBack.success).toBe(true);
    expect(readBack.output).toContain('workNow();');
  });

  it('maps pre-prefixed conflict messages to EDIT_CONFLICT envelope', () => {
    const helper = editTool as unknown as {
      mapFailure: (
        requestPath: string,
        error: unknown
      ) => {
        success: boolean;
        output?: string;
        metadata?: Record<string, unknown>;
      };
    };

    const result = helper.mapFailure('demo.ts', new Error('EDIT_CONFLICT: anchored'));
    expect(result.success).toBe(false);
    expect(result.output).toContain('EDIT_CONFLICT');
    expect(result.metadata?.error).toBe('EDIT_CONFLICT');
  });

  it('maps non-error failures to FILE_EDIT_FAILED envelope', () => {
    const helper = editTool as unknown as {
      mapFailure: (
        requestPath: string,
        error: unknown
      ) => {
        success: boolean;
        output?: string;
        metadata?: Record<string, unknown>;
      };
    };

    const result = helper.mapFailure('demo.ts', 1234);
    expect(result.success).toBe(false);
    expect(result.output).toBe('FILE_EDIT_FAILED: 1234');
    expect(result.metadata?.error).toBe('FILE_EDIT_FAILED');
  });
});
