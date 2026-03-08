import type { KeyEvent, TextareaRenderable } from "@opentui/core";
import { useCallback, useEffect, useMemo, useState, type RefObject } from "react";

import { filterSlashCommands, type SlashCommandDefinition } from "../commands/slash-commands";

type UseSlashCommandMenuParams = {
  value: string;
  onValueChange: (value: string) => void;
  textareaRef: RefObject<TextareaRenderable | null>;
  onCommandSelected?: (command: SlashCommandDefinition) => boolean;
  disabled?: boolean;
};

type UseSlashCommandMenuResult = {
  visible: boolean;
  options: SlashCommandDefinition[];
  selectedIndex: number;
  handleKeyDown: (event: KeyEvent) => boolean;
};

const getSlashQuery = (value: string): string | null => {
  if (!/^\/[^\s]*$/.test(value)) {
    return null;
  }
  return value.slice(1);
};

export const useSlashCommandMenu = ({
  value,
  onValueChange,
  textareaRef,
  onCommandSelected,
  disabled = false,
}: UseSlashCommandMenuParams): UseSlashCommandMenuResult => {
  const [selectedIndex, setSelectedIndex] = useState(0);
  const [dismissedQuery, setDismissedQuery] = useState<string | null>(null);

  const query = useMemo(() => getSlashQuery(value), [value]);

  useEffect(() => {
    if (query !== dismissedQuery) {
      return;
    }
    setDismissedQuery(null);
  }, [dismissedQuery, query]);

  const options = useMemo(() => {
    if (query === null) {
      return [];
    }
    return filterSlashCommands(query);
  }, [query]);

  const visible = !disabled && query !== null && query !== dismissedQuery && options.length > 0;

  useEffect(() => {
    setSelectedIndex(0);
  }, [query]);

  useEffect(() => {
    if (selectedIndex < options.length) {
      return;
    }
    setSelectedIndex(0);
  }, [options.length, selectedIndex]);

  const applySelection = useCallback(
    (index: number) => {
      const command = options[index];
      if (!command) {
        return false;
      }

      if (onCommandSelected?.(command)) {
        return true;
      }

      const nextValue = `/${command.name} `;
      onValueChange(nextValue);

      const textarea = textareaRef.current;
      if (textarea) {
        textarea.setText(nextValue);
        textarea.cursorOffset = nextValue.length;
      }

      return true;
    },
    [onCommandSelected, onValueChange, options, textareaRef],
  );

  const moveSelection = useCallback(
    (step: number) => {
      if (!visible || options.length === 0) {
        return;
      }
      setSelectedIndex((current) => {
        const total = options.length;
        const next = (current + step + total) % total;
        return next;
      });
    },
    [options.length, visible],
  );

  const handleKeyDown = useCallback(
    (event: KeyEvent): boolean => {
      if (!visible) {
        return false;
      }

      const name = (event.name ?? "").toLowerCase();
      const ctrlOnly = !!event.ctrl && !event.shift && !event.meta;
      const isUp = name === "up" || (ctrlOnly && name === "p");
      const isDown = name === "down" || (ctrlOnly && name === "n");

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

      if (name === "escape") {
        setDismissedQuery(query);
        event.preventDefault();
        return true;
      }

      if (name === "return" || name === "enter" || name === "tab") {
        const applied = applySelection(selectedIndex);
        if (applied) {
          event.preventDefault();
          return true;
        }
      }

      return false;
    },
    [applySelection, moveSelection, query, selectedIndex, visible],
  );

  return {
    visible,
    options,
    selectedIndex,
    handleKeyDown,
  };
};
