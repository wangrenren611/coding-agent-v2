import * as os from 'node:os';
import * as path from 'node:path';
import { promises as fs } from 'node:fs';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DefaultToolManager } from '../tool-manager';
import { FileReadTool } from '../file-read-tool';
import { FileEditTool } from '../file-edit-tool';
import { WriteFileTool } from '../write-file';
import { GlobTool } from '../glob';
import { GrepTool } from '../grep';
import type { ToolExecutionContext, ToolCall } from '../types';

const tempDirs: string[] = [];

async function createTempDir(prefix: string): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  tempDirs.push(dir);
  return dir;
}

async function createMockRipgrep(): Promise<string> {
  const binDir = await createTempDir('agent-v4-rg-bin-');
  const binPath = path.join(binDir, 'mock-rg.js');
  const script = `#!/usr/bin/env node
const args = process.argv.slice(2);
if (args.includes('--version')) {
  process.stdout.write('mock-rg 1.0.0\\n');
  process.exit(0);
}
const rootPath = args[args.length - 1];
process.stdout.write(JSON.stringify({
  type: 'match',
  data: {
    path: { text: rootPath + '/sandbox-note.txt' },
    lines: { text: 'sandbox marker\\n' },
    line_number: 1,
    submatches: [{ start: 0 }]
  }
}) + '\\n');
process.exit(0);
`;
  await fs.writeFile(binPath, script, 'utf8');
  await fs.chmod(binPath, 0o755);
  return binPath;
}

function createContext(partial?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    toolCallId: 'call_outside_confirm',
    loopIndex: 1,
    agent: {},
    ...partial,
  };
}

function createToolCall(name: string, args: Record<string, unknown>): ToolCall {
  return {
    id: `call_${name}`,
    type: 'function',
    index: 0,
    function: {
      name,
      arguments: JSON.stringify(args),
    },
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe('outside workspace confirmation', () => {
  it('allows file_read outside allowed directories after user approval', async () => {
    const workspaceDir = await createTempDir('agent-v4-confirm-workspace-');
    const outsideDir = await createTempDir('agent-v4-confirm-outside-');
    const outsidePath = path.join(outsideDir, 'note.txt');
    await fs.writeFile(outsidePath, 'outside content', 'utf8');

    const manager = new DefaultToolManager({ confirmationMode: 'manual' });
    manager.registerTool(new FileReadTool({ allowedDirectories: [workspaceDir] }));

    const onConfirm = vi.fn().mockResolvedValue({ approved: true });
    const result = await manager.execute(
      createToolCall('file_read', { path: outsidePath }),
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toBe('outside content');
  });

  it('denies outside-workspace execution when user rejects confirmation', async () => {
    const workspaceDir = await createTempDir('agent-v4-confirm-workspace-');
    const outsideDir = await createTempDir('agent-v4-confirm-outside-');
    const outsidePath = path.join(outsideDir, 'note.txt');
    await fs.writeFile(outsidePath, 'outside content', 'utf8');

    const manager = new DefaultToolManager({ confirmationMode: 'manual' });
    manager.registerTool(new FileReadTool({ allowedDirectories: [workspaceDir] }));

    const onConfirm = vi.fn().mockResolvedValue({ approved: false, message: 'deny outside path' });
    const result = await manager.execute(
      createToolCall('file_read', { path: outsidePath }),
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(false);
    expect(result.output).toContain('Tool file_read denied');
  });

  it('allows file_edit outside allowed directories after user approval', async () => {
    const workspaceDir = await createTempDir('agent-v4-confirm-workspace-');
    const outsideDir = await createTempDir('agent-v4-confirm-outside-');
    const outsidePath = path.join(outsideDir, 'edit.txt');
    await fs.writeFile(outsidePath, 'const value = 1;\n', 'utf8');

    const manager = new DefaultToolManager({ confirmationMode: 'manual' });
    manager.registerTool(new FileEditTool({ allowedDirectories: [workspaceDir] }));

    const onConfirm = vi.fn().mockResolvedValue({ approved: true });
    const result = await manager.execute(
      createToolCall('file_edit', {
        path: outsidePath,
        edits: [{ oldText: 'value = 1', newText: 'value = 2' }],
      }),
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(await fs.readFile(outsidePath, 'utf8')).toContain('value = 2');
  });

  it('allows write_file outside allowed directories after user approval', async () => {
    const workspaceDir = await createTempDir('agent-v4-confirm-workspace-');
    const outsideDir = await createTempDir('agent-v4-confirm-outside-');
    const bufferDir = await createTempDir('agent-v4-confirm-buffer-');
    const outsidePath = path.join(outsideDir, 'write.txt');

    const manager = new DefaultToolManager({ confirmationMode: 'manual' });
    manager.registerTool(
      new WriteFileTool({
        allowedDirectories: [workspaceDir],
        bufferBaseDir: bufferDir,
        maxChunkBytes: 64,
      })
    );

    const onConfirm = vi.fn().mockResolvedValue({ approved: true });
    const result = await manager.execute(
      createToolCall('write_file', {
        path: outsidePath,
        content: 'written outside workspace',
        mode: 'direct',
      }),
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(await fs.readFile(outsidePath, 'utf8')).toBe('written outside workspace');
  });

  it('allows glob outside allowed directories after user approval', async () => {
    const workspaceDir = await createTempDir('agent-v4-confirm-workspace-');
    const outsideDir = await createTempDir('agent-v4-confirm-outside-');
    await fs.writeFile(path.join(outsideDir, 'sandbox-note.txt'), 'marker', 'utf8');

    const manager = new DefaultToolManager({ confirmationMode: 'manual' });
    manager.registerTool(new GlobTool({ allowedDirectories: [workspaceDir] }));

    const onConfirm = vi.fn().mockResolvedValue({ approved: true });
    const result = await manager.execute(
      createToolCall('glob', {
        pattern: '**/*sandbox*',
        path: outsideDir,
        include_hidden: false,
        max_results: 50,
      }),
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 1 file(s)');
  });

  it('allows grep outside allowed directories after user approval', async () => {
    const workspaceDir = await createTempDir('agent-v4-confirm-workspace-');
    const outsideDir = await createTempDir('agent-v4-confirm-outside-');
    await fs.writeFile(path.join(outsideDir, 'sandbox-note.txt'), 'sandbox marker\n', 'utf8');
    const mockRgPath = await createMockRipgrep();

    const manager = new DefaultToolManager({ confirmationMode: 'manual' });
    manager.registerTool(new GrepTool({ allowedDirectories: [workspaceDir], rgPath: mockRgPath }));

    const onConfirm = vi.fn().mockResolvedValue({ approved: true });
    const result = await manager.execute(
      createToolCall('grep', {
        pattern: 'sandbox',
        path: outsideDir,
        timeout_ms: 5000,
        max_results: 50,
      }),
      createContext({ onConfirm })
    );

    expect(onConfirm).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toContain('Found 1 matches in 1 files');
  });
});
