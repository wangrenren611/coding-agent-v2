import { describe, expect, it } from 'vitest';

import { resolveReplyStatus } from './use-agent-chat';

describe('resolveReplyStatus', () => {
  it('maps server-side error completions to reply error state', () => {
    expect(resolveReplyStatus('error')).toBe('error');
  });

  it('keeps non-error completions as done state', () => {
    expect(resolveReplyStatus('stop')).toBe('done');
    expect(resolveReplyStatus('cancelled')).toBe('done');
  });
});
