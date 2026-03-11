import { TextAttributes, type Selection } from '@opentui/core';
import { useKeyboard, useRenderer, useTerminalDimensions } from '@opentui/react';
import { useEffect, useRef, useState } from 'react';

import { resolveSlashCommand, type SlashCommandDefinition } from './commands/slash-commands';
import { ConversationPanel } from './components/conversation-panel';
import { FilePickerDialog } from './components/file-picker-dialog';
import { ModelPickerDialog } from './components/model-picker-dialog';
import { Prompt } from './components/prompt';
import { ToolConfirmDialog } from './components/tool-confirm-dialog';
import { useAgentChat } from './hooks/use-agent-chat';
import { useFilePicker } from './hooks/use-file-picker';
import { useModelPicker } from './hooks/use-model-picker';
import { requestExit } from './runtime/exit';
import { copyTextToClipboard } from './runtime/clipboard';
import { uiTheme } from './ui/theme';

export const App = () => {
  const {
    turns,
    inputValue,
    isThinking,
    modelLabel,
    contextUsagePercent,
    pendingToolConfirm,
    setInputValue,
    selectedFiles,
    setSelectedFiles,
    appendSelectedFiles,
    removeSelectedFile,
    submitInput,
    stopActiveReply,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
    setToolConfirmSelection,
    submitToolConfirmSelection,
    rejectPendingToolConfirm,
  } = useAgentChat();
  const [slashMenuVisible, setSlashMenuVisible] = useState(false);
  const modelPicker = useModelPicker({
    onModelChanged: setModelLabelDisplay,
  });
  const filePicker = useFilePicker();
  const dimensions = useTerminalDimensions();
  const renderer = useRenderer();
  const [copyToastVisible, setCopyToastVisible] = useState(false);
  const selectionCopyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copyToastTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const handleSelection = (selection: Selection) => {
      const selectedText = selection.getSelectedText();
      if (!selectedText) {
        return;
      }

      if (selectionCopyTimeoutRef.current) {
        clearTimeout(selectionCopyTimeoutRef.current);
      }

      selectionCopyTimeoutRef.current = setTimeout(() => {
        void copyTextToClipboard(selectedText, renderer).then(success => {
          if (!success) {
            return;
          }

          setCopyToastVisible(true);
          if (copyToastTimeoutRef.current) {
            clearTimeout(copyToastTimeoutRef.current);
          }
          copyToastTimeoutRef.current = setTimeout(() => {
            setCopyToastVisible(false);
            copyToastTimeoutRef.current = null;
          }, 1500);
        });
        selectionCopyTimeoutRef.current = null;
      }, 80);
    };

    renderer.on('selection', handleSelection);

    return () => {
      renderer.off('selection', handleSelection);
      if (selectionCopyTimeoutRef.current) {
        clearTimeout(selectionCopyTimeoutRef.current);
        selectionCopyTimeoutRef.current = null;
      }
      if (copyToastTimeoutRef.current) {
        clearTimeout(copyToastTimeoutRef.current);
        copyToastTimeoutRef.current = null;
      }
    };
  }, [renderer]);

  const submitWithCommands = () => {
    const command = resolveSlashCommand(inputValue);
    if (command?.action === 'models') {
      setInputValue('');
      modelPicker.open();
      return;
    }
    if (command?.action === 'files') {
      setInputValue('');
      filePicker.open(selectedFiles);
      return;
    }

    submitInput();
  };

  const handleSlashCommandSelect = (command: SlashCommandDefinition) => {
    if (command.action === 'models') {
      setInputValue('');
      modelPicker.open();
      return true;
    }
    if (command.action === 'files') {
      setInputValue('');
      filePicker.open(selectedFiles);
      return true;
    }
    return false;
  };

  useKeyboard(key => {
    if (key.ctrl && key.name === 'c') {
      requestExit(0);
      return;
    }

    if (modelPicker.visible) {
      if (key.name === 'escape') {
        modelPicker.close();
      }
      return;
    }

    if (filePicker.visible) {
      if (key.name === 'escape') {
        filePicker.close();
      }
      return;
    }

    if (pendingToolConfirm) {
      if (key.name === 'left' || key.name === 'h') {
        setToolConfirmSelection('approve');
        return;
      }

      if (key.name === 'right' || key.name === 'l') {
        setToolConfirmSelection('deny');
        return;
      }

      if (key.name === 'return' || key.name === 'enter') {
        submitToolConfirmSelection();
        return;
      }

      if (key.name === 'escape') {
        rejectPendingToolConfirm();
      }
      return;
    }

    if (key.ctrl && key.name === 'l') {
      resetConversation();
      return;
    }

    if (key.name === 'escape') {
      if (slashMenuVisible) {
        return;
      }
      if (isThinking) {
        stopActiveReply();
        return;
      }
      clearInput();
    }
  });

  return (
    <box
      width={dimensions.width}
      height={dimensions.height}
      flexDirection="column"
      backgroundColor={uiTheme.bg}
      paddingTop={uiTheme.layout.appPaddingTop}
      paddingBottom={uiTheme.layout.appPaddingBottom}
      paddingLeft={uiTheme.layout.appPaddingX}
      paddingRight={uiTheme.layout.appPaddingX}
    >
      <ConversationPanel turns={turns} isThinking={isThinking} />
      <Prompt
        isThinking={isThinking}
        disabled={modelPicker.visible || filePicker.visible || Boolean(pendingToolConfirm)}
        modelLabel={modelLabel}
        contextUsagePercent={contextUsagePercent}
        value={inputValue}
        selectedFiles={selectedFiles}
        onAddSelectedFiles={appendSelectedFiles}
        onRemoveSelectedFile={removeSelectedFile}
        onValueChange={setInputValue}
        onSlashCommandSelect={handleSlashCommandSelect}
        onSlashMenuVisibilityChange={setSlashMenuVisible}
        onSubmit={submitWithCommands}
      />
      <ToolConfirmDialog
        visible={Boolean(pendingToolConfirm)}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        request={pendingToolConfirm}
      />
      <FilePickerDialog
        visible={filePicker.visible}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        loading={filePicker.loading}
        error={filePicker.error}
        search={filePicker.search}
        options={filePicker.options}
        selectedIndex={filePicker.selectedIndex}
        selectedPaths={filePicker.selectedPaths}
        onSearchChange={filePicker.setSearch}
        onSelectIndex={filePicker.setSelectedIndex}
        onToggleSelected={filePicker.toggleSelectedIndex}
        onConfirm={() => {
          setSelectedFiles(filePicker.confirmSelected());
        }}
        onListKeyDown={filePicker.handleListKeyDown}
      />
      <ModelPickerDialog
        visible={modelPicker.visible}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        loading={modelPicker.loading}
        switching={modelPicker.switching}
        error={modelPicker.error}
        search={modelPicker.search}
        options={modelPicker.options}
        selectedIndex={modelPicker.selectedIndex}
        onSearchChange={modelPicker.setSearch}
        onSelectIndex={modelPicker.setSelectedIndex}
        onConfirm={() => {
          void modelPicker.confirmSelected();
        }}
        onListKeyDown={modelPicker.handleListKeyDown}
      />
      {copyToastVisible ? (
        <box
          position="absolute"
          right={2}
          top={1}
          zIndex={20}
          flexDirection="row"
          gap={1}
          borderColor={uiTheme.divider}
          borderStyle="rounded"
          paddingX={1}
          paddingY={0}
        >
          <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
            ✓
          </text>
          <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
            Copied
          </text>
        </box>
      ) : null}
    </box>
  );
};
