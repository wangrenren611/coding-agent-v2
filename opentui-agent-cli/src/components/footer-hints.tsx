import { TextAttributes } from '@opentui/core';
import { useEffect, useState } from 'react';

import { uiTheme } from '../ui/theme';

type FooterHintsProps = {
  isThinking: boolean;
  contextUsagePercent: number | null;
};

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL_MS = 80;

export const FooterHints = ({ isThinking, contextUsagePercent }: FooterHintsProps) => {
  const [frameIndex, setFrameIndex] = useState(0);
  const hintAlignPaddingX =
    uiTheme.layout.conversationPaddingX +
    uiTheme.layout.conversationContentPaddingX +
    uiTheme.layout.promptPaddingX;
  const contextUsageLabel =
    typeof contextUsagePercent === 'number' && Number.isFinite(contextUsagePercent)
      ? `${Math.max(0, Math.round(contextUsagePercent))}%`
      : '0%';

  useEffect(() => {
    if (!isThinking) {
      setFrameIndex(0);
      return;
    }

    const timer = setInterval(() => {
      setFrameIndex(current => (current + 1) % SPINNER_FRAMES.length);
    }, SPINNER_INTERVAL_MS);

    return () => {
      clearInterval(timer);
    };
  }, [isThinking]);

  return (
    <box
      width="100%"
      justifyContent="space-between"
      paddingLeft={hintAlignPaddingX}
      paddingTop={0}
      paddingRight={hintAlignPaddingX + uiTheme.layout.footerPaddingRight}
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
      <box flexDirection="row" gap={2}>
        {isThinking ? (
          <text fg={uiTheme.muted} attributes={TextAttributes.BOLD}>
            <strong>esc</strong> stop
          </text>
        ) : null}
        <text fg={uiTheme.muted} attributes={TextAttributes.BOLD}>
          <strong>context</strong> {contextUsageLabel}
        </text>
      </box>
    </box>
  );
};
