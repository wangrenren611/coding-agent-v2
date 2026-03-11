import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { TextAttributes } from '@opentui/core';
import { useEffect, useRef } from 'react';

import type { PromptFileSelection } from '../files/types';
import { uiTheme } from '../ui/theme';

type FilePickerDialogProps = {
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  loading: boolean;
  error: string | null;
  search: string;
  options: PromptFileSelection[];
  selectedIndex: number;
  selectedPaths: Set<string>;
  onSearchChange: (value: string) => void;
  onSelectIndex: (index: number) => void;
  onToggleSelected: () => void;
  onConfirm: () => void;
  onListKeyDown: (event: KeyEvent) => boolean;
};

const selectedBackground = '#f4b183';
const selectedForeground = '#050608';

const formatSize = (size: number) => {
  if (size < 1024) {
    return `${size} B`;
  }
  if (size < 1024 * 1024) {
    return `${(size / 1024).toFixed(1)} KB`;
  }
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
};

export const FilePickerDialog = ({
  visible,
  viewportWidth,
  viewportHeight,
  loading,
  error,
  search,
  options,
  selectedIndex,
  selectedPaths,
  onSearchChange,
  onSelectIndex,
  onToggleSelected,
  onConfirm,
  onListKeyDown,
}: FilePickerDialogProps) => {
  const searchRef = useRef<TextareaRenderable | null>(null);

  const panelWidth = Math.min(88, Math.max(48, viewportWidth - 8));
  const panelHeight = Math.min(28, Math.max(14, viewportHeight - 4));
  const left = Math.max(2, Math.floor((viewportWidth - panelWidth) / 2));
  const top = Math.max(1, Math.floor((viewportHeight - panelHeight) / 2));

  useEffect(() => {
    if (!visible) {
      return;
    }

    const searchInput = searchRef.current;
    if (!searchInput) {
      return;
    }

    searchInput.setText(search);
    searchInput.cursorOffset = search.length;
    searchInput.focus();
  }, [search, visible]);

  if (!visible) {
    return null;
  }

  return (
    <box position="absolute" top={top} left={left} width={panelWidth} height={panelHeight} zIndex={150}>
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={uiTheme.surface}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={uiTheme.divider}
      >
        <box justifyContent="space-between" paddingX={2} paddingTop={1} paddingBottom={0}>
          <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
            Select files
          </text>
          <text fg={uiTheme.muted}>
            <strong>space</strong> toggle <strong>enter</strong> attach
          </text>
        </box>

        <box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="column">
          <text fg={uiTheme.muted}>Search</text>
          <box backgroundColor={uiTheme.panel} paddingX={1}>
            <textarea
              ref={searchRef}
              width="100%"
              minHeight={1}
              maxHeight={1}
              initialValue={search}
              textColor={uiTheme.text}
              focusedTextColor={uiTheme.text}
              backgroundColor={uiTheme.panel}
              focusedBackgroundColor={uiTheme.panel}
              onContentChange={() => onSearchChange(searchRef.current?.plainText ?? '')}
              onKeyDown={event => {
                const handled = onListKeyDown(event);
                if (handled && (event.name === 'enter' || event.name === 'return')) {
                  onConfirm();
                }
              }}
            />
          </box>
        </box>

        <box flexGrow={1} paddingX={1}>
          <scrollbox
            height="100%"
            scrollY
            stickyScroll
            stickyStart="top"
            scrollbarOptions={{ visible: false }}
            viewportOptions={{ backgroundColor: uiTheme.surface }}
            contentOptions={{ backgroundColor: uiTheme.surface }}
          >
            <box flexDirection="column" backgroundColor={uiTheme.surface}>
              {loading ? (
                <box paddingX={1}>
                  <text fg={uiTheme.muted}>Loading files...</text>
                </box>
              ) : options.length === 0 ? (
                <box paddingX={1}>
                  <text fg={uiTheme.muted}>No matching file</text>
                </box>
              ) : (
                options.map((option, index) => {
                  const isSelected = index === selectedIndex;
                  const isChecked = selectedPaths.has(option.absolutePath);
                  return (
                    <box
                      key={option.absolutePath}
                      flexDirection="row"
                      justifyContent="space-between"
                      paddingX={1}
                      backgroundColor={isSelected ? selectedBackground : uiTheme.surface}
                      onMouseOver={() => onSelectIndex(index)}
                      onMouseUp={() => onToggleSelected()}
                    >
                      <text
                        fg={isSelected ? selectedForeground : uiTheme.text}
                        attributes={TextAttributes.BOLD}
                        wrapMode="none"
                      >
                        {isChecked ? '[x] ' : '[ ] '}
                        {option.relativePath}
                      </text>
                      <text fg={isSelected ? selectedForeground : uiTheme.muted}>
                        {formatSize(option.size)}
                      </text>
                    </box>
                  );
                })
              )}
            </box>
          </scrollbox>
        </box>

        <box paddingX={2} paddingY={1} justifyContent="space-between">
          <text fg={uiTheme.muted}>{selectedPaths.size} selected</text>
          <text fg={uiTheme.muted}>
            <strong>esc</strong> close
          </text>
        </box>

        {error ? (
          <box paddingX={2} paddingBottom={1}>
            <text fg="#ff8d8d">{error}</text>
          </box>
        ) : null}

        <box
          position="absolute"
          top={0}
          left={0}
          width={1}
          height="100%"
          backgroundColor={uiTheme.accent}
        />
      </box>
    </box>
  );
};
