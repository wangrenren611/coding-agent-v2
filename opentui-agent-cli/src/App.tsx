import { useKeyboard, useTerminalDimensions } from "@opentui/react";

import { resolveSlashCommand, type SlashCommandDefinition } from "./commands/slash-commands";
import { ConversationPanel } from "./components/conversation-panel";
import { ModelPickerDialog } from "./components/model-picker-dialog";
import { Prompt } from "./components/prompt";
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
    setInputValue,
    submitInput,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
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
      paddingTop={1}
      paddingBottom={0}
    >
      <ConversationPanel turns={turns} isThinking={isThinking} />
      <Prompt
        isThinking={isThinking}
        disabled={modelPicker.visible}
        modelLabel={modelLabel}
        value={inputValue}
        onValueChange={setInputValue}
        onSlashCommandSelect={handleSlashCommandSelect}
        onSubmit={submitWithCommands}
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
