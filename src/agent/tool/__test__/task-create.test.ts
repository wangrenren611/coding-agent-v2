import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskCreateTool } from '../task-create';
import { TaskStore } from '../task-store';

describe('TaskCreateTool', () => {
  let tempDir: string;
  let store: TaskStore;
  let tool: TaskCreateTool;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-create-test-'));
    store = new TaskStore({ baseDir: tempDir });
    tool = new TaskCreateTool({ store });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('name and description', () => {
    it('has correct name', () => {
      expect(tool.name).toBe('task_create');
    });

    it('has description', () => {
      expect(tool.description).toBeTruthy();
    });
  });

  describe('parameters', () => {
    it('has required parameters', () => {
      const schema = tool.parameters;
      expect(schema).toBeDefined();
    });
  });

  describe('execute', () => {
    it('creates a task successfully', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Test Task');
    });

    it('creates task with all optional fields', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        active_form: 'Testing',
        priority: 'high',
        tags: [{ name: 'test', color: 'red' }],
        checkpoints: [{ id: 'cp1', name: 'Checkpoint 1' }],
        retry_config: {
          maxRetries: 5,
          retryDelayMs: 1000,
          backoffMultiplier: 2,
          retryOn: ['timeout'],
        },
        timeout_ms: 60000,
        metadata: { key: 'value' },
        created_by: 'user_1',
      });

      expect(result.success).toBe(true);
    });

    it('creates task with custom namespace', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        namespace: 'custom',
      });

      expect(result.success).toBe(true);
    });

    it('rejects duplicate active task subject', async () => {
      // Create first task
      await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      // Try to create duplicate
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'Another test task description with enough length',
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain('TASK_DUPLICATE_SUBJECT');
    });

    it('allows duplicate subject after task is completed', async () => {
      // Create first task
      const first = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      // Get task ID from output
      const firstData = JSON.parse(first.output!);
      const taskId = firstData.task.id;

      // Mark task as completed
      await store.updateState('default', (state) => {
        state.tasks[taskId].status = 'completed';
        return 'updated';
      });

      // Create duplicate should succeed
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'Another test task description with enough length',
      });

      expect(result.success).toBe(true);
    });

    it('allows duplicate subject after task is cancelled', async () => {
      // Create first task
      const first = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      const firstData = JSON.parse(first.output!);
      const taskId = firstData.task.id;

      // Mark task as cancelled
      await store.updateState('default', (state) => {
        state.tasks[taskId].status = 'cancelled';
        return 'updated';
      });

      // Create duplicate should succeed
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'Another test task description with enough length',
      });

      expect(result.success).toBe(true);
    });

    it('allows duplicate subject after task is failed', async () => {
      // Create first task
      const first = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      const firstData = JSON.parse(first.output!);
      const taskId = firstData.task.id;

      // Mark task as failed
      await store.updateState('default', (state) => {
        state.tasks[taskId].status = 'failed';
        return 'updated';
      });

      // Create duplicate should succeed
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'Another test task description with enough length',
      });

      expect(result.success).toBe(true);
    });

    it('trims subject and description', async () => {
      const result = await tool.execute({
        subject: '  Test Task  ',
        description: '  This is a test task description with enough length  ',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.subject).toBe('Test Task');
      expect(data.task.description).toBe('This is a test task description with enough length');
    });

    it('uses default active_form when not provided', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.activeForm).toBe('Test Task in progress');
    });

    it('uses default priority when not provided', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.priority).toBe('normal');
    });

    it('uses default retry config when not provided', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.retryConfig.maxRetries).toBe(3);
      expect(data.task.retryConfig.retryDelayMs).toBe(5000);
      expect(data.task.retryConfig.backoffMultiplier).toBe(2);
    });

    it('creates task with checkpoints', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        checkpoints: [
          { id: 'cp1', name: 'Checkpoint 1', completed: false },
          { id: 'cp2', name: 'Checkpoint 2', completed: true },
        ],
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.checkpoints).toHaveLength(2);
      expect(data.task.checkpoints[0].id).toBe('cp1');
      expect(data.task.checkpoints[1].completed).toBe(true);
    });

    it('creates task with tags', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        tags: [
          { name: 'urgent', color: 'red', category: 'priority' },
          { name: 'backend', category: 'team' },
        ],
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.tags).toHaveLength(2);
      expect(data.task.tags[0].name).toBe('urgent');
      expect(data.task.tags[0].color).toBe('red');
    });

    it('creates task with metadata', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        metadata: { key1: 'value1', key2: 42, key3: true },
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.metadata.key1).toBe('value1');
      expect(data.task.metadata.key2).toBe(42);
      expect(data.task.metadata.key3).toBe(true);
    });

    it('creates task with timeout', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        timeout_ms: 60000,
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.timeoutMs).toBe(60000);
    });

    it('creates task with created_by', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        created_by: 'user_1',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.history[0].actor).toBe('user_1');
    });

    it('creates task with default namespace', async () => {
      const tool = new TaskCreateTool({ store, defaultNamespace: 'custom' });
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.namespace).toBe('custom');
    });

    it('creates task with namespace from args overriding default', async () => {
      const tool = new TaskCreateTool({ store, defaultNamespace: 'default' });
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
        namespace: 'custom',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.namespace).toBe('custom');
    });

    it('handles store errors', async () => {
      // Create a store that throws errors
      const errorStore = {
        normalizeNamespace: () => 'default',
        updateState: async () => {
          throw new Error('Store error');
        },
      } as any;

      const tool = new TaskCreateTool({ store: errorStore });
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain('TASK_OPERATION_FAILED');
    });

    it('handles prefixed errors', async () => {
      // Create a store that throws prefixed errors
      const errorStore = {
        normalizeNamespace: () => 'default',
        updateState: async () => {
          throw new Error('TASK_INVALID_NAMESPACE: invalid namespace');
        },
      } as any;

      const tool = new TaskCreateTool({ store: errorStore });
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(false);
      expect(result.output).toContain('TASK_INVALID_NAMESPACE');
    });

    it('generates unique task IDs', async () => {
      const result1 = await tool.execute({
        subject: 'Test Task 1',
        description: 'This is a test task description with enough length',
      });

      const result2 = await tool.execute({
        subject: 'Test Task 2',
        description: 'This is another test task description with enough length',
      });

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);

      const data1 = JSON.parse(result1.output!);
      const data2 = JSON.parse(result2.output!);

      expect(data1.task.id).not.toBe(data2.task.id);
    });

    it('sets initial task status to pending', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.status).toBe('pending');
    });

    it('sets initial progress to 0', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.progress).toBe(0);
    });

    it('sets initial retryCount to 0', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.retryCount).toBe(0);
    });

    it('sets owner to null', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.owner).toBeNull();
    });

    it('sets blockedBy and blocks to empty arrays', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.blockedBy).toEqual([]);
      expect(data.task.blocks).toEqual([]);
    });

    it('sets version to 1', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.version).toBe(1);
    });

    it('sets createdAt and updatedAt timestamps', async () => {
      const before = Date.now();
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });
      const after = Date.now();

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.createdAt).toBeGreaterThanOrEqual(before);
      expect(data.task.createdAt).toBeLessThanOrEqual(after);
      expect(data.task.updatedAt).toBeGreaterThanOrEqual(before);
      expect(data.task.updatedAt).toBeLessThanOrEqual(after);
    });

    it('creates history entry', async () => {
      const result = await tool.execute({
        subject: 'Test Task',
        description: 'This is a test task description with enough length',
      });

      expect(result.success).toBe(true);
      const data = JSON.parse(result.output!);
      expect(data.task.history).toHaveLength(1);
      expect(data.task.history[0].action).toBe('created');
      expect(data.task.history[0].metadata.subject).toBe('Test Task');
    });
  });

  describe('shouldConfirm', () => {
    it('returns false', () => {
      expect(tool.shouldConfirm({ subject: 'Test', description: 'Test description' })).toBe(false);
    });
  });

  describe('getConfirmDetails', () => {
    it('returns null', () => {
      expect(
        tool.getConfirmDetails({ subject: 'Test', description: 'Test description' })
      ).toBeNull();
    });
  });

  describe('getConcurrencyMode', () => {
    it('returns exclusive', () => {
      expect(tool.getConcurrencyMode()).toBe('exclusive');
    });
  });

  describe('getConcurrencyLockKey', () => {
    it('returns lock key based on namespace', () => {
      expect(
        tool.getConcurrencyLockKey({ subject: 'Test', description: 'Test description' } as any)
      ).toBe('taskns:default');
    });

    it('returns lock key with custom namespace', () => {
      expect(
        tool.getConcurrencyLockKey({
          subject: 'Test',
          description: 'Test description',
          namespace: 'custom',
        } as any)
      ).toBe('taskns:custom');
    });

    it('returns lock key with default namespace', () => {
      const tool = new TaskCreateTool({ store, defaultNamespace: 'custom' });
      expect(
        tool.getConcurrencyLockKey({ subject: 'Test', description: 'Test description' } as any)
      ).toBe('taskns:custom');
    });
  });
});
