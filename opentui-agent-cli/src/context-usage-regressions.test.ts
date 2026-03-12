import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

import { describe, expect, it } from 'vitest';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const readSource = async (path: string) => {
  return readFile(path, 'utf8');
};

describe('context usage regressions', () => {
  it('does not clear context usage at the start of a new request', async () => {
    const source = await readSource(join(__dirname, 'hooks/use-agent-chat.ts'));

    expect(source).not.toContain('setContextUsagePercent(null);');
  });

  it('does not render missing context usage as 0%', async () => {
    const source = await readSource(join(__dirname, 'components/footer-hints.tsx'));

    expect(source).not.toContain(": '0%'");
  });
});
