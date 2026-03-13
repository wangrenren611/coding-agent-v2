# OpenTUI Agent CLI (React + Bun)

Initialized from the latest OpenTUI React template:

```bash
bun create tui --template react opentui-agent-cli
```

Current package versions:

- `@opentui/core`: `0.1.84`
- `@opentui/react`: `0.1.84`
- `react`: `19.2.4`

## Run

```bash
bun dev
```

Optional hot reload (less stable for interactive TUI signal handling):

```bash
bun run dev:watch
```

## What is implemented

- Agent-style CLI chat layout (header, conversation panel, prompt input)
- Built-in commands: `/help`, `/clear`, `/exit`
- Keyboard shortcuts: `Esc` (stop current response when thinking, otherwise clear input), `Ctrl+L` (clear conversation)
- Simulated async agent reply flow

## Main file

- `src/index.tsx`

## Configuration

OpenTUI Agent CLI uses the shared Renx config system.

Effective precedence is:

1. Existing process environment variables plus values loaded from `.env` / `.env.development`
2. Project config: `<workspace>/.renx/config.json`
3. Global config: `RENX_HOME/config.json`
4. Built-in defaults

Directory-related state is managed from a single root:

- `RENX_HOME` defaults to `~/.renx`
- `RENX_HOME/config.json` for global config
- `RENX_HOME/logs/` for log files
- `RENX_HOME/storage/` for file-history storage
- `RENX_HOME/task/` for task data
- `RENX_HOME/data.db` for the shared SQLite database

## Supported Environment Variables

Application/runtime variables:

- `RENX_HOME`: overrides the user-level Renx home directory
- `AGENT_MODEL`: default model id
- `AGENT_MAX_STEPS`: max steps per run
- `AGENT_MAX_RETRY_COUNT`: agent retry count
- `AGENT_TOOL_CONFIRMATION_MODE`: `manual`, `auto-approve`, or `auto-deny`
- `AGENT_CONVERSATION_ID`: fixed conversation id for the CLI runtime
- `AGENT_SESSION_ID`: fallback session id when `AGENT_CONVERSATION_ID` is unset

Logging variables:

- `AGENT_LOG_LEVEL`: `TRACE`, `DEBUG`, `INFO`, `WARN`, `ERROR`, or `FATAL`
- `AGENT_LOG_FORMAT`: `pretty` or `json`
- `AGENT_LOG_CONSOLE`: enable/disable console logging
- `AGENT_LOG_FILE_ENABLED`: enable/disable file logging

File history variables:

- `AGENT_FILE_HISTORY_ENABLED`
- `AGENT_FILE_HISTORY_MAX_PER_FILE`
- `AGENT_FILE_HISTORY_MAX_AGE_DAYS`
- `AGENT_FILE_HISTORY_MAX_TOTAL_MB`

Model provider API keys are still provided through their own env vars such as `GLM_API_KEY`.

## Config File Shape

Global and project config files use the same JSON structure:

```json
{
  "agent": {
    "defaultModel": "qwen3.5-plus",
    "maxSteps": 10000,
    "confirmationMode": "manual"
  },
  "log": {
    "level": "INFO",
    "format": "pretty",
    "console": true,
    "file": false
  },
  "storage": {
    "fileHistory": {
      "enabled": true,
      "maxPerFile": 20,
      "maxAgeDays": 14,
      "maxTotalMb": 500
    }
  }
}
```

There are no per-directory config fields anymore. All user-level paths are derived from `RENX_HOME`.
