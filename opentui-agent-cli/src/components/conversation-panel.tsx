import type { ChatTurn } from "../types/chat";
import { uiTheme } from "../ui/theme";
import { TurnItem } from "./chat/turn-item";

type ConversationPanelProps = {
  turns: ChatTurn[];
  isThinking: boolean;
};

export const ConversationPanel = ({ turns, isThinking }: ConversationPanelProps) => {
  const pendingTurnId = turns.at(-1)?.id;

  return (
    <scrollbox
      flexGrow={1}
      scrollY
      stickyScroll
      stickyStart="bottom"
      paddingX={1}
      paddingY={0}
      viewportOptions={{ backgroundColor: uiTheme.bg }}
      contentOptions={{ backgroundColor: uiTheme.bg }}
    >
      <box flexDirection="column" gap={1} paddingX={1} paddingY={1} backgroundColor={uiTheme.bg}>
        {turns.map((turn) => (
          <TurnItem key={turn.id} turn={turn} isPending={isThinking && turn.id === pendingTurnId} />
        ))}
      </box>
    </scrollbox>
  );
};
