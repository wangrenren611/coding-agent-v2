import path from 'node:path';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Text, useApp, useInput } from 'ink';
import type { ToolConfirmDecision, ToolConfirmRequest, ToolStreamEvent } from '../../tool';
import { getSkillLoader, initializeSkillLoader } from '../../tool/skill';
import { saveCliConfig } from '../config-store';
import { createInkRenderer } from '../output';
import type { PersistedCliConfig, WorkspaceProfile } from '../types';
import type { CliRuntime } from '../runtime';
import { getWorkspaceFilePath, loadWorkspaces, saveWorkspaces } from '../workspace-store';
import { ChatInput } from './ChatInput';
import { Messages } from './Messages';
import { StatusLine } from './StatusLine';
import { ActivityIndicator } from './ActivityIndicator';
import { QueueDisplay } from './QueueDisplay';
import { TranscriptModeIndicator } from './TranscriptModeIndicator';
import { Debug } from './Debug';
import { ApprovalModal } from './ApprovalModal';
import { buildPathIndex, searchPathIndex } from './path-search';
import { matchSlashCommands } from './slash-commands';
import {
  extractToolErrorLine,
  formatGenericToolEventLine,
  formatToolCallLine,
  formatToolEndLines,
  formatToolOutputLines,
} from './tool-activity';
import type {
  ActivityEvent,
  ActivityLevel,
  AppStatus,
  ChatLine,
  InputMode,
  PanelMode,
  PendingConfirm,
  SuggestionItem,
} from './types';

function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let timelineSequence = 0;
function nextTimelineSeq(): number {
  timelineSequence += 1;
  return timelineSequence;
}

function parseSlash(raw: string): { command: string; args: string[] } {
  const body = raw.trim().slice(1);
  const parts = body.split(/\s+/).filter(Boolean);
  return {
    command: (parts[0] ?? '').toLowerCase(),
    args: parts.slice(1),
  };
}

function formatContent(value: unknown): string {
  if (typeof value === 'string') {
    return value;
  }
  try {
    return JSON.stringify(value);
  } catch {
    return '[unserializable]';
  }
}

function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function resolvePath(base: string, value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    return base;
  }
  return path.resolve(base, trimmed);
}

function approxTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

function nextMode(current: InputMode): InputMode {
  if (current === 'prompt') return 'plan';
  if (current === 'plan') return 'brainstorm';
  return 'prompt';
}

type FileMatch = {
  start: number;
  end: number;
  query: string;
  trigger: 'at' | 'tab';
};

function findEndByWord(value: string, cursor: number): number {
  let end = cursor;
  while (end < value.length && !/\s/.test(value[end] ?? '')) {
    end += 1;
  }
  return end;
}

function getAtFileMatch(value: string, cursor: number): FileMatch | null {
  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  const atPos = before.lastIndexOf('@');
  if (atPos < 0) {
    return null;
  }

  if (atPos > 0 && !/\s/.test(before[atPos - 1] ?? '')) {
    return null;
  }

  const afterAt = before.slice(atPos + 1);
  if (afterAt.includes('\n')) {
    return null;
  }

  const query = afterAt.replace(/^"/, '').replace(/"$/, '').replace(/\\ /g, ' ');
  return {
    start: atPos,
    end: findEndByWord(value, safeCursor),
    query,
    trigger: 'at',
  };
}

function getTabFileMatch(
  value: string,
  cursor: number,
  forceTabTrigger: boolean
): FileMatch | null {
  if (!forceTabTrigger) {
    return null;
  }

  const safeCursor = Math.max(0, Math.min(cursor, value.length));
  const before = value.slice(0, safeCursor);
  const wordMatch = before.match(/([^\s]+)$/);
  if (!wordMatch || !wordMatch[1]) {
    return null;
  }

  if (/@[^\s]*$/.test(before)) {
    return null;
  }

  const query = wordMatch[1];
  return {
    start: safeCursor - query.length,
    end: findEndByWord(value, safeCursor),
    query,
    trigger: 'tab',
  };
}

function HelpPanel({ binName }: { binName: string }) {
  return (
    <Box flexDirection="column" borderStyle="round" borderColor="gray" paddingX={1}>
      <Text color="gray">{binName} interactive mode (ink + neovate-style ui)</Text>
      <Text color="gray">
        /help /exit /quit /model /models /tool /tools /session /sessions /new /resume /history /log
        /approval
      </Text>
      <Text color="gray">
        /cwd /workspace /clear /stats /format /system /config /skill /panel /mode /debug /transcript
      </Text>
      <Text color="gray">
        快捷键: Enter发送, Up/Down历史, Tab建议, Shift+Tab切换模式, Ctrl+R反向搜索, Ctrl+O转录模式
      </Text>
    </Box>
  );
}

