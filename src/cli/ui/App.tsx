import path from 'node:path';
import { useCallback, useEffect } from 'react';
import { Box, useApp } from 'ink';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../../tool';
import type { HistoryMessage } from '../../storage';
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
import { MemoryModal } from './MemoryModal';
import { ExitHint } from './ExitHint';
import { ForkModal } from './ForkModal';
import { buildPathIndex } from './path-search';
import { mergeAssistantText, shouldStartNewAssistantMessage } from './assistant-text';
import {
  extractToolErrorLine,
  formatGenericToolEventLine,
  formatToolCallLine,
  formatToolEndLines,
  formatToolOutputLines,
  formatToolOutputTailLines,
  isSubagentBubbleEvent,
} from './tool-activity';
import type { ActivityLevel } from './types';
import { createId, nextTimelineSeq, nowTime, useCliStore } from './store';
import { useSessionViewModel } from './useSessionViewModel';
import { useInputHandlers } from './useInputHandlers';

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

export function App(props: {
  runtime: CliRuntime;
  initialPrompt?: string;
  binName: string;
  baseCwd: string;
  config: PersistedCliConfig;
}) {
  const { exit } = useApp();
  const { runtime, initialPrompt, baseCwd, config } = props;
  const {
    messages,
    setMessages,
    activities,
    setActivities,
    input,
    setInput,
    inputCursor,
    setInputCursor,
    running,
    setRunning,
    status,
    setStatus,
    processingStartTime,
    setProcessingStartTime,
    processingToolCalls,
    setProcessingToolCalls,
    totalTokens,
    setTotalTokens,
    errorText,
    setErrorText,
    pendingConfirm,
    setPendingConfirm,
    confirmDecision,
    setConfirmDecision,
    pendingMemory,
    setPendingMemory,
    history,
    setHistory,
    historyCursor,
    setHistoryCursor,
    panelMode,
    setPanelMode,
    tick,
    setTick,
    mode,
    setMode,
    queuedMessages,
    setQueuedMessages,
    transcriptMode,
    setTranscriptMode,
    debugMode,
    setDebugMode,
    debugLogs,
    forceTabTrigger,
    setForceTabTrigger,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    pathIndex,
    setPathIndex,
    reverseSearchActive,
    setReverseSearchActive,
    reverseSearchQuery,
    setReverseSearchQuery,
    reverseSearchIndex,
    setReverseSearchIndex,
    exitRequested,
    setExitRequested,
    forkModalVisible,
    setForkModalVisible,
    booted,
    assistantLineByMessageIdRef,
    confirmQueueRef,
    pendingConfirmRef,
    addDebug,
    addMessage,
    addActivity,
    logSystem,
    updateMessage,
  } = useCliStore({
    cwd: runtime.state.cwd,
    modelId: runtime.state.modelId,
    sessionId: runtime.state.sessionId,
  });

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
    setConfirmDecision('approve');
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
      pumpConfirmQueue();
    },
    [pumpConfirmQueue]
  );

  const resolvePendingMemory = useCallback(
    async (destination: 'project' | 'global' | null) => {
      const current = pendingMemory;
      setPendingMemory(null);
      if (!current || !destination) {
        return;
      }

      try {
        addMessage('user', `# ${current.rule}`);
        const result = await runtime.saveMemoryRule(current.rule, destination);
        if (result.duplicate) {
          addActivity('warn', `memory already exists in ${result.filePath}`);
          return;
        }
        addActivity('info', `saved memory to ${result.filePath}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        setStatus('failed');
        setErrorText(message);
        addActivity('error', `memory save failed: ${message}`);
      }
    },
    [addActivity, addMessage, pendingMemory, runtime]
  );

  const handleForkConfirm = useCallback(
    async (messageId: string) => {
      try {
        const nextSessionId = await runtime.forkSession(runtime.state.sessionId, messageId);
        setForkModalVisible(false);
        addActivity('info', `forked session ${nextSessionId}`);
        logSystem(`forked session=${nextSessionId}`);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        addActivity('error', `fork failed: ${message}`);
        setErrorText(message);
        setStatus('failed');
      }
    },
    [addActivity, logSystem, runtime, setErrorText, setForkModalVisible, setStatus]
  );

  const enqueueConfirmRequest = useCallback(
    (request: ToolConfirmRequest): Promise<ToolConfirmDecision> =>
      new Promise<ToolConfirmDecision>((resolve) => {
        confirmQueueRef.current.push({ request, resolve });
        pumpConfirmQueue();
      }),
    [pumpConfirmQueue]
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
          'Commands: /help /exit /quit /model /models /tool /tools /session /sessions /new /fork /resume /history /log /approval /cwd /workspace /clear /stats /format /system /config /skill /panel /mode /debug /transcript'
        );
        return;
      }

      if (command === 'exit' || command === 'quit') {
        setStatus('exit');
        setExitRequested(true);
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

      if (command === 'fork') {
        setForkModalVisible(true);
        logSystem('fork modal opened');
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
      const bufferedBashOutputByToolCallId = new Map<
        string,
        { content: string; hasStderr: boolean; activityId?: string }
      >();
      setErrorText(null);

      addMessage('user', prompt);
      setRunning(true);
      setStatus('processing');
      setProcessingStartTime(Date.now());
      setProcessingToolCalls(0);

      const ensureAssistantMessage = (initialText = '', messageId?: string): string => {
        if (messageId) {
          const mapped = assistantLineByMessageIdRef.current.get(messageId);
          if (mapped) {
            assistantMessageId = mapped;
            return mapped;
          }
        }

        if (assistantMessageId) {
          if (messageId) {
            assistantLineByMessageIdRef.current.set(messageId, assistantMessageId);
            setMessages((prev) =>
              prev.map((item) =>
                item.id === assistantMessageId && !item.sourceMessageId
                  ? {
                      ...item,
                      sourceMessageId: messageId,
                    }
                  : item
              )
            );
          }
          return assistantMessageId;
        }
        const id = messageId ?? createId();
        const seq = nextTimelineSeq();
        assistantMessageId = id;
        if (messageId) {
          assistantLineByMessageIdRef.current.set(messageId, id);
        }
        setMessages((prev) => [
          ...prev,
          {
            id,
            seq,
            role: 'assistant',
            text: initialText,
            sourceMessageId: messageId,
          },
        ]);
        return id;
      };

      const upsertBufferedBashOutputActivity = (
        toolCallId: string,
        level: ActivityLevel,
        text: string,
        phase: 'stream' | 'end' | 'error'
      ): void => {
        const buffered = bufferedBashOutputByToolCallId.get(toolCallId);
        const existingId = buffered?.activityId;

        if (existingId) {
          setActivities((prev) =>
            prev.map((item) =>
              item.id === existingId
                ? {
                    ...item,
                    level,
                    text,
                    phase,
                  }
                : item
            )
          );
          return;
        }

        const id = createId();
        const seq = nextTimelineSeq();
        bufferedBashOutputByToolCallId.set(toolCallId, {
          content: buffered?.content ?? '',
          hasStderr: buffered?.hasStderr ?? false,
          activityId: id,
        });
        setActivities((prev) =>
          [
            ...prev,
            {
              id,
              seq,
              level,
              text,
              time: nowTime(),
              kind: 'tool_output' as const,
              phase,
              indent: 1,
              toolCallId,
            },
          ].slice(-120)
        );
      };

      try {
        const renderer = createInkRenderer({
          onTextDelta: ({ text, messageId }) => {
            if (!text) {
              return;
            }
            setTotalTokens((prev) => prev + approxTokens(text));
            const id = ensureAssistantMessage('', messageId);
            updateMessage(id, (current) => `${current}${text}`);
          },
          onToolEvent: ({ event, messageId }) => {
            if (event.toolName === 'task' && isSubagentBubbleEvent(event)) {
              return;
            }
            if (messageId) {
              ensureAssistantMessage('', messageId);
            }
            if (event.type === 'start') {
              bufferedBashOutputByToolCallId.delete(event.toolCallId);
              setProcessingToolCalls((prev) => prev + 1);
              addActivity('tool', formatToolCallLine(event), {
                kind: 'tool_call',
                phase: 'start',
                indent: 0,
                toolCallId: event.toolCallId,
              });
              return;
            }

            if ((event.type === 'stdout' || event.type === 'stderr') && event.content) {
              if (event.toolName === 'bash') {
                const prev = bufferedBashOutputByToolCallId.get(event.toolCallId);
                const nextContent = `${prev?.content ?? ''}${event.content}`;
                const nextBuffered = {
                  content: nextContent,
                  hasStderr: (prev?.hasStderr ?? false) || event.type === 'stderr',
                  activityId: prev?.activityId,
                };
                bufferedBashOutputByToolCallId.set(event.toolCallId, nextBuffered);

                const chunk = formatToolOutputTailLines(nextContent, transcriptMode, 3);
                const lines = [...chunk.lines];
                if (chunk.hiddenLineCount > 0) {
                  lines.unshift(`… +${chunk.hiddenLineCount} lines (ctrl+o to expand)`);
                }
                if (lines.length > 0) {
                  upsertBufferedBashOutputActivity(
                    event.toolCallId,
                    nextBuffered.hasStderr ? 'error' : 'tool',
                    lines.join('\n'),
                    'stream'
                  );
                }
                return;
              }
              const chunk = formatToolOutputLines(event.content, transcriptMode, 3);
              const level: ActivityLevel = event.type === 'stderr' ? 'error' : 'tool';
              const outputLines = [...chunk.lines];
              if (chunk.hiddenLineCount > 0) {
                outputLines.push(`… +${chunk.hiddenLineCount} lines (ctrl+o to expand)`);
              }
              if (outputLines.length > 0) {
                addActivity(level, outputLines.join('\n'), {
                  kind: 'tool_output',
                  phase: 'stream',
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
                  phase: 'error',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              return;
            }

            if (event.type === 'end') {
              if (event.toolName === 'bash') {
                const buffered = bufferedBashOutputByToolCallId.get(event.toolCallId);
                if (buffered?.activityId) {
                  const chunk = formatToolOutputTailLines(buffered.content, transcriptMode, 3);
                  const lines = [...chunk.lines];
                  if (chunk.hiddenLineCount > 0) {
                    lines.unshift(`… +${chunk.hiddenLineCount} lines (ctrl+o to expand)`);
                  }
                  if (lines.length > 0) {
                    upsertBufferedBashOutputActivity(
                      event.toolCallId,
                      buffered.hasStderr ? 'error' : 'tool',
                      lines.join('\n'),
                      'end'
                    );
                  } else {
                    setActivities((prev) =>
                      prev.map((item) =>
                        item.id === buffered.activityId
                          ? {
                              ...item,
                              phase: 'end',
                            }
                          : item
                      )
                    );
                  }
                  bufferedBashOutputByToolCallId.delete(event.toolCallId);
                  return;
                }
              }
              const endSummary = formatToolEndLines(event, transcriptMode);
              const endLines = [...endSummary.lines];
              if (endSummary.hiddenLineCount > 0) {
                endLines.push(`… +${endSummary.hiddenLineCount} lines (ctrl+o to expand)`);
              }
              if (endLines.length > 0) {
                addActivity('tool', endLines.join('\n'), {
                  kind: 'tool_output',
                  phase: 'end',
                  indent: 1,
                  toolCallId: event.toolCallId,
                });
              }
              bufferedBashOutputByToolCallId.delete(event.toolCallId);
              return;
            }

            addActivity('tool', formatGenericToolEventLine(event), {
              kind: 'tool_output',
              phase: 'info',
              indent: 1,
              toolCallId: event.toolCallId,
            });
          },
          onStep: (step) => {
            if (step.messageId) {
              ensureAssistantMessage('', step.messageId);
            }
            if (shouldStartNewAssistantMessage(step)) {
              assistantMessageId = null;
            }
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
            updateMessage(id, (current) => mergeAssistantText(current, resultText));
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
  const {
    effectiveMode,
    activeFileMatch,
    suggestions,
    reverseSearchMatches,
    reverseSearchCurrentMatch,
  } = useSessionViewModel({
    input,
    inputCursor,
    mode,
    reverseSearchActive,
    reverseSearchQuery,
    reverseSearchIndex,
    history,
    forceTabTrigger,
    pathIndex,
    setSelectedSuggestionIndex,
    setReverseSearchIndex,
  });

  const currentSessionHistory = runtime.getSessionHistory(runtime.state.sessionId);

  const submitInput = useCallback(
    async (value: string) => {
      const raw = value;
      const trimmed = raw.trim();
      if (!trimmed) {
        return;
      }

      if (running || pendingConfirmRef.current || pendingMemory !== null) {
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
        const rule = finalInput.replace(/^#/, '').trim();
        if (!rule) {
          return;
        }
        setPendingMemory({
          rule,
          selection: 'project',
        });
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
    [addActivity, effectiveMode, executeSlash, history, pendingMemory, runPrompt, running]
  );

  useEffect(() => {
    if (
      running ||
      pendingConfirm !== null ||
      pendingMemory !== null ||
      forkModalVisible ||
      queuedMessages.length === 0
    ) {
      return;
    }

    const [next, ...rest] = queuedMessages;
    if (!next) {
      return;
    }

    setQueuedMessages(rest);
    void submitInput(next);
  }, [forkModalVisible, pendingConfirm, pendingMemory, queuedMessages, running, submitInput]);

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

  useEffect(() => {
    if (!exitRequested) {
      return;
    }
    const timer = setTimeout(() => {
      exit();
    }, 80);
    return () => clearTimeout(timer);
  }, [exit, exitRequested]);

  useInputHandlers({
    input,
    setInput,
    inputCursor,
    setInputCursor,
    effectiveMode,
    running,
    history,
    historyCursor,
    setHistory,
    setHistoryCursor,
    reverseSearchActive,
    setReverseSearchActive,
    reverseSearchMatches,
    reverseSearchCurrentMatch,
    reverseSearchQuery,
    setReverseSearchQuery,
    setReverseSearchIndex,
    pendingConfirmRef,
    confirmDecision,
    setConfirmDecision,
    resolvePendingConfirm,
    pendingMemory,
    setPendingMemory,
    resolvePendingMemory,
    suggestions,
    selectedSuggestionIndex,
    setSelectedSuggestionIndex,
    activeFileMatch,
    forceTabTrigger,
    setForceTabTrigger,
    submitInputImpl: submitInput,
    rotatePanelMode,
    addDebug,
    setMode,
    setTranscriptMode,
    setMessages,
    setActivities,
    addActivity,
    setDebugMode,
    setStatus,
    setExitRequested,
    setForkModalVisible,
    forkModalVisible,
  });

  const spinner = ['|', '/', '-', '\\'][tick];
  const historyCount = runtime.getSessionHistory(runtime.state.sessionId).length;

  return (
    <Box flexDirection="column">
      <TranscriptModeIndicator transcriptMode={transcriptMode} />

      <Messages
        messages={messages}
        activities={activities}
        panelMode={panelMode}
        transcriptMode={transcriptMode}
        running={running}
        maxTimelineItems={transcriptMode ? 240 : 96}
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

      {!forkModalVisible ? (
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
          queuedCount={queuedMessages.length}
        />
      ) : null}

      {!forkModalVisible ? (
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
          transcriptMode={transcriptMode}
          debugMode={debugMode}
        />
      ) : null}

      <Debug enabled={debugMode} logs={debugLogs} />

      <ExitHint
        status={status}
        cwd={runtime.state.cwd}
        modelId={runtime.state.modelId}
        sessionId={runtime.state.sessionId}
        totalTokens={totalTokens}
      />

      {forkModalVisible ? (
        <ForkModal
          history={currentSessionHistory as HistoryMessage[]}
          onClose={() => setForkModalVisible(false)}
          onConfirm={handleForkConfirm}
        />
      ) : null}

      <ApprovalModal pendingConfirm={pendingConfirm} selectedDecision={confirmDecision} />
      <MemoryModal pendingMemory={pendingMemory} />
    </Box>
  );
}
