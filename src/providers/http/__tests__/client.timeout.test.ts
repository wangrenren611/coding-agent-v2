import { afterEach, describe, expect, it, vi } from 'vitest';
import { HTTPClient } from '../client';
import { LLMRetryableError, LLMAbortedError } from '../../types';

describe('HTTPClient timeout behavior', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should handle external timeout signal from upstream (Agent layer controls timeout)', async () => {
    const timeoutMs = 80;
    const simulatedSlowFetchMs = 1000;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, simulatedSlowFetchMs);
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          }
        });
        throw new Error('should not reach successful fetch path');
      }
    );

    // HTTPClient 不再需要 debug 参数
    const client = new HTTPClient();

    // 模拟 Agent 层创建的超时信号
    const timeoutSignal = AbortSignal.timeout(timeoutMs);

    const startedAt = Date.now();
    const error = await client
      .fetch('https://example.test/slow', {
        signal: timeoutSignal,
      })
      .then(
        () => null,
        (err) => err
      );
    const elapsedMs = Date.now() - startedAt;

    // HTTPClient 应该正确处理外部超时信号
    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).code).toBe('TIMEOUT');
    expect(elapsedMs).toBeGreaterThanOrEqual(40);
    expect(elapsedMs).toBeLessThan(simulatedSlowFetchMs);
  });

  it('should apply defaultTimeoutMs when upstream signal is not provided', async () => {
    const timeoutMs = 80;
    const simulatedSlowFetchMs = 1000;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, simulatedSlowFetchMs);
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          }
        });
        throw new Error('should not reach successful fetch path');
      }
    );

    const client = new HTTPClient({ defaultTimeoutMs: timeoutMs });

    const startedAt = Date.now();
    const error = await client.fetch('https://example.test/default-timeout').then(
      () => null,
      (err) => err
    );
    const elapsedMs = Date.now() - startedAt;

    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).code).toBe('TIMEOUT');
    expect(elapsedMs).toBeGreaterThanOrEqual(40);
    expect(elapsedMs).toBeLessThan(simulatedSlowFetchMs);
  });

  it('should not apply defaultTimeoutMs when upstream signal is provided', async () => {
    const defaultTimeoutMs = 20;
    const userAbortMs = 80;
    const simulatedSlowFetchMs = 1000;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, simulatedSlowFetchMs);
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          }
        });
        throw new Error('should not reach successful fetch path');
      }
    );

    const client = new HTTPClient({ defaultTimeoutMs });
    const controller = new AbortController();
    setTimeout(() => controller.abort(), userAbortMs);

    const startedAt = Date.now();
    const error = await client
      .fetch('https://example.test/user-abort', {
        signal: controller.signal,
      })
      .then(
        () => null,
        (err) => err
      );
    const elapsedMs = Date.now() - startedAt;

    expect(error).toBeInstanceOf(LLMAbortedError);
    expect(elapsedMs).toBeGreaterThanOrEqual(50);
    expect(elapsedMs).toBeLessThan(simulatedSlowFetchMs);
  });

  it('should handle user abort signal (not timeout)', async () => {
    const simulatedSlowFetchMs = 1000;

    vi.spyOn(globalThis, 'fetch').mockImplementation(
      async (_input: string | URL | Request, init?: RequestInit) => {
        const signal = init?.signal;
        await new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, simulatedSlowFetchMs);
          if (signal) {
            if (signal.aborted) {
              clearTimeout(timer);
              reject(new DOMException('Aborted', 'AbortError'));
              return;
            }

            signal.addEventListener(
              'abort',
              () => {
                clearTimeout(timer);
                reject(new DOMException('Aborted', 'AbortError'));
              },
              { once: true }
            );
          }
        });
        throw new Error('should not reach successful fetch path');
      }
    );

    const client = new HTTPClient();
    const abortController = new AbortController();

    // 在 50ms 后中止（用户主动取消，不是超时）
    setTimeout(() => abortController.abort(), 50);

    const error = await client
      .fetch('https://example.test/slow', {
        signal: abortController.signal,
      })
      .then(
        () => null,
        (err) => err
      );

    // 用户中止应该返回 AbortedError，而不是 TimeoutError
    expect(error).toBeInstanceOf(LLMAbortedError);
  });

  it('should pass through LLMError from upstream', async () => {
    const llmError = new LLMRetryableError('Custom error', 1000, 'CUSTOM');

    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw llmError;
    });

    const client = new HTTPClient();

    const error = await client.fetch('https://example.test/error').then(
      () => null,
      (err) => err
    );

    // LLMError 应该直接传递
    expect(error).toBe(llmError);
  });

  it('should work without any signal (no timeout at HTTP layer)', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response(JSON.stringify({ data: 'ok' }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });

    const client = new HTTPClient();

    const response = await client.fetch('https://example.test/ok');

    expect(response.ok).toBe(true);
  });

  it('should honor Retry-After header with sub-second precision', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('rate limited', {
        status: 429,
        statusText: 'Too Many Requests',
        headers: { 'Retry-After': '0.25' },
      });
    });

    const client = new HTTPClient();
    const error = await client.fetch('https://example.test/rate-limit').then(
      () => null,
      (err) => err
    );

    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).retryAfter).toBe(250);
  });

  it('should honor retry-after-ms header when provided', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      return new Response('server busy', {
        status: 503,
        statusText: 'Service Unavailable',
        headers: { 'retry-after-ms': '1350' },
      });
    });

    const client = new HTTPClient();
    const error = await client.fetch('https://example.test/server-busy').then(
      () => null,
      (err) => err
    );

    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).retryAfter).toBe(1350);
  });

  it('should normalize network errors to LLMRetryableError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      const error = new Error('connect ECONNREFUSED');
      (error as Error & { code: string }).code = 'ECONNREFUSED';
      throw error;
    });

    const client = new HTTPClient();

    const error = await client.fetch('https://example.test/error').then(
      () => null,
      (err) => err
    );

    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).code).toBe('NETWORK_ERROR');
  });

  it('should normalize bun-style unable to connect errors to LLMRetryableError', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      throw new Error('Unable to connect. Is the computer able to access the url?');
    });

    const client = new HTTPClient();

    const error = await client.fetch('https://example.test/error').then(
      () => null,
      (err) => err
    );

    expect(error).toBeInstanceOf(LLMRetryableError);
    expect((error as LLMRetryableError).code).toBe('NETWORK_ERROR');
    expect((error as Error).message).toContain('Unable to connect');
  });
});
