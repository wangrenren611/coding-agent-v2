import type { KeyEvent, PasteEvent, TextareaRenderable } from '@opentui/core';
import { useCallback, useEffect, useRef } from 'react';

import { FooterHints } from './footer-hints';
import { SlashCommandMenu } from './slash-command-menu';
import type { SlashCommandDefinition } from '../commands/slash-commands';
import { useSlashCommandMenu } from '../hooks/use-slash-command-menu';
import { uiTheme } from '../ui/theme';

type PromptProps = {
  isThinking: boolean;
  disabled?: boolean;
  modelLabel: string;
  contextUsagePercent: number | null;
  value: string;
  onValueChange: (value: string) => void;
  onSlashCommandSelect?: (command: SlashCommandDefinition) => boolean;
  onSlashMenuVisibilityChange?: (visible: boolean) => void;
  onSubmit: () => void;
};

export const Prompt = ({
  isThinking,
  disabled = false,
  modelLabel,
  contextUsagePercent,
  value,
  onValueChange,
  onSlashCommandSelect,
  onSlashMenuVisibilityChange,
  onSubmit,
}: PromptProps) => {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const inputLocked = isThinking || disabled;
  const promptAlignPaddingX =
    uiTheme.layout.conversationPaddingX +
    uiTheme.layout.conversationContentPaddingX +
    uiTheme.layout.promptPaddingX;
  const slashMenu = useSlashCommandMenu({
    value,
    onValueChange,
    textareaRef,
    onCommandSelected: onSlashCommandSelect,
    disabled: inputLocked,
  });

  useEffect(() => {
    onSlashMenuVisibilityChange?.(slashMenu.visible);
  }, [onSlashMenuVisibilityChange, slashMenu.visible]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    if (textarea.plainText !== value) {
      textarea.setText(value);
      textarea.cursorOffset = value.length;
    }
  }, [value]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    if (inputLocked) {
      textarea.blur();
      return;
    }

    textarea.focus();
  }, [inputLocked]);

  const submit = useCallback(() => {
    if (inputLocked) {
      return;
    }
    onSubmit();
  }, [inputLocked, onSubmit]);

  const handleContentChange = useCallback(() => {
    onValueChange(textareaRef.current?.plainText ?? '');
  }, [onValueChange]);

  const handleKeyDown = useCallback(
    (event: KeyEvent) => {
      if (inputLocked) {
        event.preventDefault();
        return;
      }

      if (slashMenu.handleKeyDown(event)) {
        return;
      }

      const isEnter = event.name === 'return' || event.name === 'enter';
      if (isEnter && !event.shift) {
        event.preventDefault();
        submit();
      }
    },
    [inputLocked, slashMenu, submit]
  );

  const handlePaste = useCallback((event: PasteEvent) => {
    const normalized = event.text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    if (normalized === event.text) {
      return;
    }

    event.preventDefault();
    textareaRef.current?.insertText(normalized);
  }, []);

  return (
    <box
      flexDirection="column"
      flexShrink={0}
      width="100%"
      gap={0}
      paddingBottom={uiTheme.layout.promptPaddingBottom}
    >
      <box flexDirection="column" width="100%" gap={0} paddingX={promptAlignPaddingX}>
        <SlashCommandMenu
          visible={slashMenu.visible}
          options={slashMenu.options}
          selectedIndex={slashMenu.selectedIndex}
        />
        <box width="100%" flexDirection="row" overflow="hidden">
          <box width={1} backgroundColor={uiTheme.accent} />
          <box
            width="100%"
            flexGrow={1}
            paddingX={2}
            paddingTop={1}
            paddingBottom={0}
            backgroundColor={uiTheme.inputBg}
          >
            <textarea
              ref={textareaRef}
              buffered={false}
              width="100%"
              minWidth="100%"
              maxWidth="100%"
              minHeight={1}
              maxHeight={4}
              wrapMode="char"
              initialValue={value}
              textColor={uiTheme.userPromptText}
              focusedTextColor={uiTheme.userPromptText}
              backgroundColor="transparent"
              focusedBackgroundColor="transparent"
              cursorColor={uiTheme.inputCursor}
              selectionBg={uiTheme.inputSelectionBg}
              selectionFg={uiTheme.inputSelectionText}
              placeholder={
                isThinking
                  ? 'waiting for agent response...'
                  : disabled
                    ? 'command dialog active...'
                    : 'Type your message...'
              }
              placeholderColor={uiTheme.muted}
              onContentChange={handleContentChange}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
            />
            <box flexDirection="row" gap={1} paddingTop={1} paddingBottom={1}>
              <text fg={uiTheme.text} attributes={uiTheme.typography.heading}>
                {modelLabel}
              </text>
              <text fg={uiTheme.muted} attributes={uiTheme.typography.muted}>
                Coding Agent
              </text>
            </box>
          </box>
        </box>
      </box>
      <FooterHints isThinking={isThinking} contextUsagePercent={contextUsagePercent} />
    </box>
  );
};
