import { TextAttributes } from "@opentui/core";

import { uiTheme } from "../../ui/theme";

type PromptCardProps = {
  prompt: string;
};

export const PromptCard = ({ prompt }: PromptCardProps) => {
  return (
    <box flexDirection="row" backgroundColor={uiTheme.panel}>
      <box width={1} backgroundColor={uiTheme.accent} />
      <box flexGrow={1} paddingX={2} paddingY={1}>
        <text fg={uiTheme.text} attributes={TextAttributes.BOLD} wrapMode="word">
          {prompt}
        </text>
      </box>
    </box>
  );
};

