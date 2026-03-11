import type { PromptFileSelection } from '../files/types';
import { TextAttributes } from '@opentui/core';

import { uiTheme } from '../ui/theme';

type FileMentionMenuProps = {
  visible: boolean;
  loading: boolean;
  error: string | null;
  options: PromptFileSelection[];
  selectedIndex: number;
};

const selectedBackground = '#f4b183';
const selectedForeground = '#050608';

export const FileMentionMenu = ({
  visible,
  loading,
  error,
  options,
  selectedIndex,
}: FileMentionMenuProps) => {
  if (!visible) {
    return null;
  }

  return (
    <box
      width="100%"
      flexShrink={0}
      backgroundColor={uiTheme.panel}
      border={['top', 'bottom', 'left', 'right']}
      borderColor={uiTheme.divider}
      marginBottom={0}
      height={Math.min(11, Math.max(3, options.length + 2))}
    >
      <scrollbox scrollY stickyScroll stickyStart="top" scrollbarOptions={{ visible: false }}>
        <box flexDirection="column" backgroundColor={uiTheme.panel}>
          {loading ? (
            <box paddingX={1}>
              <text fg={uiTheme.muted}>Loading files...</text>
            </box>
          ) : error ? (
            <box paddingX={1}>
              <text fg="#ff8d8d">{error}</text>
            </box>
          ) : options.length === 0 ? (
            <box paddingX={1}>
              <text fg={uiTheme.muted}>No matching file</text>
            </box>
          ) : (
            options.map((option, index) => {
              const isSelected = index === selectedIndex;
              return (
                <box
                  key={option.absolutePath}
                  flexDirection="row"
                  paddingX={1}
                  backgroundColor={isSelected ? selectedBackground : uiTheme.panel}
                >
                  <text
                    fg={isSelected ? selectedForeground : uiTheme.text}
                    attributes={TextAttributes.BOLD}
                    flexShrink={0}
                  >
                    @{`/${option.relativePath}`}
                  </text>
                </box>
              );
            })
          )}
        </box>
      </scrollbox>
    </box>
  );
};
