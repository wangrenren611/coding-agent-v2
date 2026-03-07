import {
  Agent,
  AgentTerminalController,
  createLoggerFromEnv,
  createMemoryManagerFromEnv,
  createTerminalUiAgentPlugin,
  loadEnvFiles,
  loadRuntimeConfigFromEnv,
  ProviderRegistry,
  TerminalUi,
  type ModelId,
  type ToolConfirmDecision,
} from '../../src/index.ts';
import {
  BashTool,
  FileEditTool,
  FileReadTool,
  FileStatTool,
  FileWriteTool,
  GlobTool,
  GrepTool,
  SkillTool,
  ToolManager,
} from '../../src/tool/index.ts';
import { buildSystemPrompt } from '../../src/prompts/system.ts';

const DEFAULT_MODEL: ModelId = 'glm-5';

function printUsage(): void {
  console.log(`
Terminal UI Agent Example

Usage:
  pnpm example:agent:ui [modelId]

Examples:
  pnpm example:agent:ui
  pnpm example:agent:ui glm-4.7

Env:
  AGENT_AUTO_CONFIRM_TOOLS=true|false
  AGENT_SESSION_ID=<session-id>
`);
}

function resolveModelId(input?: string): ModelId {
  if (!input) {
    return DEFAULT_MODEL;
  }
  const modelIds = ProviderRegistry.getModelIds();
  if (!modelIds.includes(input as ModelId)) {
    throw new Error(`Unsupported modelId: ${input}`);
  }
  return input as ModelId;
}

function resolveAutoConfirm(): ToolConfirmDecision | undefined {
  const raw = process.env.AGENT_AUTO_CONFIRM_TOOLS?.trim().toLowerCase();
  if (!raw) {
    return undefined;
  }
  if (['1', 'true', 'yes', 'y'].includes(raw)) {
    return 'approve';
  }
  if (['0', 'false', 'no', 'n'].includes(raw)) {
    return 'deny';
  }
  return undefined;
}

function createMainToolManager(): ToolManager {
  const manager = new ToolManager();
  manager.register([
    new BashTool(),
    new FileReadTool(),
    new FileWriteTool(),
    new FileEditTool(),
    new FileStatTool(),
    new GlobTool(),
    new GrepTool(),
    new SkillTool(),
  ]);
  return manager;
}

async function main(): Promise<void> {
  const [modelArg] = process.argv.slice(2);

  await loadEnvFiles(process.cwd());

  const modelId = resolveModelId(modelArg);
  const runtimeConfig = loadRuntimeConfigFromEnv(process.env, process.cwd());
  const memoryManager = createMemoryManagerFromEnv(process.env, process.cwd());
  const logger = createLoggerFromEnv(process.env, process.cwd());
  const provider = ProviderRegistry.createFromEnv(modelId, {
    logger: logger.child('Provider'),
  });

  const sessionId = process.env.AGENT_SESSION_ID ?? `agent-ui-${Date.now()}`;
  const ui = new TerminalUi({
    sessionId,
    modelId,
  });

  const plugin = createTerminalUiAgentPlugin((event) => {
    ui.dispatch(event);
  });

  let controller: AgentTerminalController | undefined;
  const agent = new Agent({
    provider,
    toolManager: createMainToolManager(),
    memoryManager,
    logger,
    sessionId,
    systemPrompt: buildSystemPrompt({ directory: process.cwd() }),
    plugins: [plugin],
    onToolConfirm: async (request) => {
      if (!controller) {
        return 'deny';
      }
      return controller.confirmToolExecution(request);
    },
  });

  controller = new AgentTerminalController({
    agent,
    ui,
    autoConfirm: resolveAutoConfirm(),
  });

  ui.dispatch({
    type: 'message.system',
    text:
      `ready model=${modelId} backend=${runtimeConfig.storage.backend} session=${sessionId}; ` +
      'commands: /help /status /tools compact|full /abort /exit (native scrollback + live footer)',
  });

  const result = await controller.run();
  ui.dispatch({
    type: 'message.system',
    text: `controller stopped reason=${result.reason} turns=${result.turns}`,
  });

  await memoryManager.close();
  logger.close();
}

void main().catch((error) => {
  const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  console.error(`[AgentUIError] ${message}`);
  printUsage();
  process.exitCode = 1;
});
