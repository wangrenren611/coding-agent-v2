import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { resolveSlashCommand, type SlashCommandDefinition } from "./commands/slash-commands";
import { ConversationPanel } from "./components/conversation-panel";
import { ModelPickerDialog } from "./components/model-picker-dialog";
import { Prompt } from "./components/prompt";
import { ToolConfirmDialog } from "./components/tool-confirm-dialog";
import { useAgentChat } from "./hooks/use-agent-chat";
import { useModelPicker } from "./hooks/use-model-picker";
import { requestExit } from "./runtime/exit";
import { uiTheme } from "./ui/theme";

export const App = () => {
  const {
    turns,
    inputValue,
    isThinking,
    modelLabel,
    contextUsagePercent,
    pendingToolConfirm,
    setInputValue,
    submitInput,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
    setToolConfirmSelection,
    submitToolConfirmSelection,
    rejectPendingToolConfirm,
  } = useAgentChat();
  const modelPicker = useModelPicker({
    onModelChanged: setModelLabelDisplay,
  });
  const dimensions = useTerminalDimensions();

  const submitWithCommands = () => {
    const command = resolveSlashCommand(inputValue);
    if (command?.action === "models") {
      setInputValue("");
      modelPicker.open();
      return;
    }

    submitInput();
  };

  const handleSlashCommandSelect = (command: SlashCommandDefinition) => {
    if (command.action === "models") {
      setInputValue("");
      modelPicker.open();
      return true;
    }
    return false;
  };

  useKeyboard((key) => {
    if (key.ctrl && key.name === "c") {
      requestExit(0);
      return;
    }

    if (modelPicker.visible) {
      if (key.name === "escape") {
        modelPicker.close();
      }
      return;
    }

    if (pendingToolConfirm) {
      if (key.name === "left" || key.name === "h") {
        setToolConfirmSelection("approve");
        return;
      }

      if (key.name === "right" || key.name === "l") {
        setToolConfirmSelection("deny");
        return;
      }

      if (key.name === "return" || key.name === "enter") {
        submitToolConfirmSelection();
        return;
      }

      if (key.name === "escape") {
        rejectPendingToolConfirm();
      }
      return;
    }

    if (key.ctrl && key.name === "l") {
      resetConversation();
      return;
    }

    if (key.name === "escape") {
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
        disabled={modelPicker.visible || Boolean(pendingToolConfirm)}
        modelLabel={modelLabel}
        contextUsagePercent={contextUsagePercent}
        value={inputValue}
        onValueChange={setInputValue}
        onSlashCommandSelect={handleSlashCommandSelect}
        onSubmit={submitWithCommands}
      />
      <ToolConfirmDialog
        visible={Boolean(pendingToolConfirm)}
        viewportWidth={dimensions.width}
        viewportHeight={dimensions.height}
        request={pendingToolConfirm}
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
    </box>
  );
};
