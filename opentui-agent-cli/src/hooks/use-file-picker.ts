import type { KeyEvent } from '@opentui/core';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { PromptFileSelection } from '../files/types';
import { listWorkspaceFiles } from '../files/workspace-files';

type UseFilePickerResult = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  search: string;
  options: PromptFileSelection[];
  selectedIndex: number;
  selectedPaths: Set<string>;
  open: (initialSelection?: PromptFileSelection[]) => void;
  close: () => void;
  setSearch: (value: string) => void;
  toggleSelectedIndex: () => void;
  setSelectedIndex: (value: number) => void;
  handleListKeyDown: (event: KeyEvent) => boolean;
  confirmSelected: () => PromptFileSelection[];
};

const normalize = (value: string) => value.trim().toLowerCase();

export const useFilePicker = (): UseFilePickerResult => {
  const [visible, setVisible] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [allOptions, setAllOptions] = useState<PromptFileSelection[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const requestIdRef = useRef(0);

  const options = useMemo(() => {
    const query = normalize(search);
    if (!query) {
      return allOptions;
    }
    return allOptions.filter(item => item.relativePath.toLowerCase().includes(query));
  }, [allOptions, search]);

  useEffect(() => {
    setSelectedIndex(0);
  }, [search]);

  useEffect(() => {
    if (selectedIndex < options.length) {
      return;
    }
    setSelectedIndex(0);
  }, [options.length, selectedIndex]);

  const close = useCallback(() => {
    requestIdRef.current += 1;
    setVisible(false);
    setLoading(false);
    setError(null);
    setSearch('');
    setSelectedIndex(0);
    setAllOptions([]);
    setSelectedPaths(new Set());
  }, []);

  const open = useCallback((initialSelection: PromptFileSelection[] = []) => {
    setVisible(true);
    setLoading(true);
    setError(null);
    setSearch('');
    setSelectedIndex(0);
    setAllOptions([]);
    setSelectedPaths(new Set(initialSelection.map(item => item.absolutePath)));
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
  }, []);

  const toggleSelectedIndex = useCallback(() => {
    const selected = options[selectedIndex];
    if (!selected) {
      return;
    }
    setSelectedPaths(current => {
      const next = new Set(current);
      if (next.has(selected.absolutePath)) {
        next.delete(selected.absolutePath);
      } else {
        next.add(selected.absolutePath);
      }
      return next;
    });
  }, [options, selectedIndex]);

  const confirmSelected = useCallback(() => {
    const result = allOptions.filter(item => selectedPaths.has(item.absolutePath));
    close();
    return result;
  }, [allOptions, close, selectedPaths]);

  const handleListKeyDown = useCallback(
    (event: KeyEvent): boolean => {
      if (!visible) {
        return false;
      }

      const name = (event.name ?? '').toLowerCase();
      const ctrlOnly = !!event.ctrl && !event.shift && !event.meta;
      const isUp = name === 'up' || (ctrlOnly && name === 'p');
      const isDown = name === 'down' || (ctrlOnly && name === 'n');

      if (isUp) {
        if (options.length > 0) {
          setSelectedIndex(current => (current - 1 + options.length) % options.length);
        }
        event.preventDefault();
        return true;
      }

      if (isDown) {
        if (options.length > 0) {
          setSelectedIndex(current => (current + 1) % options.length);
        }
        event.preventDefault();
        return true;
      }

      if (name === 'space') {
        toggleSelectedIndex();
        event.preventDefault();
        return true;
      }

      if (name === 'escape') {
        close();
        event.preventDefault();
        return true;
      }

      if (name === 'return' || name === 'enter') {
        event.preventDefault();
        return true;
      }

      return false;
    },
    [close, options.length, toggleSelectedIndex, visible]
  );

  return {
    visible,
    loading,
    error,
    search,
    options,
    selectedIndex,
    selectedPaths,
    open,
    close,
    setSearch,
    toggleSelectedIndex,
    setSelectedIndex,
    handleListKeyDown,
    confirmSelected,
  };
};