export function App(props: {
  runtime: CliRuntime;
  initialPrompt?: string;
  binName: string;
  baseCwd: string;
  config: PersistedCliConfig;
}) {
  const { exit } = useApp();
  const { runtime, initialPrompt, binName, baseCwd, config } = props;

  const [messages, setMessages] = useState<ChatLine[]>(() => [
    {
      id: createId(),
      seq: nextTimelineSeq(),
      role: 'system',
      text: `cwd=${runtime.state.cwd} | model=${runtime.state.modelId} | session=${runtime.state.sessionId}`,
    },
    {
      id: createId(),
      seq: nextTimelineSeq(),
      role: 'system',
      text: 'UI ready. Enter send | Shift+Tab mode | Ctrl+R reverse search | Ctrl+O transcript',
    },
  ]);
  const [activities, setActivities] = useState<ActivityEvent[]>([]);
  const [input, setInput] = useState('');
  const [inputCursor, setInputCursor] = useState(0);
  const [running, setRunning] = useState(false);
  const [status, setStatus] = useState<AppStatus>('idle');
  const [processingStartTime, setProcessingStartTime] = useState<number | null>(null);
  const [processingToolCalls, setProcessingToolCalls] = useState(0);
  const [totalTokens, setTotalTokens] = useState(0);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingConfirm | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [historyCursor, setHistoryCursor] = useState<number | null>(null);
  const [panelMode, setPanelMode] = useState<PanelMode>('split');
  const [tick, setTick] = useState(0);
  const [mode, setMode] = useState<InputMode>('prompt');
  const [queuedMessages, setQueuedMessages] = useState<string[]>([]);
  const [transcriptMode, setTranscriptMode] = useState(false);
  const [debugMode, setDebugMode] = useState(false);
  const [debugLogs, setDebugLogs] = useState<string[]>([]);
  const [forceTabTrigger, setForceTabTrigger] = useState(false);
  const [selectedSuggestionIndex, setSelectedSuggestionIndex] = useState(0);
  const [pathIndex, setPathIndex] = useState<string[]>([]);
  const [reverseSearchActive, setReverseSearchActive] = useState(false);
  const [reverseSearchQuery, setReverseSearchQuery] = useState('');
  const [reverseSearchIndex, setReverseSearchIndex] = useState(0);
  const booted = useRef(false);

  const confirmQueueRef = useRef<
    Array<{ request: ToolConfirmRequest; resolve: (d: ToolConfirmDecision) => void }>
  >([]);
  const pendingConfirmRef = useRef<{
    request: ToolConfirmRequest;
    resolve: (d: ToolConfirmDecision) => void;
  } | null>(null);

  const addDebug = useCallback((line: string) => {
    const stamped = `[${nowTime()}] ${line}`;
    setDebugLogs((prev) => [...prev, stamped].slice(-40));
  }, []);

  const addMessage = useCallback((role: ChatLine['role'], text: string) => {
    const seq = nextTimelineSeq();
    setMessages((prev) => [...prev, { id: createId(), seq, role, text }]);
  }, []);

  const addActivity = useCallback(
    (
      level: ActivityLevel,
      text: string,
      extra?: Partial<Pick<ActivityEvent, 'kind' | 'indent' | 'toolCallId'>>
    ) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      const seq = nextTimelineSeq();
      setActivities((prev) => {
        const next = [
          ...prev,
          {
            id: createId(),
            seq,
            level,
            text: normalized,
            time: nowTime(),
            kind: extra?.kind,
            indent: extra?.indent,
            toolCallId: extra?.toolCallId,
          },
        ];
        return next.slice(-120);
      });
    },
    []
  );

  const logSystem = useCallback(
    (text: string) => {
      for (const line of text.split('\n')) {
        addMessage('system', line);
      }
    },
    [addMessage]
  );

  const updateMessage = useCallback((id: string, updater: (current: string) => string) => {
    setMessages((prev) =>
      prev.map((item) =>
        item.id === id
          ? {
              ...item,
              text: updater(item.text),
            }
          : item
      )
    );
  }, []);

  const setInputWithHistory = useCallback(
    (direction: 'up' | 'down') => {
      if (history.length === 0) {
        return;
      }

      if (direction === 'up') {
        const nextIndex =
          historyCursor === null ? history.length - 1 : Math.max(historyCursor - 1, 0);
        const value = history[nextIndex] ?? '';
        setHistoryCursor(nextIndex);
        setInput(value);
        setInputCursor(value.length);
        return;
      }

      if (historyCursor === null) {
        return;
      }

      const nextIndex = historyCursor + 1;
      if (nextIndex >= history.length) {
        setHistoryCursor(null);
        setInput('');
        setInputCursor(0);
        return;
      }

      const value = history[nextIndex] ?? '';
      setHistoryCursor(nextIndex);
      setInput(value);
      setInputCursor(value.length);
    },
    [history, historyCursor]
  );

  const rotatePanelMode = useCallback(() => {
    setPanelMode((prev) => {
      if (prev === 'split') return 'conversation';
      if (prev === 'conversation') return 'activity';
      return 'split';
    });
  }, []);

  const pumpConfirmQueue = useCallback(() => {
    if (pendingConfirmRef.current) {
      return;
    }
    const next = confirmQueueRef.current.shift();
    if (!next) {
      return;
    }
    pendingConfirmRef.current = next;
    setPendingConfirm({ request: next.request });
  }, []);

  const resolvePendingConfirm = useCallback(
    (decision: ToolConfirmDecision) => {
      const current = pendingConfirmRef.current;
      if (!current) {
        return;
      }
      current.resolve(decision);
      pendingConfirmRef.current = null;
      setPendingConfirm(null);
      addActivity(
        'warn',
        `tool ${decision === 'approve' ? 'approved' : 'denied'}: ${current.request.toolName}`
      );
      pumpConfirmQueue();
    },
    [addActivity, pumpConfirmQueue]
  );

  const enqueueConfirmRequest = useCallback(
    (request: ToolConfirmRequest): Promise<ToolConfirmDecision> =>
      new Promise<ToolConfirmDecision>((resolve) => {
        confirmQueueRef.current.push({ request, resolve });
        addActivity('warn', `approval requested: ${request.toolName}`);
        pumpConfirmQueue();
      }),
    [addActivity, pumpConfirmQueue]
  );

  const executeWorkspaceSlash = useCallback(
    async (args: string[]) => {
      const action = args[0] ?? 'list';
      const entries = await loadWorkspaces(baseCwd);

      if (action === 'list') {
        if (entries.length === 0) {
          logSystem(`No workspace profiles. file=${getWorkspaceFilePath(baseCwd)}`);
          return;
        }
        logSystem(entries.map((item) => `${item.name}: ${item.cwd}`).join('\n'));
        return;
      }

      if (action === 'add') {
        const name = args[1];
        const cwdInput = args.slice(2).join(' ');
        const cwd = resolvePath(runtime.state.cwd, cwdInput || runtime.state.cwd);
        if (!name) {
          logSystem('Usage: /workspace add <name> [cwd]');
          return;
        }
        const now = new Date().toISOString();
        const existing = entries.find((item) => item.name === name);
        let nextEntries: WorkspaceProfile[];

        if (existing) {
          nextEntries = entries.map((item) =>
            item.name === name
              ? {
                  ...item,
                  cwd,
                  updatedAt: now,
                }
              : item
          );
        } else {
          nextEntries = [
            ...entries,
            {
              name,
              cwd,
              createdAt: now,
              updatedAt: now,
            },
          ];
        }

        await saveWorkspaces(baseCwd, nextEntries);
        logSystem(`workspace saved: ${name} -> ${cwd}`);
        addActivity('info', `workspace saved ${name}`);
        return;
      }

      if (action === 'use') {
        const name = args[1];
        if (!name) {
          logSystem('Usage: /workspace use <name>');
          return;
        }
        const selected = entries.find((item) => item.name === name);
        if (!selected) {
          logSystem(`workspace not found: ${name}`);
          return;
        }
        await runtime.setCwd(selected.cwd);
        config.defaultCwd = selected.cwd;
        await saveCliConfig(baseCwd, config);
        logSystem(`cwd switched to ${runtime.state.cwd}`);
        addActivity('info', `workspace use ${name}`);
        return;
      }

      if (action === 'remove') {
        const name = args[1];
        if (!name) {
          logSystem('Usage: /workspace remove <name>');
          return;
        }
        const nextEntries = entries.filter((item) => item.name !== name);
        await saveWorkspaces(baseCwd, nextEntries);
        logSystem(`workspace removed: ${name}`);
        addActivity('info', `workspace removed ${name}`);
        return;
      }

      logSystem(`unknown workspace action: ${action}`);
    },
    [addActivity, baseCwd, config, logSystem, runtime]
  );

  const executeConfigSlash = useCallback(
    async (args: string[]) => {
      const action = args[0] ?? 'show';
      if (action === 'show') {
        const rows = [
          `defaultModel=${config.defaultModel ?? '(unset)'}`,
          `defaultApprovalMode=${config.defaultApprovalMode ?? '(unset)'}`,
          `defaultSystemPrompt=${config.defaultSystemPrompt ?? '(unset)'}`,
          `defaultCwd=${config.defaultCwd ?? '(unset)'}`,
          `disabledTools=${config.disabledTools.length > 0 ? config.disabledTools.join(',') : '(none)'}`,
        ];
        logSystem(rows.join('\n'));
        return;
      }

      if (action === 'set') {
        const key = args[1];
        const value = args.slice(2).join(' ').trim();
        if (!key || !value) {
          logSystem('Usage: /config set <key> <value>');
          return;
        }

        if (key === 'model') {
          runtime.setModel(value);
          config.defaultModel = runtime.state.modelId;
        } else if (key === 'approvalMode') {
          if (value !== 'default' && value !== 'autoEdit' && value !== 'yolo') {
            logSystem(`invalid approvalMode: ${value}`);
            return;
          }
          config.defaultApprovalMode = value;
          runtime.setApprovalMode(value);
        } else if (key === 'cwd') {
          const resolved = resolvePath(runtime.state.cwd, value);
          config.defaultCwd = resolved;
          await runtime.setCwd(resolved);
        } else if (key === 'systemPrompt') {
          config.defaultSystemPrompt = value;
          runtime.setSystemPrompt(value);
        } else {
          logSystem(`unsupported config key: ${key}`);
          return;
        }

        await saveCliConfig(baseCwd, config);
        addActivity('info', `config set ${key}`);
        logSystem(`config updated: ${key}`);
        return;
      }

      if (action === 'unset') {
        const key = args[1];
        if (!key) {
          logSystem('Usage: /config unset <key>');
          return;
        }

        if (key === 'model') {
          delete config.defaultModel;
        } else if (key === 'approvalMode') {
          delete config.defaultApprovalMode;
        } else if (key === 'cwd') {
          delete config.defaultCwd;
        } else if (key === 'systemPrompt') {
          delete config.defaultSystemPrompt;
        } else {
          logSystem(`unsupported config key: ${key}`);
          return;
        }

        await saveCliConfig(baseCwd, config);
        addActivity('info', `config unset ${key}`);
        logSystem(`config key removed: ${key}`);
        return;
      }

      logSystem(`unknown config action: ${action}`);
    },
    [addActivity, baseCwd, config, logSystem, runtime]
  );

  const executeSkillSlash = useCallback(
    async (args: string[]) => {
      const action = args[0] ?? 'list';
      await initializeSkillLoader();
      const loader = getSkillLoader();

      if (action === 'list') {
        const all = loader.getAllMetadata();
        if (all.length === 0) {
          logSystem('no skills found');
          return;
        }
        logSystem(all.map((item) => `${item.name}: ${item.description}`).join('\n'));
        return;
      }

      if (action === 'show') {
        const name = args[1];
        if (!name) {
          logSystem('Usage: /skill show <name>');
          return;
        }
        const skill = await loader.loadSkill(name);
        if (!skill) {
          logSystem(`skill not found: ${name}`);
          return;
        }
        logSystem(`# ${skill.metadata.name}\n${skill.content}`);
        return;
      }

      logSystem(`unknown skill action: ${action}`);
    },
    [logSystem]
  );
  const executeSlash = useCallback(
    async (raw: string) => {
      const { command, args } = parseSlash(raw);

      if (!command || command === 'help') {
        logSystem(
          'Commands: /help /exit /quit /model /models /tool /tools /session /sessions /new /resume /history /log /approval /cwd /workspace /clear /stats /format /system /config /skill /panel /mode /debug /transcript'
        );
        return;
      }

      if (command === 'exit' || command === 'quit') {
        setStatus('exit');
        exit();
        return;
      }

      if (command === 'model') {
        if (args[0]) {
          runtime.setModel(args[0]);
          config.defaultModel = runtime.state.modelId;
          await saveCliConfig(baseCwd, config);
          addActivity('info', `model switched to ${runtime.state.modelId}`);
        }
        logSystem(`model=${runtime.state.modelId}`);
        return;
      }

      if (command === 'models') {
        logSystem(runtime.getModelIds().join(', '));
        return;
      }

      if (command === 'tool') {
        const [name, value] = args;
        if (!name || (value !== 'on' && value !== 'off')) {
          logSystem('Usage: /tool <name> <on|off>');
          return;
        }
        runtime.setToolEnabled(name, value === 'on');
        config.disabledTools = Array.from(runtime.state.disabledTools).sort();
        await saveCliConfig(baseCwd, config);
        addActivity('info', `tool ${name}=${value}`);
        logSystem(`tool ${name}=${value}`);
        return;
      }

      if (command === 'tools') {
        logSystem(`enabled tools: ${runtime.getEnabledToolNames().join(', ')}`);
        return;
      }

      if (command === 'session') {
        const action = args[0];
        if (action === 'clear') {
          await runtime.clearSessionContext(runtime.state.sessionId);
          addActivity('warn', `session cleared ${runtime.state.sessionId}`);
          logSystem(`cleared session=${runtime.state.sessionId}`);
          return;
        }

        if (args[0]) {
          runtime.setSession(args[0]);
          addActivity('info', `session switched to ${runtime.state.sessionId}`);
        }
        logSystem(`session=${runtime.state.sessionId}`);
        return;
      }

      if (command === 'sessions') {
        const sessions = runtime.listSessions(20);
        if (sessions.length === 0) {
          logSystem('no sessions');
          return;
        }
        logSystem(
          sessions
            .map((item) => `${item.sessionId} (${item.status}, messages=${item.totalMessages})`)
            .join('\n')
        );
        return;
      }

      if (command === 'new') {
        const sessionId = runtime.newSession(args[0]);
        addActivity('info', `new session ${sessionId}`);
        logSystem(`new session=${sessionId}`);
        return;
      }

      if (command === 'resume') {
        if (!args[0]) {
          logSystem('Usage: /resume <session-id>');
          return;
        }
        runtime.setSession(args[0]);
        addActivity('info', `resumed session ${runtime.state.sessionId}`);
        logSystem(`resumed session=${runtime.state.sessionId}`);
        return;
      }

      if (command === 'history' || command === 'log') {
        const count = args[0] ? Number.parseInt(args[0], 10) : 20;
        const finalCount = Number.isFinite(count) ? Math.max(count, 1) : 20;
        const historyRows = runtime
          .getSessionHistory(runtime.state.sessionId)
          .slice(-finalCount)
          .map((item) => `[${item.sequence}] ${item.role}: ${formatContent(item.content)}`)
          .join('\n');
        logSystem(historyRows || '(empty history)');
        return;
      }

      if (command === 'approval') {
        const nextMode = args[0];
        if (
          !nextMode ||
          (nextMode !== 'default' && nextMode !== 'autoEdit' && nextMode !== 'yolo')
        ) {
          logSystem('Usage: /approval <default|autoEdit|yolo>');
          return;
        }
        runtime.setApprovalMode(nextMode);
        config.defaultApprovalMode = nextMode;
        await saveCliConfig(baseCwd, config);
        addActivity('warn', `approval mode=${nextMode}`);
        logSystem(`approval=${nextMode}`);
        return;
      }

      if (command === 'cwd') {
        if (!args[0]) {
          logSystem(`cwd=${runtime.state.cwd}`);
          return;
        }
        const next = resolvePath(runtime.state.cwd, args.join(' '));
        await runtime.setCwd(next);
        addActivity('info', `cwd switched to ${runtime.state.cwd}`);
        logSystem(`cwd=${runtime.state.cwd}`);
        return;
      }

      if (command === 'workspace') {
        await executeWorkspaceSlash(args);
        return;
      }

      if (command === 'clear') {
        await runtime.clearSessionContext(runtime.state.sessionId);
        addActivity('warn', `session cleared ${runtime.state.sessionId}`);
        setMessages((prev) => prev.slice(-2));
        setActivities([]);
        logSystem(`cleared session=${runtime.state.sessionId}`);
        return;
      }

      if (command === 'stats') {
        const summary = runtime.getRuntimeSummary();
        const historyCount = runtime.getSessionHistory(runtime.state.sessionId).length;
        logSystem(
          `${Object.entries(summary)
            .map(([k, v]) => `${k}=${v}`)
            .join(
              '\n'
            )}\nhistoryCount=${historyCount}\npanelMode=${panelMode}\nqueued=${queuedMessages.length}`
        );
        return;
      }

      if (command === 'format') {
        const next = args[0];
        if (!next || (next !== 'text' && next !== 'json' && next !== 'stream-json')) {
          logSystem('Usage: /format <text|json|stream-json>');
          return;
        }
        runtime.setOutputFormat(next);
        logSystem(`outputFormat=${runtime.state.outputFormat}`);
        return;
      }

      if (command === 'system') {
        const text = args.join(' ').trim();
        if (!text) {
          logSystem(runtime.state.systemPrompt);
          return;
        }
        runtime.setSystemPrompt(text);
        logSystem('system prompt updated in runtime');
        return;
      }

      if (command === 'config') {
        await executeConfigSlash(args);
        return;
      }

      if (command === 'skill' || command === 'skills') {
        await executeSkillSlash(args);
        return;
      }

      if (command === 'panel') {
        const modeArg = args[0];
        if (
          !modeArg ||
          (modeArg !== 'split' && modeArg !== 'conversation' && modeArg !== 'activity')
        ) {
          logSystem('Usage: /panel <split|conversation|activity>');
          return;
        }
        setPanelMode(modeArg);
        addActivity('info', `panel mode=${modeArg}`);
        logSystem(`panelMode=${modeArg}`);
        return;
      }

      if (command === 'mode') {
        const modeArg = args[0];
        if (!modeArg || (modeArg !== 'prompt' && modeArg !== 'plan' && modeArg !== 'brainstorm')) {
          logSystem('Usage: /mode <prompt|plan|brainstorm>');
          return;
        }
        setMode(modeArg);
        addActivity('info', `mode=${modeArg}`);
        logSystem(`mode=${modeArg}`);
        return;
      }

      if (command === 'debug') {
        const value = args[0] ?? 'toggle';
        const enabled = value === 'on' ? true : value === 'off' ? false : !debugMode;
        setDebugMode(enabled);
        logSystem(`debug=${enabled ? 'on' : 'off'}`);
        return;
      }

      if (command === 'transcript') {
        const value = args[0] ?? 'toggle';
        const enabled = value === 'on' ? true : value === 'off' ? false : !transcriptMode;
        setTranscriptMode(enabled);
        logSystem(`transcript=${enabled ? 'on' : 'off'}`);
        return;
      }

      logSystem(`unknown slash command: /${command}`);
    },
    [
      addActivity,
      baseCwd,
      config,
      debugMode,
      executeConfigSlash,
      executeSkillSlash,
      executeWorkspaceSlash,
      exit,
      logSystem,
      panelMode,
      queuedMessages.length,
      runtime,
      transcriptMode,
    ]
  );

  const runPrompt = useCallback(
    async (prompt: string) => {
      let assistantMessageId: string | null = null;
      setErrorText(null);

      addMessage('user', prompt);
      setRunning(true);
      setStatus('processing');
      setProcessingStartTime(Date.now());
      setProcessingToolCalls(0);

      const ensureAssistantMessage = (initialText = ''): string => {
        if (assistantMessageId) {
          return assistantMessageId;
        }
        const id = createId();
        const seq = nextTimelineSeq();
        assistantMessageId = id;
        setMessages((prev) => [...prev, { id, seq, role: 'assistant', text: initialText }]);
        return id;
      };

      try {
        const renderer = createInkRenderer({
          onTextDelta: ({ text }) => {
            if (!text) {
              return;
            }
            setTotalTokens((prev) => prev + approxTokens(text));
            if (!assistantMessageId) {
              ensureAssistantMessage(text);
              return;
            }
            const id = ensureAssistantMessage();
            updateMessage(id, (current) => `${current}${text}`);
          },
          onToolEvent: (event: ToolStreamEvent) => {
            if (event.type === 'start') {
              setProcessingToolCalls((prev) => prev + 1);
              addActivity('tool', formatToolCallLine(event), {
                kind: 'tool_call',
                indent: 0,
                toolCallId: event.toolCallId,
              });
              return;
            }

            if ((event.type === 'stdout' || event.type === 'stderr') && event.content) {
              const chunk = formatToolOutputLines(event.content, transcriptMode, 3);
              const level: ActivityLevel = event.type === 'stderr' ? 'error' : 'tool';
              for (const line of chunk.lines) {
                addActivity(level, line, {
                  kind: 'tool_output',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              if (chunk.hiddenLineCount > 0) {
                addActivity('tool', `... +${chunk.hiddenLineCount} lines (ctrl+o to expand)`, {
                  kind: 'tool_output',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              return;
            }

            if (event.type === 'error') {
              const line = extractToolErrorLine(event);
              if (line) {
                addActivity('error', line, {
                  kind: 'tool_output',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              return;
            }

            if (event.type === 'end') {
              const endSummary = formatToolEndLines(event, transcriptMode);
              for (const line of endSummary.lines) {
                addActivity('tool', line, {
                  kind: 'tool_output',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              if (endSummary.hiddenLineCount > 0) {
                addActivity('tool', `... +${endSummary.hiddenLineCount} lines (ctrl+o to expand)`, {
                  kind: 'tool_output',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              return;
            }

            addActivity('tool', formatGenericToolEventLine(event), {
              kind: 'tool_output',
              indent: 1,
              toolCallId: event.toolCallId,
            });
          },
          onResult: (result) => {
            const resultText = result.text?.trim() ?? '';
            if (!assistantMessageId && resultText.length === 0) {
              return;
            }
            const hadAssistantMessage = assistantMessageId !== null;
            const id = ensureAssistantMessage(resultText);
            if (!hadAssistantMessage) {
              return;
            }
            updateMessage(id, (current) => (current.trim().length > 0 ? current : resultText));
          },
        });

        await runtime.runPrompt(prompt, renderer, undefined, enqueueConfirmRequest);
        setStatus('idle');
      } catch (error) {
        const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
        const hadAssistantMessage = assistantMessageId !== null;
        const id = ensureAssistantMessage(`[ERROR] ${message}`);
        if (!hadAssistantMessage) {
          addActivity('error', message);
          setErrorText(message);
          setStatus('failed');
          return;
        }
        updateMessage(id, () => `[ERROR] ${message}`);
        addActivity('error', message);
        setErrorText(message);
        setStatus('failed');
      } finally {
        setRunning(false);
        setProcessingStartTime(null);
      }
    },
    [addActivity, addMessage, enqueueConfirmRequest, runtime, transcriptMode, updateMessage]
  );
  const effectiveMode = useMemo<InputMode>(() => {
    if (input.startsWith('!')) return 'bash';
    if (input.startsWith('#')) return 'memory';
    return mode;
  }, [input, mode]);

  const slashMatches = useMemo(() => matchSlashCommands(input), [input]);
  const atMatch = useMemo(() => getAtFileMatch(input, inputCursor), [input, inputCursor]);
  const tabMatch = useMemo(
    () => getTabFileMatch(input, inputCursor, forceTabTrigger),
    [input, inputCursor, forceTabTrigger]
  );
  const activeFileMatch = atMatch ?? tabMatch;

  const fileSuggestions = useMemo(() => {
    if (!activeFileMatch) {
      return [] as SuggestionItem[];
    }
    return searchPathIndex(pathIndex, activeFileMatch.query, 30).map((item) => ({
      type: 'file' as const,
      value: item,
      title: item,
      description: 'path',
    }));
  }, [activeFileMatch, pathIndex]);

  const slashSuggestions = useMemo(
    () =>
      slashMatches.map((item) => ({
        type: 'slash' as const,
        value: item.command,
        title: `/${item.command}`,
        description: item.description,
      })),
    [slashMatches]
  );

  const suggestions = useMemo(() => {
    if (reverseSearchActive) {
      return [] as SuggestionItem[];
    }
    if (slashSuggestions.length > 0) {
      return slashSuggestions;
    }
    return fileSuggestions;
  }, [fileSuggestions, reverseSearchActive, slashSuggestions]);

  useEffect(() => {
    setSelectedSuggestionIndex(0);
  }, [suggestions.length]);

  const reverseSearchMatches = useMemo(() => {
    const base = [...history].reverse();
    const q = reverseSearchQuery.trim().toLowerCase();
    if (!q) {
      return base;
    }
    return base.filter((item) => item.toLowerCase().includes(q));
  }, [history, reverseSearchQuery]);

  useEffect(() => {
    if (reverseSearchIndex >= reverseSearchMatches.length) {
      setReverseSearchIndex(0);
    }
  }, [reverseSearchIndex, reverseSearchMatches.length]);

  const reverseSearchCurrentMatch = reverseSearchMatches[reverseSearchIndex] ?? '';

  const applySuggestion = useCallback(() => {
    const target = suggestions[selectedSuggestionIndex];
    if (!target) {
      return;
    }

    if (target.type === 'slash') {
      const next = `/${target.value} `;
      setInput(next);
      setInputCursor(next.length);
      return;
    }

    const file = target.value.includes(' ') ? `"${target.value}"` : target.value;

    if (activeFileMatch) {
      const before = input.slice(0, activeFileMatch.start);
      const after = input.slice(activeFileMatch.end);
      const insert = activeFileMatch.trigger === 'at' ? `@${file}` : file;
      const spacer = after.startsWith(' ') || after.length === 0 ? '' : ' ';
      const next = `${before}${insert}${spacer}${after}`;
      const nextCursor = before.length + insert.length;
      setInput(next);
      setInputCursor(nextCursor);
    } else {
      const next = `${input}${file}`;
      setInput(next);
      setInputCursor(next.length);
    }

    setForceTabTrigger(false);
  }, [activeFileMatch, input, selectedSuggestionIndex, suggestions]);

  const submitInput = useCallback(
    async (value: string) => {
      const raw = value;
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      if (running || pendingConfirmRef.current) {
        setQueuedMessages((prev) => [...prev, trimmed].slice(-20));
        addActivity('warn', `queued message (${trimmed.slice(0, 30)})`);
        return;
      }

      if (history[history.length - 1] !== trimmed) {
        setHistory((prev) => [...prev, trimmed].slice(-160));
      }
      setHistoryCursor(null);

      let finalInput = trimmed;
      if (effectiveMode === 'bash' && !finalInput.startsWith('!')) {
        finalInput = `!${finalInput}`;
      }

      if (effectiveMode === 'memory') {
        logSystem(`memory saved (runtime not implemented): ${finalInput.replace(/^#/, '').trim()}`);
        addActivity('info', 'memory note saved locally');
        return;
      }

      if (effectiveMode === 'plan' && !finalInput.startsWith('/')) {
        finalInput = `请先给出实施计划，不要执行修改：\n${finalInput}`;
      }

      if (effectiveMode === 'brainstorm' && !finalInput.startsWith('/')) {
        finalInput = `请先头脑风暴多种方案，再给建议：\n${finalInput}`;
      }

      if (finalInput.startsWith('/')) {
        await executeSlash(finalInput);
        return;
      }

      await runPrompt(finalInput);
    },
    [addActivity, effectiveMode, executeSlash, history, logSystem, runPrompt, running]
  );

  useEffect(() => {
    if (running || pendingConfirmRef.current || queuedMessages.length === 0) {
      return;
    }

    const [next, ...rest] = queuedMessages;
    if (!next) {
      return;
    }

    setQueuedMessages(rest);
    void submitInput(next);
  }, [queuedMessages, running, submitInput]);

  useEffect(() => {
    let canceled = false;
    void (async () => {
      const items = await buildPathIndex(runtime.state.cwd);
      if (!canceled) {
        setPathIndex(items);
        addDebug(`path index built (${items.length})`);
      }
    })();

    return () => {
      canceled = true;
    };
  }, [addDebug, runtime.state.cwd]);

  useEffect(() => {
    if (!running) {
      return;
    }
    const timer = setInterval(() => {
      setTick((prev) => (prev + 1) % 4);
    }, 160);
    return () => clearInterval(timer);
  }, [running]);

  useEffect(() => {
    return () => {
      if (pendingConfirmRef.current) {
        pendingConfirmRef.current.resolve('deny');
      }
      for (const item of confirmQueueRef.current) {
        item.resolve('deny');
      }
      confirmQueueRef.current = [];
      pendingConfirmRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (booted.current) {
      return;
    }
    booted.current = true;
    const prompt = initialPrompt?.trim();
    if (prompt) {
      void submitInput(prompt);
    }
  }, [initialPrompt, submitInput]);

  useInput((value, key) => {
    if (pendingConfirmRef.current) {
      if (value.toLowerCase() === 'y') {
        resolvePendingConfirm('approve');
        return;
      }
      if (value.toLowerCase() === 'n' || key.return) {
        resolvePendingConfirm('deny');
        return;
      }
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'c') {
      setStatus('exit');
      exit();
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'o') {
      setTranscriptMode((prev) => !prev);
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'l') {
      setMessages((prev) => prev.slice(-2));
      setActivities([]);
      addActivity('info', 'screen data cleared');
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'g') {
      setDebugMode((prev) => !prev);
      return;
    }

    if (key.shift && key.tab) {
      setMode((prev) => nextMode(prev));
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'r') {
      if (reverseSearchActive) {
        if (reverseSearchMatches.length > 0) {
          setReverseSearchIndex((prev) => Math.min(prev + 1, reverseSearchMatches.length - 1));
        }
      } else {
        setReverseSearchActive(true);
        setReverseSearchQuery('');
        setReverseSearchIndex(0);
      }
      return;
    }

    if (key.ctrl && value.toLowerCase() === 's') {
      if (reverseSearchActive) {
        setReverseSearchIndex((prev) => Math.max(prev - 1, 0));
      }
      return;
    }

    if (reverseSearchActive) {
      if (key.escape) {
        setReverseSearchActive(false);
        return;
      }

      if (key.return || key.tab) {
        const chosen = reverseSearchCurrentMatch;
        setReverseSearchActive(false);
        if (chosen) {
          setInput(chosen);
          setInputCursor(chosen.length);
        }
        return;
      }

      if (key.upArrow) {
        if (reverseSearchMatches.length > 0) {
          setReverseSearchIndex((prev) => Math.min(prev + 1, reverseSearchMatches.length - 1));
        }
        return;
      }

      if (key.downArrow) {
        setReverseSearchIndex((prev) => Math.max(prev - 1, 0));
        return;
      }

      if (key.backspace || key.delete || (key.ctrl && value.toLowerCase() === 'h')) {
        setReverseSearchQuery((prev) => prev.slice(0, -1));
        setReverseSearchIndex(0);
        return;
      }

      if (value && !key.ctrl && !key.meta) {
        setReverseSearchQuery((prev) => prev + value);
        setReverseSearchIndex(0);
      }
      return;
    }

    if (key.tab) {
      if (suggestions.length > 0) {
        applySuggestion();
        return;
      }
      if (input.trim() && !input.startsWith('/')) {
        setForceTabTrigger(true);
        addDebug('tab suggestion triggered');
        return;
      }
      rotatePanelMode();
      return;
    }

    if (key.upArrow) {
      if (suggestions.length > 0) {
        setSelectedSuggestionIndex((prev) => Math.max(prev - 1, 0));
        return;
      }
      setInputWithHistory('up');
      return;
    }

    if (key.downArrow) {
      if (suggestions.length > 0) {
        setSelectedSuggestionIndex((prev) => Math.min(prev + 1, suggestions.length - 1));
        return;
      }
      setInputWithHistory('down');
      return;
    }

    if (key.escape) {
      if ((effectiveMode === 'bash' || effectiveMode === 'memory') && input.length === 1) {
        setInput('');
        setInputCursor(0);
        return;
      }
      setInput('');
      setInputCursor(0);
      setHistoryCursor(null);
      setForceTabTrigger(false);
      return;
    }
    if (key.return) {
      const slashSuggesting = input.startsWith('/') && !input.slice(1).includes(' ');
      if (slashSuggesting && suggestions.length > 0) {
        const target = suggestions[selectedSuggestionIndex];
        if (target?.type === 'slash') {
          const next = `/${target.value} `;
          setInput(next);
          setInputCursor(next.length);
          setForceTabTrigger(false);
          return;
        }
      }

      if (suggestions.length > 0) {
        const target = suggestions[selectedSuggestionIndex];
        if (target?.type === 'file') {
          applySuggestion();
          return;
        }
      }

      const content = input;
      setInput('');
      setInputCursor(0);
      setForceTabTrigger(false);
      void submitInput(content);
      return;
    }

    if (key.leftArrow) {
      setInputCursor((prev) => Math.max(prev - 1, 0));
      return;
    }

    if (key.rightArrow) {
      setInputCursor((prev) => Math.min(prev + 1, input.length));
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'a') {
      setInputCursor(0);
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'e') {
      setInputCursor(input.length);
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'u') {
      setInput((prev) => prev.slice(inputCursor));
      setInputCursor(0);
      setForceTabTrigger(false);
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'k') {
      setInput((prev) => prev.slice(0, inputCursor));
      setForceTabTrigger(false);
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'w') {
      const left = input.slice(0, inputCursor);
      const right = input.slice(inputCursor);
      const trimmedLeft = left.replace(/\s+$/, '');
      const cut = trimmedLeft.lastIndexOf(' ');
      const nextLeft = cut >= 0 ? trimmedLeft.slice(0, cut + 1) : '';
      const next = nextLeft + right;
      setInput(next);
      setInputCursor(nextLeft.length);
      setForceTabTrigger(false);
      return;
    }

    // Cross-platform fallback:
    // some terminals report Backspace as `delete` or raw control chars.
    const isBackspaceKey =
      key.backspace ||
      value === '\b' ||
      value === '\x7f' ||
      (key.ctrl && value.toLowerCase() === 'h') ||
      (key.delete && inputCursor > 0 && inputCursor === input.length);

    const isForwardDeleteKey = key.delete && !isBackspaceKey;

    if (isBackspaceKey) {
      if (inputCursor <= 0) {
        return;
      }
      const next = input.slice(0, inputCursor - 1) + input.slice(inputCursor);
      setInput(next);
      setInputCursor((prev) => Math.max(prev - 1, 0));
      setForceTabTrigger(false);
      return;
    }

    if (isForwardDeleteKey) {
      if (inputCursor >= input.length) {
        return;
      }
      const next = input.slice(0, inputCursor) + input.slice(inputCursor + 1);
      setInput(next);
      setForceTabTrigger(false);
      return;
    }

    if (value && !key.ctrl && !key.meta) {
      const next = input.slice(0, inputCursor) + value + input.slice(inputCursor);
      setInput(next);
      setInputCursor((prev) => prev + value.length);
      setForceTabTrigger(false);
    }
  });

  const spinner = ['|', '/', '-', '\\'][tick];
  const visibleMessages = useMemo(
    () => messages.slice(transcriptMode ? -120 : -48),
    [messages, transcriptMode]
  );
  const visibleActivities = useMemo(
    () => activities.slice(transcriptMode ? -120 : -48),
    [activities, transcriptMode]
  );
  const historyCount = runtime.getSessionHistory(runtime.state.sessionId).length;

  return (
    <Box flexDirection="column">
      <HelpPanel binName={binName} />
      <TranscriptModeIndicator transcriptMode={transcriptMode} />

      <StatusLine
        running={running}
        approvalPending={pendingConfirm !== null}
        spinner={spinner}
        modelId={runtime.state.modelId}
        sessionId={runtime.state.sessionId}
        cwd={runtime.state.cwd}
        approvalMode={runtime.state.approvalMode}
        panelMode={panelMode}
        outputFormat={runtime.state.outputFormat}
        historyCount={historyCount}
        messageCount={messages.length}
        activityCount={activities.length}
      />

      <Messages
        messages={visibleMessages}
        activities={visibleActivities}
        panelMode={panelMode}
        transcriptMode={transcriptMode}
      />

      <ActivityIndicator
        status={status}
        error={errorText}
        running={running}
        spinner={spinner}
        hasMessages={messages.length > 0}
        processingStartTime={processingStartTime}
        processingToolCalls={processingToolCalls}
        totalTokens={totalTokens}
      />

      <QueueDisplay queuedMessages={queuedMessages} />

      <ChatInput
        input={input}
        inputCursor={inputCursor}
        running={running}
        mode={effectiveMode}
        suggestions={suggestions}
        selectedSuggestionIndex={selectedSuggestionIndex}
        reverseSearchActive={reverseSearchActive}
        reverseSearchQuery={reverseSearchQuery}
        reverseSearchCurrentMatch={reverseSearchCurrentMatch}
        reverseSearchIndex={reverseSearchIndex}
        reverseSearchTotalMatches={reverseSearchMatches.length}
      />

      <Debug enabled={debugMode} logs={debugLogs} />

      <ApprovalModal pendingConfirm={pendingConfirm} input={input} denyInputMode={false} />
    </Box>
  );
}
