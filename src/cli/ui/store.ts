import { useCallback, useRef, useState } from 'react';
import type { ToolConfirmDecision, ToolConfirmRequest } from '../../tool';
import type {
  ActivityEvent,
  ActivityLevel,
  AppStatus,
  ChatLine,
  InputMode,
  PanelMode,
  PendingConfirm,
  PendingMemory,
} from './types';

export function createId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

let timelineSequence = 0;
export function nextTimelineSeq(): number {
  timelineSequence += 1;
  return timelineSequence;
}

export function nowTime(): string {
  return new Date().toLocaleTimeString('zh-CN', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function useCliStore(initial: { cwd: string; modelId: string; sessionId: string }) {
  const [messages, setMessages] = useState<ChatLine[]>(() => [
    {
      id: createId(),
      seq: nextTimelineSeq(),
      role: 'system',
      text: `cwd=${initial.cwd} | model=${initial.modelId} | session=${initial.sessionId}`,
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
  const [confirmDecision, setConfirmDecision] = useState<ToolConfirmDecision>('approve');
  const [pendingMemory, setPendingMemory] = useState<PendingMemory | null>(null);
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
  const [exitRequested, setExitRequested] = useState(false);
  const [forkModalVisible, setForkModalVisible] = useState(false);

  const booted = useRef(false);
  const assistantLineByMessageIdRef = useRef<Map<string, string>>(new Map());
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
      extra?: Partial<Pick<ActivityEvent, 'kind' | 'phase' | 'indent' | 'toolCallId'>>
    ) => {
      const normalized = text.trim();
      if (!normalized) {
        return;
      }
      const seq = nextTimelineSeq();
      setActivities((prev) =>
        [
          ...prev,
          {
            id: createId(),
            seq,
            level,
            text: normalized,
            time: nowTime(),
            kind: extra?.kind,
            phase: extra?.phase,
            indent: extra?.indent,
            toolCallId: extra?.toolCallId,
          },
        ].slice(-120)
      );
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

  return {
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
    setDebugLogs,
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
  };
}
