import type { KeyEvent, PasteEvent, TextareaRenderable } from "@opentui/core";
import { useCallback, useEffect, useRef } from "react";

import { FooterHints } from "./footer-hints";
import { SlashCommandMenu } from "./slash-command-menu";
import type { SlashCommandDefinition } from "../commands/slash-commands";
import { useSlashCommandMenu } from "../hooks/use-slash-command-menu";
import { uiTheme } from "../ui/theme";

type PromptProps = {
  isThinking: boolean;
  disabled?: boolean;
  modelLabel: string;
  contextUsagePercent: number | null;
  value: string;
  onValueChange: (value: string) => void;
  onSlashCommandSelect?: (command: SlashCommandDefinition) => boolean;
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
  onSubmit,
}: PromptProps) => {
  const textareaRef = useRef<TextareaRenderable | null>(null);
  const inputLocked = isThinking || disabled;
  const promptAlignPaddingX =
    uiTheme.layout.conversationPaddingX + uiTheme.layout.conversationContentPaddingX + uiTheme.layout.promptPaddingX;
  const slashMenu = useSlashCommandMenu({
    value,
    onValueChange,
    textareaRef,
    onCommandSelected: onSlashCommandSelect,
    disabled: inputLocked,
  });

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
    onValueChange(textareaRef.current?.plainText ?? "");
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

      const isEnter = event.name === "return" || event.name === "enter";
      if (isEnter && !event.shift) {
        event.preventDefault();
        submit();
      }
    },
    [inputLocked, slashMenu, submit],
  );

  const handlePaste = useCallback((event: PasteEvent) => {
    const normalized = event.text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
    if (normalized === event.text) {
      return;
    }

    event.preventDefault();
    textareaRef.current?.insertText(normalized);
  }, []);

  return (
    <box flexDirection="column" flexShrink={0} gap={0} paddingBottom={uiTheme.layout.promptPaddingBottom}>
      <box flexDirection="column" gap={0} paddingX={promptAlignPaddingX}>
        <SlashCommandMenu
          visible={slashMenu.visible}
          options={slashMenu.options}
          selectedIndex={slashMenu.selectedIndex}
        />
        <box flexDirection="row" backgroundColor={uiTheme.panel}>
          <box width={1} backgroundColor={uiTheme.accent} />
          <box flexGrow={1} paddingX={2} paddingTop={1} paddingBottom={0} backgroundColor={uiTheme.panel}>
            <textarea
              ref={textareaRef}
              width="100%"
              minHeight={1}
              maxHeight={4}
              initialValue={value}
              textColor={uiTheme.text}
              focusedTextColor={uiTheme.text}
              backgroundColor={uiTheme.panel}
              focusedBackgroundColor={uiTheme.panel}
              placeholder={
                isThinking
                  ? "waiting for agent response..."
                  : disabled
                    ? "command dialog active..."
                    : "Type your message..."
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
