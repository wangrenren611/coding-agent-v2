import { useCallback, useEffect } from 'react';
import { useInput } from 'ink';
import type { ToolConfirmDecision } from '../../tool';
import type { ActivityEvent, ChatLine, InputMode, PendingMemory, SuggestionItem } from './types';

type FileMatch = {
  start: number;
  end: number;
  query: string;
  trigger: 'at' | 'tab';
};

export function useInputHandlers(props: {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  inputCursor: number;
  setInputCursor: (value: number | ((prev: number) => number)) => void;
  effectiveMode: InputMode;
  running: boolean;
  history: string[];
  historyCursor: number | null;
  setHistory: (value: string[] | ((prev: string[]) => string[])) => void;
  setHistoryCursor: (value: number | null | ((prev: number | null) => number | null)) => void;
  reverseSearchActive: boolean;
  setReverseSearchActive: (value: boolean) => void;
  reverseSearchMatches: string[];
  reverseSearchCurrentMatch: string;
  reverseSearchQuery: string;
  setReverseSearchQuery: (value: string | ((prev: string) => string)) => void;
  setReverseSearchIndex: (value: number | ((prev: number) => number)) => void;
  pendingConfirmRef: { current: { resolve: (d: ToolConfirmDecision) => void } | null };
  confirmDecision: ToolConfirmDecision;
  setConfirmDecision: (
    value: ToolConfirmDecision | ((prev: ToolConfirmDecision) => ToolConfirmDecision)
  ) => void;
  resolvePendingConfirm: (decision: ToolConfirmDecision) => void;
  pendingMemory: PendingMemory | null;
  setPendingMemory: (
    value: PendingMemory | null | ((prev: PendingMemory | null) => PendingMemory | null)
  ) => void;
  resolvePendingMemory: (destination: 'project' | 'global' | null) => Promise<void>;
  suggestions: SuggestionItem[];
  selectedSuggestionIndex: number;
  setSelectedSuggestionIndex: (value: number | ((prev: number) => number)) => void;
  activeFileMatch: FileMatch | null;
  forceTabTrigger: boolean;
  setForceTabTrigger: (value: boolean) => void;
  applySuggestion?: () => void;
  submitInputImpl: (value: string) => Promise<void>;
  rotatePanelMode: () => void;
  addDebug: (line: string) => void;
  setMode: (value: InputMode | ((prev: InputMode) => InputMode)) => void;
  setTranscriptMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setMessages: (value: ChatLine[] | ((prev: ChatLine[]) => ChatLine[])) => void;
  setActivities: (value: ActivityEvent[] | ((prev: ActivityEvent[]) => ActivityEvent[])) => void;
  addActivity: (level: 'info' | 'warn' | 'error' | 'tool', text: string) => void;
  setDebugMode: (value: boolean | ((prev: boolean) => boolean)) => void;
  setStatus: (value: 'idle' | 'processing' | 'failed' | 'exit') => void;
  setExitRequested: (value: boolean) => void;
  setForkModalVisible: (value: boolean) => void;
  forkModalVisible: boolean;
}) {
  const {
    input,
    setInput,
    inputCursor,
    setInputCursor,
    effectiveMode,
    running,
    history,
    historyCursor,
    setHistoryCursor,
    reverseSearchActive,
    setReverseSearchActive,
    reverseSearchMatches,
    reverseSearchCurrentMatch,
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
    setForceTabTrigger,
    submitInputImpl,
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
  } = props;

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
    [history, historyCursor, setHistoryCursor, setInput, setInputCursor]
  );

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
  }, [
    activeFileMatch,
    input,
    selectedSuggestionIndex,
    setForceTabTrigger,
    setInput,
    setInputCursor,
    suggestions,
  ]);

  useEffect(() => {
    if (reverseSearchMatches.length === 0) {
      setReverseSearchIndex(0);
      return;
    }
  }, [reverseSearchMatches.length, setReverseSearchIndex]);

  useInput((value, key) => {
    if (forkModalVisible) {
      return;
    }

    if (pendingMemory) {
      if (key.upArrow || key.leftArrow || key.downArrow || key.rightArrow) {
        setPendingMemory((prev) =>
          prev
            ? {
                ...prev,
                selection: prev.selection === 'project' ? 'global' : 'project',
              }
            : prev
        );
        return;
      }
      if (value === '1') {
        setPendingMemory((prev) => (prev ? { ...prev, selection: 'project' } : prev));
        return;
      }
      if (value === '2') {
        setPendingMemory((prev) => (prev ? { ...prev, selection: 'global' } : prev));
        return;
      }
      if (key.escape) {
        void resolvePendingMemory(null);
        return;
      }
      if (key.return) {
        void resolvePendingMemory(pendingMemory.selection);
        return;
      }
      return;
    }

    if (pendingConfirmRef.current) {
      if (key.upArrow || key.downArrow || key.leftArrow || key.rightArrow) {
        setConfirmDecision((prev) => (prev === 'approve' ? 'deny' : 'approve'));
        return;
      }
      if (value.toLowerCase() === 'y') {
        setConfirmDecision('approve');
        resolvePendingConfirm('approve');
        return;
      }
      if (value.toLowerCase() === 'n') {
        setConfirmDecision('deny');
        resolvePendingConfirm('deny');
        return;
      }
      if (key.escape) {
        setConfirmDecision('deny');
        resolvePendingConfirm('deny');
        return;
      }
      if (key.return) {
        resolvePendingConfirm(confirmDecision);
        return;
      }
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'c') {
      setStatus('exit');
      setExitRequested(true);
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

    if (key.ctrl && value.toLowerCase() === 'f') {
      setForkModalVisible(true);
      return;
    }

    if (key.shift && key.tab) {
      setMode((prev) => {
        if (prev === 'prompt') return 'plan';
        if (prev === 'plan') return 'brainstorm';
        return 'prompt';
      });
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
      void submitInputImpl(content);
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
      setInput((prev) => (prev as string).slice(inputCursor));
      setInputCursor(0);
      setForceTabTrigger(false);
      return;
    }

    if (key.ctrl && value.toLowerCase() === 'k') {
      setInput((prev) => (prev as string).slice(0, inputCursor));
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

    if (value && !key.ctrl && !key.meta && !running) {
      const next = input.slice(0, inputCursor) + value + input.slice(inputCursor);
      setInput(next);
      setInputCursor((prev) => prev + value.length);
      setForceTabTrigger(false);
    }
  });

  return {
    applySuggestion,
    submitInput: submitInputImpl,
  };
}
