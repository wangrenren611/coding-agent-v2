import type { KeyEvent, PasteEvent, TextareaRenderable } from '@opentui/core';
import { useCallback, useEffect, useMemo, useRef } from 'react';

import { FileMentionMenu } from './file-mention-menu';
import { FooterHints } from './footer-hints';
import { SlashCommandMenu } from './slash-command-menu';
import type { SlashCommandDefinition } from '../commands/slash-commands';
import {
  isAudioSelection,
  isImageSelection,
  isVideoSelection,
} from '../files/attachment-capabilities';
import type { PromptFileSelection } from '../files/types';
import { useFileMentionMenu } from '../hooks/use-file-mention-menu';
import { useSlashCommandMenu } from '../hooks/use-slash-command-menu';
import { uiTheme } from '../ui/theme';

type PromptProps = {
  isThinking: boolean;
  disabled?: boolean;
  modelLabel: string;
  contextUsagePercent: number | null;
  value: string;
  selectedFiles: PromptFileSelection[];
  onAddSelectedFiles: (files: PromptFileSelection[]) => void;
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
  selectedFiles,
  onAddSelectedFiles,
  onValueChange,
  onSlashCommandSelect,
  onSlashMenuVisibilityChange,
  onSubmit,
}: PromptProps) => {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const mediaFiles = useMemo(
    () =>
      selectedFiles.filter(
        file => isImageSelection(file) || isAudioSelection(file) || isVideoSelection(file)
      ),
    [selectedFiles]
  );
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
  const fileMentionMenu = useFileMentionMenu({
    value,
    textareaRef,
    selectedFiles,
    onFilesSelected: onAddSelectedFiles,
    onValueChange,
    disabled: inputLocked,
  });

  useEffect(() => {
    onSlashMenuVisibilityChange?.(slashMenu.visible || fileMentionMenu.visible);
  }, [fileMentionMenu.visible, onSlashMenuVisibilityChange, slashMenu.visible]);

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

      if (fileMentionMenu.handleKeyDown(event)) {
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
    [fileMentionMenu, inputLocked, slashMenu, submit]
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
        <FileMentionMenu
          visible={fileMentionMenu.visible}
          loading={fileMentionMenu.loading}
          error={fileMentionMenu.error}
          options={fileMentionMenu.options}
          selectedIndex={fileMentionMenu.selectedIndex}
        />
        <SlashCommandMenu
          visible={!fileMentionMenu.visible && slashMenu.visible}
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
            {mediaFiles.length > 0 ? (
              <box flexDirection="column" gap={0} paddingBottom={1}>
                <text fg={uiTheme.muted}>Media files</text>
                {mediaFiles.map(file => (
                  <text key={file.absolutePath} fg={uiTheme.accent} wrapMode="none">
                    {file.relativePath}
                  </text>
                ))}
              </box>
            ) : null}
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
