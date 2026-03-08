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
- Keyboard shortcuts: `Esc` (clear input), `Ctrl+L` (clear conversation)
- Simulated async agent reply flow

## Main file

- `src/index.tsx`
