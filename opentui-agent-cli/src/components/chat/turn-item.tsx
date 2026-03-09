import type { ChatTurn } from "../../types/chat";
import { uiTheme } from "../../ui/theme";
import { AssistantReply } from "./assistant-reply";
import { PromptCard } from "./prompt-card";

type TurnItemProps = {
  turn: ChatTurn;
  index: number;
  isPending?: boolean;
};

const PendingReply = () => {
  return (
    <box flexDirection="row" gap={1}>
      <box width={1} backgroundColor={uiTheme.divider} />
      <box flexGrow={1}>
        <text attributes={uiTheme.typography.body}>
          <i fg={uiTheme.thinking}>Thinking:</i>
          <span fg={uiTheme.muted}> preparing response...</span>
        </text>
      </box>
    </box>
  );
};

export const TurnItem = ({ turn, index, isPending = false }: TurnItemProps) => {
  return (
    <box flexDirection="column">
      <PromptCard prompt={turn.prompt} createdAtMs={turn.createdAtMs} isFirst={index === 0} />
      {turn.reply ? <AssistantReply reply={turn.reply} /> : null}
      {isPending && !turn.reply ? <PendingReply /> : null}
    </box>
  );
};
