import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from 'react';

import { findTrailingFileMention, removeTrailingFileMention } from '../files/file-mention-query';
import type { PromptFileSelection } from '../files/types';
import { listWorkspaceFiles } from '../files/workspace-files';

type UseFileMentionMenuParams = {
  value: string;
  textareaRef: RefObject<TextareaRenderable | null>;
  selectedFiles: PromptFileSelection[];
  onFilesSelected: (files: PromptFileSelection[]) => void;
  onValueChange: (value: string) => void;
  disabled?: boolean;
};

type UseFileMentionMenuResult = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  options: PromptFileSelection[];
  selectedIndex: number;
  handleKeyDown: (event: KeyEvent) => boolean;
};

const normalize = (value: string) => value.trim().toLowerCase();

export const useFileMentionMenu = ({
  value,
  textareaRef,
  selectedFiles,
  onFilesSelected,
  onValueChange,
  disabled = false,
}: UseFileMentionMenuParams): UseFileMentionMenuResult => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedToken, setDismissedToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [allOptions, setAllOptions] = useState<PromptFileSelection[]>([]);
  const hasLoadedRef = useRef(false);
  const requestIdRef = useRef(0);

  const mention = useMemo(() => findTrailingFileMention(value), [value]);

  useEffect(() => {
    if (!mention || mention.token !== dismissedToken) {
      return;
    }
    setDismissedToken(null);
  }, [dismissedToken, mention]);

  useEffect(() => {
    if (disabled || !mention || hasLoadedRef.current) {
      return;
    }

    hasLoadedRef.current = true;
    setLoading(true);
    setError(null);
    requestIdRef.current += 1;
    const requestId = requestIdRef.current;

    void listWorkspaceFiles()
      .then(files => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setAllOptions(files);
      })
      .catch(loadError => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setError(loadError instanceof Error ? loadError.message : String(loadError));
      })
      .finally(() => {
        if (requestId !== requestIdRef.current) {
          return;
        }
        setLoading(false);
      });
  }, [disabled, mention]);

  const options = useMemo(() => {
    if (!mention) {
      return [];
    }
    const selectedPaths = new Set(selectedFiles.map(file => file.absolutePath));
    const query = normalize(mention.query);
    return allOptions.filter(item => {
      if (selectedPaths.has(item.absolutePath)) {
        return false;
      }
      return query.length === 0 || item.relativePath.toLowerCase().includes(query);
    });
  }, [allOptions, mention, selectedFiles]);

  const visible = !disabled && !!mention && mention.token !== dismissedToken;

  useEffect(() => {
    setSelectedIndex(0);
  }, [mention?.token]);

  useEffect(() => {
    if (selectedIndex < options.length) {
      return;
    }
    setSelectedIndex(0);
  }, [options.length, selectedIndex]);

  const applySelection = useCallback(
    (index: number) => {
      const selected = options[index];
      if (!selected || !mention) {
        return false;
      }

      onFilesSelected([selected]);
      const nextValue = removeTrailingFileMention(value);
      onValueChange(nextValue);

      const textarea = textareaRef.current;
      if (textarea) {
        textarea.setText(nextValue);
        textarea.cursorOffset = nextValue.length;
      }
      return true;
    },
    [mention, onFilesSelected, onValueChange, options, textareaRef, value]
  );

  const moveSelection = useCallback(
    (step: number) => {
      if (!visible || options.length === 0) {
        return;
      }
      setSelectedIndex(current => (current + step + options.length) % options.length);
    },
    [options.length, visible]
  );

  const handleKeyDown = useCallback(
    (event: KeyEvent): boolean => {
      if (!visible) {
        return false;
      }

      const name = (event.name ?? '').toLowerCase();
      const ctrlOnly = !!event.ctrl && !event.shift && !event.meta;
      const isUp = name === 'up' || (ctrlOnly && name === 'p');
      const isDown = name === 'down' || (ctrlOnly && name === 'n');

      if (isUp) {
        moveSelection(-1);
        event.preventDefault();
        return true;
      }

      if (isDown) {
        moveSelection(1);
        event.preventDefault();
        return true;
      }

      if (name === 'escape') {
        setDismissedToken(mention?.token ?? null);
        event.preventDefault();
        return true;
      }

      if (name === 'return' || name === 'enter' || name === 'tab') {
        const applied = applySelection(selectedIndex);
        if (applied || options.length === 0) {
          event.preventDefault();
          return true;
        }
      }

      return false;
    },
    [applySelection, mention?.token, moveSelection, options.length, selectedIndex, visible]
  );

  return {
    visible,
    loading,
    error,
    options,
    selectedIndex,
    handleKeyDown,
  };
};
