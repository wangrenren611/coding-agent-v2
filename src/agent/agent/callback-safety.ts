import type { ErrorDecision } from '../types';

export async function safeCallback<T>(
  callback: ((arg: T) => void | Promise<void>) | undefined,
  arg: T,
  onError?: (error: unknown) => void
): Promise<void> {
  if (!callback) {
    return;
  }
  try {
    await callback(arg);
  } catch (error) {
    onError?.(error);
  }
}

export async function safeErrorCallback(
  callback: ((error: Error) => ErrorDecision | void | Promise<ErrorDecision | void>) | undefined,
  error: Error,
  onError?: (error: unknown) => void
): Promise<ErrorDecision | undefined> {
  if (!callback) {
    return undefined;
  }
  try {
    const result = await callback(error);
    return result as ErrorDecision | undefined;
  } catch (err) {
    onError?.(err);
    return undefined;
  }
}
