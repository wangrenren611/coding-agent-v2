import { uiTheme } from '../../ui/theme';

type PromptCardProps = {
  prompt: string;
  createdAtMs: number;
  isFirst?: boolean;
};

const formatTime = (timestamp: number) => {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
};

export const PromptCard = ({ prompt, createdAtMs, isFirst = false }: PromptCardProps) => {
  return (
    <box flexDirection="row" marginTop={isFirst ? 0 : 1} marginBottom={1}>
      <box width={0.5} backgroundColor={uiTheme.accent} />
      <box
        flexGrow={1}
        backgroundColor={uiTheme.userPromptBg}
        paddingLeft={2}
        paddingRight={1}
        paddingTop={1}
        paddingBottom={1}
      >
        <text
          fg={uiTheme.userPromptText}
          attributes={uiTheme.typography.heading}
          wrapMode="word"
          selectable={true}
        >
          {prompt}
        </text>
        <box paddingTop={1}>
          <text fg={uiTheme.muted} attributes={uiTheme.typography.note} selectable={true}>
            {formatTime(createdAtMs)}
          </text>
        </box>
      </box>
    </box>
  );
};
