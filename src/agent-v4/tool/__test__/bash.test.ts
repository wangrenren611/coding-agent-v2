import { EventEmitter } from 'events';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ToolExecutionContext } from '../types';

const spawnMock = vi.hoisted(() => vi.fn());

vi.mock('child_process', () => ({
  spawn: spawnMock,
}));

import { BashTool } from '../bash';
import { ToolExecutionError } from '../error';

type MockChild = EventEmitter & {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
};

function createChild(): MockChild {
  const child = new EventEmitter() as MockChild;
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = vi.fn();
  return child;
}

function createContext(partial?: Partial<ToolExecutionContext>): ToolExecutionContext {
  return {
    toolCallId: 'call_1',
    loopIndex: 1,
    agent: {},
    ...partial,
  };
}

describe('BashTool', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useRealTimers();
  });

  it('executes successfully and streams stdout/stderr chunks', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();
    const onChunk = vi.fn();

    const promise = tool.execute(
      { command: 'echo ok', timeout: 1000 },
      createContext({ onChunk: onChunk as ToolExecutionContext['onChunk'] })
    );

    child.stdout.emit('data', Buffer.from('ok'));
    child.stderr.emit('data', Buffer.from('warn'));
    child.emit('close', 0);

    const result = await promise;

    expect(spawnMock).toHaveBeenCalledOnce();
    expect(result.success).toBe(true);
    expect(result.output).toBe('ok');
    expect(result.metadata).toMatchObject({ command: 'echo ok' });
    expect(onChunk).toHaveBeenCalledTimes(2);
    expect(onChunk.mock.calls[0]?.[0]).toMatchObject({ type: 'stdout', content: 'ok', data: 'ok' });
    expect(onChunk.mock.calls[1]?.[0]).toMatchObject({
      type: 'stderr',
      content: 'warn',
      data: 'warn',
    });
  });

  it('returns ToolExecutionError when command exits non-zero with stderr', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'bad cmd', timeout: 1000 }, createContext());
    child.stderr.emit('data', Buffer.from('permission denied'));
    child.emit('close', 1);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error).toBeInstanceOf(ToolExecutionError);
    expect(result.error?.message).toBe('permission denied');
    expect(result.metadata).toMatchObject({ command: 'bad cmd' });
  });

  it('returns fallback close-code error when stderr is empty', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'bad cmd', timeout: 1000 }, createContext());
    child.emit('close', 2);
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Command exited with code 2');
  });

  it('handles child process error event', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'echo ok', timeout: 1000 }, createContext());
    child.emit('error', new Error('spawn failed'));
    const result = await promise;

    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('spawn failed');
  });

  it('aborts command when toolAbortSignal is triggered', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();
    const abortController = new AbortController();

    const promise = tool.execute(
      { command: 'long job', timeout: 1000 },
      createContext({ toolAbortSignal: abortController.signal })
    );
    abortController.abort();
    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Command aborted');
  });

  it('aborts immediately when signal is already aborted before execution', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();
    const abortController = new AbortController();
    abortController.abort();

    const result = await tool.execute(
      { command: 'long job', timeout: 1000 },
      createContext({ toolAbortSignal: abortController.signal })
    );

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Command aborted');
  });

  it('times out and kills child process', async () => {
    vi.useFakeTimers();
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'sleep', timeout: 5 }, createContext());
    await vi.advanceTimersByTimeAsync(5);
    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Command timed out after 5ms');
  });

  it('uses default timeout when timeout is not provided', async () => {
    vi.useFakeTimers();
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'sleep default' }, createContext());
    await vi.advanceTimersByTimeAsync(60000);
    const result = await promise;

    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('Command timed out after 60000ms');
  });

  it('uses non-windows shell on linux platform', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('linux');
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'echo 1', timeout: 1000 }, createContext());
    child.emit('close', 0);
    const result = await promise;

    expect(spawnMock).toHaveBeenCalledWith(
      '/bin/sh',
      ['-c', 'echo 1'],
      expect.objectContaining({
        cwd: process.cwd(),
        env: process.env,
      })
    );
    expect(result.success).toBe(true);
    platformSpy.mockRestore();
  });

  it('ignores duplicate close events after promise is settled', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'echo once', timeout: 1000 }, createContext());
    child.stdout.emit('data', Buffer.from('done'));
    child.emit('close', 0);
    child.emit('close', 0);

    const result = await promise;
    expect(result.success).toBe(true);
    expect(result.output).toBe('done');
  });

  it('ignores duplicate error events after rejection is settled', async () => {
    const child = createChild();
    spawnMock.mockReturnValue(child);
    const tool = new BashTool();

    const promise = tool.execute({ command: 'echo fail', timeout: 1000 }, createContext());
    child.emit('error', new Error('first error'));
    child.emit('error', new Error('second error'));

    const result = await promise;
    expect(result.success).toBe(false);
    expect(result.error?.message).toBe('first error');
  });
});
