import { readFile } from 'node:fs/promises';

import { describe, expect, it } from 'vitest';

const readSource = async (path: string) => {
  return readFile(path, 'utf8');
};

describe('context usage regressions', () => {
  it('does not clear context usage at the start of a new request', async () => {
    const source = await readSource(
      '/Users/wrr/work/coding-agent-v2/opentui-agent-cli/src/hooks/use-agent-chat.ts'
    );

    expect(source).not.toContain('setContextUsagePercent(null);');
  });

  it('does not render missing context usage as 0%', async () => {
    const source = await readSource(
      '/Users/wrr/work/coding-agent-v2/opentui-agent-cli/src/components/footer-hints.tsx'
    );

    expect(source).not.toContain(": '0%'");
  });
});
