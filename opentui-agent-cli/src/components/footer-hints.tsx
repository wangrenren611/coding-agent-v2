import { TextAttributes } from "@opentui/core";
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
      paddingRight={uiTheme.layout.footerPaddingRight}
      backgroundColor={uiTheme.bg}
      flexDirection="row"
      marginTop={uiTheme.layout.footerMarginTop}
    >
      {isThinking ? (
        <box flexDirection="row" gap={1}>
          <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
            {SPINNER_FRAMES[frameIndex]}
          </text>
          <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
            thinking...
          </text>
        </box>
      ) : (
        <text />
      )}
      <text fg={uiTheme.muted} attributes={TextAttributes.BOLD}>
        <strong>tab</strong> agents  <strong>ctrl+p</strong> commands
      </text>
    </box>
  );
};
