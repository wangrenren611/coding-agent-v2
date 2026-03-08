import type { ChatTurn } from "../../types/chat";
import { uiTheme } from "../../ui/theme";
import { AssistantReply } from "./assistant-reply";
import { PromptCard } from "./prompt-card";

type TurnItemProps = {
  turn: ChatTurn;
  isPending?: boolean;
};

const PendingReply = () => {
  return (
    <box flexDirection="row" gap={1}>
      <box width={1} backgroundColor={uiTheme.divider} />
      <box flexGrow={1}>
        <text>
          <i fg={uiTheme.thinking}>Thinking:</i>
          <span fg={uiTheme.muted}> preparing response...</span>
        </text>
      </box>
    </box>
  );
};

export const TurnItem = ({ turn, isPending = false }: TurnItemProps) => {
  return (
    <box flexDirection="column" gap={1}>
      <PromptCard prompt={turn.prompt} />
      {turn.reply ? <AssistantReply reply={turn.reply} /> : null}
      {isPending && !turn.reply ? <PendingReply /> : null}
    </box>
  );
};
