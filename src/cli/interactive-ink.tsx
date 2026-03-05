import { render } from 'ink';
import { App } from './ui/App';
import type { PersistedCliConfig } from './types';
import type { CliRuntime } from './runtime';

interface InteractiveOptions {
  runtime: CliRuntime;
  initialPrompt?: string;
  binName: string;
  baseCwd: string;
  config: PersistedCliConfig;
}

export async function runInteractive(options: InteractiveOptions): Promise<void> {
  const app = render(<App {...options} />);
  await app.waitUntilExit();
}
