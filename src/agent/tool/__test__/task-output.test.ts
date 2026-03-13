import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as os from 'node:os';
import * as path from 'node:path';
import { TaskOutputTool } from '../task-output';
import { TaskStore } from '../task-store';
import type { ToolExecutionContext } from '../types';

describe('TaskOutputTool', () => {
  let tempDir: string;
  let store: TaskStore;
  let tool: TaskOutputTool;

  beforeEach(async () => {
    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'task-output-test-'));
    store = new TaskStore({ baseDir: tempDir });
    tool = new TaskOutputTool({ store });
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  describe('name and description', () => {
    it('has correct name', () => {
      expect(tool.name).toBe('task_output');
    });

    it('has description', () => {
      expect(tool.description).toBeTruthy();
    });
  });

  describe('parameters', () => {
    it('has task_id parameter', () => {
      const schema = tool.parameters;
      expect(schema).toBeDefined();
    });
  });

  describe('execute', () => {
    it('returns error when neither agent_id nor task_id is provided', async () => {
      const result = await tool.execute({});

      expect(result.success).toBe(false);
      expect(result.output).toContain('TASK_OUTPUT_TARGET_REQUIRED');
    });

    it('returns error for non-existent task', async () => {
      const result = await tool.execute({ task_id: 'non-existent' });

      expect(result.success).toBe(false);
      expect(result.output).toContain('TASK_NOT_FOUND');
    });

    it('returns error for task without linked agent run', async () => {
      await store.updateState('default', (state) => {
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

      const result = await tool.execute({ task_id: 'task_1' });

      expect(result.success).toBe(false);
      expect(result.output).toContain('AGENT_RUN_NOT_FOUND');
    });

    it('returns error for non-existent agent run', async () => {
      const result = await tool.execute({ agent_id: 'non-existent', block: false });

      expect(result.success).toBe(false);
      expect(result.output).toContain('AGENT_RUN_NOT_FOUND');
    });

    it('handles task with context', async () => {
      const context: ToolExecutionContext = {
        toolCallId: 'call_1',
        loopIndex: 1,
        agent: {},
      };

      const result = await tool.execute({ task_id: 'non-existent' }, context);

      expect(result.success).toBe(false);
    });

    it('handles task with invalid task_id parameter', async () => {
      const result = await tool.execute({ task_id: '' });

      expect(result.success).toBe(false);
    });

    it('handles task with namespace', async () => {
      const result = await tool.execute({ task_id: 'non-existent', namespace: 'custom' });

      expect(result.success).toBe(false);
    });

    it('handles task with block=false', async () => {
      const result = await tool.execute({ agent_id: 'non-existent', block: false });

      expect(result.success).toBe(false);
    });

    it('handles task with timeout_ms', async () => {
      const result = await tool.execute({ agent_id: 'non-existent', timeout_ms: 1000 });

      expect(result.success).toBe(false);
    });

    it('handles task with poll_interval_ms', async () => {
      const result = await tool.execute({ agent_id: 'non-existent', poll_interval_ms: 100 });

      expect(result.success).toBe(false);
    });
  });

  describe('shouldConfirm', () => {
    it('returns false', () => {
      expect(tool.shouldConfirm({ task_id: 'task_1' })).toBe(false);
    });
  });

  describe('getConfirmDetails', () => {
    it('returns null', () => {
      expect(tool.getConfirmDetails({ task_id: 'task_1' })).toBeNull();
    });
  });

  describe('getConcurrencyMode', () => {
    it('returns parallel-safe', () => {
      expect(tool.getConcurrencyMode()).toBe('parallel-safe');
    });
  });

  describe('getConcurrencyLockKey', () => {
    it('returns lock key based on task_id', () => {
      expect(tool.getConcurrencyLockKey({ task_id: 'task_1' })).toBe('taskns:default:agent:task_1');
    });

    it('returns different lock keys for different task_ids', () => {
      expect(tool.getConcurrencyLockKey({ task_id: 'task_1' })).not.toBe(
        tool.getConcurrencyLockKey({ task_id: 'task_2' })
      );
    });

    it('returns lock key based on agent_id', () => {
      expect(tool.getConcurrencyLockKey({ agent_id: 'agent_1' })).toBe(
        'taskns:default:agent:agent_1'
      );
    });

    it('returns lock key with custom namespace', () => {
      const tool = new TaskOutputTool({ store, defaultNamespace: 'custom' });
      expect(tool.getConcurrencyLockKey({ task_id: 'task_1' })).toBe('taskns:custom:agent:task_1');
    });

    it('returns lock key with namespace from args', () => {
      expect(tool.getConcurrencyLockKey({ task_id: 'task_1', namespace: 'custom' })).toBe(
        'taskns:custom:agent:task_1'
      );
    });
  });
});
