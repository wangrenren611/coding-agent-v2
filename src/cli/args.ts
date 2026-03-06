import { SUPPORTED_COMMANDS } from './constants';
import type { ApprovalMode, CliArgs, OutputFormat } from './types';

const OUTPUT_FORMAT_VALUES: OutputFormat[] = ['text', 'json', 'stream-json'];
const APPROVAL_MODE_VALUES: ApprovalMode[] = ['default', 'autoEdit', 'yolo'];

function isOutputFormat(value: string): value is OutputFormat {
  return OUTPUT_FORMAT_VALUES.includes(value as OutputFormat);
}

function isApprovalMode(value: string): value is ApprovalMode {
  return APPROVAL_MODE_VALUES.includes(value as ApprovalMode);
}

function readValue(argv: string[], index: number, option: string): { value: string; next: number } {
  const value = argv[index + 1];
  if (!value || value.startsWith('-')) {
    throw new Error(`Missing value for option ${option}`);
  }
  return { value, next: index + 1 };
}

export function parseCliArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    positional: [],
    help: false,
    version: false,
    quiet: false,
    continueSession: false,
    newSession: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];

    if (token === '--') {
      parsed.positional.push(...argv.slice(i + 1));
      break;
    }

    if (token.startsWith('--')) {
      const [name, inlineValue] = token.split('=', 2);

      switch (name) {
        case '--help':
          parsed.help = true;
          break;
        case '--version':
          parsed.version = true;
          break;
        case '--quiet':
          parsed.quiet = true;
          break;
        case '--continue':
          parsed.continueSession = true;
          break;
        case '--new-session':
          parsed.newSession = true;
          break;
        case '--resume': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          parsed.resume = value;
          break;
        }
        case '--cwd': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          parsed.cwd = value;
          break;
        }
        case '--model': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          parsed.model = value;
          break;
        }
        case '--output-format': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          if (!isOutputFormat(value)) {
            throw new Error(`Invalid --output-format: ${value}`);
          }
          parsed.outputFormat = value;
          break;
        }
        case '--approval-mode': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          if (!isApprovalMode(value)) {
            throw new Error(`Invalid --approval-mode: ${value}`);
          }
          parsed.approvalMode = value;
          break;
        }
        case '--system-prompt': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          parsed.systemPrompt = value;
          break;
        }
        case '--append-system-prompt': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          parsed.appendSystemPrompt = value;
          break;
        }
        case '--tools': {
          const value = inlineValue ?? readValue(argv, i, name).value;
          if (!inlineValue) i++;
          parsed.tools = value;
          break;
        }
        default:
          throw new Error(`Unknown option: ${name}`);
      }
      continue;
    }

    if (token.startsWith('-') && token.length > 1) {
      const short = token.slice(1);
      if (short === 'h') {
        parsed.help = true;
        continue;
      }
      if (short === 'v') {
        parsed.version = true;
        continue;
      }
      if (short === 'q') {
        parsed.quiet = true;
        continue;
      }
      if (short === 'c') {
        parsed.continueSession = true;
        continue;
      }
      if (short === 'n') {
        parsed.newSession = true;
        continue;
      }
      if (short === 'r') {
        const { value, next } = readValue(argv, i, '-r');
        i = next;
        parsed.resume = value;
        continue;
      }
      if (short === 'm') {
        const { value, next } = readValue(argv, i, '-m');
        i = next;
        parsed.model = value;
        continue;
      }
      throw new Error(`Unknown option: ${token}`);
    }

    parsed.positional.push(token);
  }

  if (parsed.resume && parsed.continueSession) {
    throw new Error('Cannot use --resume and --continue together');
  }
  if (parsed.newSession && parsed.continueSession) {
    throw new Error('Cannot use --new-session and --continue together');
  }
  if (parsed.newSession && parsed.resume) {
    throw new Error('Cannot use --new-session and --resume together');
  }

  return parsed;
}

export function detectCommand(args: CliArgs): string | undefined {
  const command = args.positional[0];
  if (!command) return undefined;
  return SUPPORTED_COMMANDS.includes(command as (typeof SUPPORTED_COMMANDS)[number])
    ? command
    : undefined;
}

export function printHelp(binName: string): void {
  const usage = `
Usage:
  ${binName} [options] [command] [prompt]

Options:
  -h, --help                      Show help
  -v, --version                   Show version
  -q, --quiet                     Quiet mode (non-interactive)
  -m, --model <id>                Set model id
  -r, --resume <session-id>       Resume a session
  -c, --continue                  Continue latest session
  -n, --new-session               Start a new session
  --cwd <path>                    Working directory
  --system-prompt <text>          Override system prompt
  --append-system-prompt <text>   Append text to system prompt
  --output-format <format>        text | json | stream-json
  --approval-mode <mode>          default | autoEdit | yolo
  --tools <json>                  Tool switches, e.g. {"bash":false}

Commands:
  run <prompt>                    Run one prompt and exit
  config [show|set|unset]         Manage CLI config
  model [list|set <id>]           List/set model
  tool [list|enable|disable]      Manage tool toggles
  task [help|tools|examples]      Task V2 workflow usage
  session [list|show|clear]       Session management
  log [session-id]                Print session history log
  workspace [list|add|remove|use] Workspace profiles
  skill [list|show <name>]        Skill inspection

Interactive slash commands:
  /help /exit /quit /model /models /tool /tools /session /sessions /new /resume /history /log
  /approval /cwd /workspace /clear /stats /format /system /config /skill /panel /mode /debug /transcript
`;
  console.log(usage.trimEnd());
}
