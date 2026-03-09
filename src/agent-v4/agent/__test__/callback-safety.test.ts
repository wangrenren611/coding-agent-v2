import { describe, expect, it, vi } from 'vitest';
import { safeCallback, safeErrorCallback } from '../callback-safety';

describe('callback-safety', () => {
  it('safeCallback runs callback and swallows callback errors through onError', async () => {
    const okCallback = vi.fn(async () => undefined);
    const onError = vi.fn();
    await safeCallback(okCallback, 'x', onError);
    expect(okCallback).toHaveBeenCalledWith('x');
    expect(onError).not.toHaveBeenCalled();

    const bad = vi.fn(async () => {
      throw new Error('boom');
    });
    await safeCallback(bad, 'y', onError);
    expect(onError).toHaveBeenCalled();
  });

  it('safeErrorCallback returns decision and handles callback errors', async () => {
    const decision = await safeErrorCallback(async () => ({ retry: true }), new Error('e'));
    expect(decision).toEqual({ retry: true });

    const onError = vi.fn();
    const fallback = await safeErrorCallback(
      async () => {
        throw new Error('callback crash');
      },
      new Error('e2'),
      onError
    );
    expect(fallback).toBeUndefined();
    expect(onError).toHaveBeenCalled();
  });
});
