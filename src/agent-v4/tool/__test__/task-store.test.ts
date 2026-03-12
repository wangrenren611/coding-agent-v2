import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskStore, getTaskStore } from '../task-store';
import { createEmptyNamespaceState } from '../task-types';

describe('TaskStore', () => {
  let tempDir: string;
  let store: TaskStore;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-store-test-'));
    store = new TaskStore({ baseDir: tempDir });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('constructor', () => {
    it('creates store with default options', () => {
      const store = new TaskStore();
      expect(store).toBeDefined();
      expect(store.baseDir).toContain('.agent-cache');
    });

    it('creates store with custom baseDir', () => {
      const store = new TaskStore({ baseDir: '/custom/path' });
      // On Windows, path.resolve converts /custom/path to D:\custom\path
      expect(path.isAbsolute(store.baseDir)).toBe(true);
      expect(store.baseDir).toContain('custom');
      expect(store.baseDir).toContain('path');
    });

    it('creates store with custom now function', () => {
      const mockNow = vi.fn().mockReturnValue(1234567890);
      const store = new TaskStore({ now: mockNow });
      expect(store).toBeDefined();
    });
  });

  describe('normalizeNamespace', () => {
    it('returns default for undefined', () => {
      expect(store.normalizeNamespace(undefined)).toBe('default');
    });

    it('returns default for empty string', () => {
      expect(store.normalizeNamespace('')).toBe('default');
    });

    it('returns default for whitespace-only string', () => {
      expect(store.normalizeNamespace('   ')).toBe('default');
    });

    it('returns trimmed namespace', () => {
      expect(store.normalizeNamespace('  test  ')).toBe('test');
    });

    it('accepts valid namespace characters', () => {
      expect(store.normalizeNamespace('test-namespace')).toBe('test-namespace');
      expect(store.normalizeNamespace('test_namespace')).toBe('test_namespace');
      expect(store.normalizeNamespace('test.namespace')).toBe('test.namespace');
      expect(store.normalizeNamespace('test123')).toBe('test123');
    });

    it('throws for invalid namespace characters', () => {
      expect(() => store.normalizeNamespace('test namespace')).toThrow('TASK_INVALID_NAMESPACE');
      expect(() => store.normalizeNamespace('test@namespace')).toThrow('TASK_INVALID_NAMESPACE');
      expect(() => store.normalizeNamespace('test#namespace')).toThrow('TASK_INVALID_NAMESPACE');
      expect(() => store.normalizeNamespace('test/namespace')).toThrow('TASK_INVALID_NAMESPACE');
      expect(() => store.normalizeNamespace('test\\namespace')).toThrow('TASK_INVALID_NAMESPACE');
    });
  });

  describe('getNamespaceFilePath', () => {
    it('returns correct file path', () => {
      const filePath = store.getNamespaceFilePath('test-namespace');
      expect(filePath).toBe(path.join(tempDir, 'test-namespace.json'));
    });

    it('handles default namespace', () => {
      const filePath = store.getNamespaceFilePath('default');
      expect(filePath).toBe(path.join(tempDir, 'default.json'));
    });
  });

  describe('getState', () => {
    it('returns empty state for new namespace', async () => {
      const state = await store.getState('test-namespace');

      expect(state.namespace).toBe('test-namespace');
      expect(state.tasks).toEqual({});
      expect(state.agentRuns).toEqual({});
      expect(state.graph.adjacency).toEqual({});
      expect(state.graph.reverse).toEqual({});
      expect(state.schemaVersion).toBe(1);
    });

    it('returns default namespace state', async () => {
      const state = await store.getState();

      expect(state.namespace).toBe('default');
    });

    it('returns cached state', async () => {
      // First call creates the state
      const state1 = await store.getState('test-namespace');

      // Second call should return cached state
      const state2 = await store.getState('test-namespace');

      expect(state1).toEqual(state2);
    });

    it('returns state from file', async () => {
      // Create a state file manually
      const state = createEmptyNamespaceState('test-namespace');
      state.tasks = {
        task_1: {
          id: 'task_1',
          subject: 'Test Task',
          description: 'Test description',
          activeForm: 'Testing',
          status: 'pending',
          priority: 'normal',
          owner: null,
          blockedBy: [],
          blocks: [],
          progress: 0,
          checkpoints: [],
          retryConfig: { maxRetries: 3, retryDelayMs: 5000, backoffMultiplier: 2, retryOn: [] },
          retryCount: 0,
          tags: [],
          metadata: {},
          history: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        },
      };

      const filePath = store.getNamespaceFilePath('test-namespace');
      await fs.writeFile(filePath, JSON.stringify(state, null, 2));

      const loadedState = await store.getState('test-namespace');

      expect(loadedState.tasks).toHaveProperty('task_1');
      expect(loadedState.tasks.task_1.subject).toBe('Test Task');
    });

    it('handles corrupted state file', async () => {
      const filePath = store.getNamespaceFilePath('test-namespace');
      await fs.writeFile(filePath, 'invalid json');

      await expect(store.getState('test-namespace')).rejects.toThrow('TASK_STORE_IO_ERROR');
    });

    it('handles state file with missing fields', async () => {
      const filePath = store.getNamespaceFilePath('test-namespace');
      await fs.writeFile(filePath, JSON.stringify({ namespace: 'test-namespace' }));

      const state = await store.getState('test-namespace');

      expect(state.namespace).toBe('test-namespace');
      expect(state.tasks).toEqual({});
      expect(state.agentRuns).toEqual({});
    });
  });

  describe('updateState', () => {
    it('updates state and returns result', async () => {
      const { state, result } = await store.updateState('test-namespace', (state) => {
        state.tasks.task_1 = {
          id: 'task_1',
          subject: 'Test Task',
          description: 'Test description',
          activeForm: 'Testing',
          status: 'pending',
          priority: 'normal',
          owner: null,
          blockedBy: [],
          blocks: [],
          progress: 0,
          checkpoints: [],
          retryConfig: { maxRetries: 3, retryDelayMs: 5000, backoffMultiplier: 2, retryOn: [] },
          retryCount: 0,
          tags: [],
          metadata: {},
          history: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        };
        return 'created';
      });

      expect(result).toBe('created');
      expect(state.tasks).toHaveProperty('task_1');
      expect(state.tasks.task_1.subject).toBe('Test Task');
    });

    it('persists state to file', async () => {
      await store.updateState('test-namespace', (state) => {
        state.tasks.task_1 = {
          id: 'task_1',
          subject: 'Test Task',
          description: 'Test description',
          activeForm: 'Testing',
          status: 'pending',
          priority: 'normal',
          owner: null,
          blockedBy: [],
          blocks: [],
          progress: 0,
          checkpoints: [],
          retryConfig: { maxRetries: 3, retryDelayMs: 5000, backoffMultiplier: 2, retryOn: [] },
          retryCount: 0,
          tags: [],
          metadata: {},
          history: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        };
        return 'created';
      });

      const filePath = store.getNamespaceFilePath('test-namespace');
      const fileContent = await fs.readFile(filePath, 'utf8');
      const parsed = JSON.parse(fileContent);

      expect(parsed.tasks).toHaveProperty('task_1');
    });

    it('handles async updater', async () => {
      const { state, result } = await store.updateState('test-namespace', async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        state.tasks.task_1 = {
          id: 'task_1',
          subject: 'Test Task',
          description: 'Test description',
          activeForm: 'Testing',
          status: 'pending',
          priority: 'normal',
          owner: null,
          blockedBy: [],
          blocks: [],
          progress: 0,
          checkpoints: [],
          retryConfig: { maxRetries: 3, retryDelayMs: 5000, backoffMultiplier: 2, retryOn: [] },
          retryCount: 0,
          tags: [],
          metadata: {},
          history: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          version: 1,
        };
        return 'async-created';
      });

      expect(result).toBe('async-created');
      expect(state.tasks).toHaveProperty('task_1');
    });

    it('handles updater errors', async () => {
      await expect(
        store.updateState('test-namespace', () => {
          throw new Error('Updater error');
        })
      ).rejects.toThrow('Updater error');
    });

    it('releases lock on error', async () => {
      // First update fails
      await expect(
        store.updateState('test-namespace', () => {
          throw new Error('First error');
        })
      ).rejects.toThrow('First error');

      // Second update should succeed (lock was released)
      const { result } = await store.updateState('test-namespace', () => {
        return 'success';
      });

      expect(result).toBe('success');
    });

    it('handles concurrent updates', async () => {
      const results: string[] = [];

      const update1 = store.updateState('test-namespace', async (_state) => {
        await new Promise((resolve) => setTimeout(resolve, 50));
        results.push('update1');
        return 'result1';
      });

      const update2 = store.updateState('test-namespace', async (_state) => {
        await new Promise((resolve) => setTimeout(resolve, 10));
        results.push('update2');
        return 'result2';
      });

      const [result1, result2] = await Promise.all([update1, update2]);

      expect(result1.result).toBe('result1');
      expect(result2.result).toBe('result2');
      // Both updates should have completed
      expect(results).toHaveLength(2);
      expect(results).toContain('update1');
      expect(results).toContain('update2');
    });

    it('uses custom now function', async () => {
      const mockNow = vi.fn().mockReturnValue(1234567890);
      const store = new TaskStore({ baseDir: tempDir, now: mockNow });

      await store.updateState('test-namespace', (_state) => {
        return 'result';
      });

      expect(mockNow).toHaveBeenCalled();
    });
  });

  describe('file operations', () => {
    it('creates base directory on first access', async () => {
      const newDir = path.join(tempDir, 'new-dir');
      const store = new TaskStore({ baseDir: newDir });

      await store.getState('test-namespace');

      const stats = await fs.stat(newDir);
      expect(stats.isDirectory()).toBe(true);
    });

    it('handles permission errors on directory creation', async () => {
      // Skip on Windows as chmod doesn't work the same way
      if (process.platform === 'win32') {
        return;
      }
      const restrictedDir = path.join(tempDir, 'restricted');
      await fs.mkdir(restrictedDir, { recursive: true });
      await fs.chmod(restrictedDir, 0o000);

      try {
        const store = new TaskStore({ baseDir: path.join(restrictedDir, 'subdir') });
        await expect(store.getState('test-namespace')).rejects.toThrow();
      } finally {
        await fs.chmod(restrictedDir, 0o755);
      }
    });

    it('handles permission errors on file write', async () => {
      const filePath = store.getNamespaceFilePath('test-namespace');
      await fs.writeFile(filePath, '{}');
      await fs.chmod(filePath, 0o000);

      try {
        await expect(store.updateState('test-namespace', () => 'result')).rejects.toThrow();
      } finally {
        await fs.chmod(filePath, 0o644);
      }
    });
  });
});

describe('getTaskStore', () => {
  it('returns same store for same baseDir', () => {
    const store1 = getTaskStore({ baseDir: '/tmp/test' });
    const store2 = getTaskStore({ baseDir: '/tmp/test' });

    expect(store1).toBe(store2);
  });

  it('returns different store for different baseDir', () => {
    const store1 = getTaskStore({ baseDir: '/tmp/test1' });
    const store2 = getTaskStore({ baseDir: '/tmp/test2' });

    expect(store1).not.toBe(store2);
  });

  it('returns same store for equivalent baseDir', () => {
    const store1 = getTaskStore({ baseDir: '/tmp/test' });
    const store2 = getTaskStore({ baseDir: '/tmp/test/' });

    expect(store1).toBe(store2);
  });
});
