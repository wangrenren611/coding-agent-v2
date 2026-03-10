import { TextAttributes } from '@opentui/core';

import type { SlashCommandDefinition } from '../commands/slash-commands';
import { uiTheme } from '../ui/theme';

type SlashCommandMenuProps = {
  visible: boolean;
  options: SlashCommandDefinition[];
  selectedIndex: number;
};

const selectedBackground = '#f4b183';
const selectedForeground = '#050608';

export const SlashCommandMenu = ({ visible, options, selectedIndex }: SlashCommandMenuProps) => {
  if (!visible) {
    return null;
  }

  const labelWidth = options.reduce((max, option) => {
    const width = `/${option.name}`.length;
    return Math.max(max, width);
  }, 0);

  return (
    <box
      width="100%"
      flexShrink={0}
      backgroundColor={uiTheme.panel}
      border={['top', 'bottom', 'left', 'right']}
      borderColor={uiTheme.divider}
      marginBottom={0}
      height={Math.min(11, options.length + 2)}
    >
      <scrollbox scrollY stickyScroll stickyStart="top" scrollbarOptions={{ visible: false }}>
        <box flexDirection="column" backgroundColor={uiTheme.panel}>
          {options.map((option, index) => {
            const isSelected = index === selectedIndex;
            const commandText = `/${option.name}`.padEnd(labelWidth + 2, ' ');

            return (
              <box
                key={option.name}
                flexDirection="row"
                paddingX={1}
                backgroundColor={isSelected ? selectedBackground : uiTheme.panel}
              >
                <text
                  fg={isSelected ? selectedForeground : uiTheme.text}
                  attributes={TextAttributes.BOLD}
                  flexShrink={0}
                >
                  {commandText}
                </text>
                <text fg={isSelected ? selectedForeground : uiTheme.muted} wrapMode="word">
                  {option.description}
                </text>
              </box>
            );
          })}
        </box>
      </scrollbox>
    </box>
  );
};
