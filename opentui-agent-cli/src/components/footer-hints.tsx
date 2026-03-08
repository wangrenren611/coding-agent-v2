import { useEffect, useState } from "react";

import { uiTheme } from "../ui/theme";

type FooterHintsProps = {
  isThinking: boolean;
};

const SPINNER_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const SPINNER_INTERVAL_MS = 80;

export const FooterHints = ({ isThinking }: FooterHintsProps) => {
  const [frameIndex, setFrameIndex] = useState(0);

  useEffect(() => {
    if (!isThinking) {
      setFrameIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setFrameIndex((current) => (current + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isThinking]);

  return (
    <box
      width="100%"
      justifyContent="space-between"
      paddingTop={0}
      paddingRight={1}
      backgroundColor={uiTheme.bg}
      flexDirection="row"
      marginTop={1}
    >
      {isThinking ? (
        <box flexDirection="row" gap={1}>
          <text fg={uiTheme.accent}>{SPINNER_FRAMES[frameIndex]}</text>
          <text fg={uiTheme.muted}>thinking</text>
        </box>
      ) : (
        <text />
      )}
      <text fg={uiTheme.muted}>
        <strong>tab</strong> agents  <strong>ctrl+p</strong> commands
      </text>
    </box>
  );
};
