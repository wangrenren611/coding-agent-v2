import path from 'node:path';
import { promises as fs } from 'node:fs';
import { parseCliArgs, detectCommand, printHelp } from './args';
import { createQuietRenderer } from './output';
import { runInteractive } from './interactive';
import { ensureBaseDirectory, loadConfigWithDefaults, runCommand } from './commands';
import { CliRuntime } from './runtime';
import type { ApprovalMode, OutputFormat } from './types';

function isApprovalMode(value: string | undefined): value is ApprovalMode {
  return value === 'default' || value === 'autoEdit' || value === 'yolo';
}

function resolveOutputFormat(value: string | undefined, quiet: boolean): OutputFormat {
  if (value === 'text' || value === 'json' || value === 'stream-json') {
    return value;
  }
  return quiet ? 'stream-json' : 'text';
}

function parseToolSwitches(input: string | undefined): Record<string, boolean> {
  if (!input) {
    return {};
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Invalid --tools JSON: ${message}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Invalid --tools value: expected JSON object');
  }

  const result: Record<string, boolean> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value !== 'boolean') {
      throw new Error(`Invalid --tools value for ${key}: expected boolean`);
    }
    result[key.toLowerCase()] = value;
  }
  return result;
}

async function loadVersion(): Promise<string> {
  try {
    const packagePath = new URL('../../package.json', import.meta.url);
    const raw = await fs.readFile(packagePath, 'utf8');
    const parsed = JSON.parse(raw) as { version?: string };
    return parsed.version ?? '0.0.0';
  } catch {
    return '0.0.0';
  }
}

export async function runCli(argv: string[] = process.argv.slice(2)): Promise<number> {
  const args = parseCliArgs(argv);
  const version = await loadVersion();
  const binName = path.basename(process.argv[1] ?? 'coding-agent');

  if (args.help) {
    printHelp(binName);
    return 0;
  }
  if (args.version) {
    console.log(version);
    return 0;
  }

  const baseCwd = process.cwd();
  await ensureBaseDirectory(baseCwd);

  const config = await loadConfigWithDefaults(baseCwd);
  const cwd = path.resolve(baseCwd, args.cwd ?? config.defaultCwd ?? process.cwd());

  const runtime = new CliRuntime({
    baseCwd,
    cwd,
    modelId: args.model ?? config.defaultModel,
    systemPrompt: args.systemPrompt ?? config.defaultSystemPrompt,
    outputFormat: resolveOutputFormat(args.outputFormat, args.quiet),
    approvalMode: isApprovalMode(args.approvalMode)
      ? args.approvalMode
      : isApprovalMode(config.defaultApprovalMode)
        ? config.defaultApprovalMode
        : 'default',
    disabledTools: config.disabledTools,
    quiet: args.quiet,
  });

  const toolSwitches = parseToolSwitches(args.tools);
  for (const [toolName, enabled] of Object.entries(toolSwitches)) {
    runtime.setToolEnabled(toolName, enabled);
  }

  if (args.appendSystemPrompt) {
    runtime.appendSystemPrompt(args.appendSystemPrompt);
  }

  await runtime.initialize();

  try {
    const resolvedSessionId = runtime.resolveSessionId(args.resume, args.continueSession);
    runtime.setSession(resolvedSessionId);

    const command = detectCommand(args);
    if (command) {
      const handled = await runCommand(
        command,
        args.positional.slice(1),
        runtime,
        baseCwd,
        config,
        binName
      );
      if (!handled) {
        throw new Error(`Unsupported command: ${command}`);
      }
      return 0;
    }

    const initialPrompt = args.positional.join(' ').trim();

    if (args.quiet) {
      if (!initialPrompt) {
        throw new Error('Prompt is required in quiet mode');
      }
      const renderer = createQuietRenderer(runtime.state.outputFormat);
      await runtime.runPrompt(initialPrompt, renderer);
      return 0;
    }

    await runInteractive({
      runtime,
      initialPrompt,
      binName,
      baseCwd,
      config,
    });

    return 0;
  } finally {
    await runtime.close();
  }
}
