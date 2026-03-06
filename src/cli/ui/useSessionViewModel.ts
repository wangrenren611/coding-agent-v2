import { useEffect, useMemo } from 'react';
import { matchSlashCommands } from './slash-commands';
import { searchPathIndex } from './path-search';
import type { InputMode, SuggestionItem } from './types';

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

export function useSessionViewModel(props: {
  input: string;
  inputCursor: number;
  mode: InputMode;
  reverseSearchActive: boolean;
  reverseSearchQuery: string;
  reverseSearchIndex: number;
  history: string[];
  forceTabTrigger: boolean;
  pathIndex: string[];
  setSelectedSuggestionIndex: (value: number) => void;
  setReverseSearchIndex: (value: number) => void;
}) {
  const {
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
  } = props;

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
  }, [setSelectedSuggestionIndex, suggestions]);

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
  }, [reverseSearchIndex, reverseSearchMatches.length, setReverseSearchIndex]);

  const reverseSearchCurrentMatch = reverseSearchMatches[reverseSearchIndex] ?? '';

  return {
    effectiveMode,
    activeFileMatch,
    fileSuggestions,
    slashSuggestions,
    suggestions,
    reverseSearchMatches,
    reverseSearchCurrentMatch,
  };
}
