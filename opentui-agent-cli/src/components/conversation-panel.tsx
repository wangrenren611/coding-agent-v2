import type { ChatTurn } from '../types/chat';
import { uiTheme } from '../ui/theme';
import { TurnItem } from './chat/turn-item';

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
      paddingX={uiTheme.layout.conversationPaddingX}
      paddingY={uiTheme.layout.conversationPaddingY}
      viewportOptions={{ backgroundColor: uiTheme.bg }}
      contentOptions={{ backgroundColor: uiTheme.bg }}
      marginBottom={1}
    >
      <box
        flexDirection="column"
        gap={0}
        paddingX={uiTheme.layout.conversationContentPaddingX}
        paddingY={uiTheme.layout.conversationContentPaddingY}
        backgroundColor={uiTheme.bg}
      >
        {turns.map((turn, index) => (
          <TurnItem
            key={turn.id}
            turn={turn}
            index={index}
            isPending={isThinking && turn.id === pendingTurnId}
          />
        ))}
      </box>
    </scrollbox>
  );
};
