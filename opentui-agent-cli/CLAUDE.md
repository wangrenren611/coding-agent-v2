# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

A terminal-based AI Agent CLI built with OpenTUI (React), Bun runtime, and TypeScript. It provides a chat interface for interacting with AI models through a TUI (Terminal User Interface).

## Commands

```bash
# Development
bun dev              # Run the CLI
bun run dev:watch    # Run with hot reload (less stable for interactive TUI)

# Code Quality
bun run lint         # Run ESLint
bun run lint:fix     # Fix ESLint issues
bun run format       # Format with Prettier
bun run format:check # Check formatting
bun run type-check   # TypeScript type checking
bun run check        # Run all checks (type-check, lint, format:check)

# Testing
bun test                               # Run all tests
bun test src/path/to/test.ts           # Run a specific test file
bun test --watch src/path/to/test.ts   # Run tests in watch mode
```

## Architecture

### Entry Points

- `src/index.tsx` - Application bootstrap: probes terminal colors, applies themes, initializes the CLI renderer, and renders `<App />`
- `src/App.tsx` - Root component that orchestrates all UI components and handles global keyboard shortcuts

### Core Modules

**Agent Runtime (`src/agent/runtime/`)**

- `runtime.ts` - Central module that interfaces with the AI agent backend. Manages:
  - Model configuration and switching
  - Tool registration (Bash, FileRead, FileEdit, Glob, Grep, Task tools, etc.)
  - Event streaming (text deltas, tool calls, tool results, usage stats)
  - Conversation persistence via SQLite store
  - The runtime is lazily initialized and cached as a singleton

**Chat State Management (`src/hooks/`)**

- `use-agent-chat.ts` - Primary hook managing conversation state:
  - Chat turns (user prompts + assistant replies)
  - Streaming reply assembly via segment-based updates
  - File attachments and prompt content building
  - Tool confirmation dialogs
- `turn-updater.ts` - Immutable turn state updates with segment ordering
- `agent-event-handlers.ts` - Converts agent events to UI state updates

**Type Definitions**

- `src/types/chat.ts` - `ChatTurn`, `AssistantReply`, `ReplySegment` types
- `src/agent/runtime/types.ts` - Agent event types (`AgentTextDeltaEvent`, `AgentToolUseEvent`, etc.)

**UI Components (`src/components/`)**

- React components built with OpenTUI primitives (`<box>`, `<text>`)
- `conversation-panel.tsx` - Displays chat history
- `prompt.tsx` - User input with file mentions
- `chat/assistant-reply.tsx` - Renders assistant messages with segments
- `chat/code-block.tsx` - Syntax-highlighted code blocks
- Dialogs: `model-picker-dialog.tsx`, `file-picker-dialog.tsx`, `tool-confirm-dialog.tsx`

### Key Data Flow

1. User input → `useAgentChat.submitInput()` → `buildPromptContent()` → `runAgentPrompt()`
2. Agent streams events → handlers in `use-agent-chat.ts` → `setTurns()` with `patchTurn()` helpers
3. UI re-renders with updated `turns` array

### External Dependencies

The agent runtime imports from `../../../../src/agent-v4/` for:

- System prompt building
- Core agent implementation (StatelessAgent, tool managers, etc.)

This indicates a monorepo structure where `agent-v4` is a sibling package providing the backend agent logic.
