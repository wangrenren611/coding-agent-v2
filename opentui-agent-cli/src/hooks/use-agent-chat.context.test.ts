import { describe, it } from 'vitest';

describe('useAgentChat context behavior', () => {
  it.todo(
    'keeps the previous context usage visible when a resend starts until the first fresh context update arrives'
  );
  it.todo(
    'updates context usage from realtime onContextUsage before the final usage event is emitted'
  );
});
