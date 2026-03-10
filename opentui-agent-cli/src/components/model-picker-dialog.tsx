import type { KeyEvent, TextareaRenderable } from '@opentui/core';
import { TextAttributes } from '@opentui/core';
import { useEffect, useMemo, useRef } from 'react';

import type { AgentModelOption } from '../agent/runtime/model-types';
import { uiTheme } from '../ui/theme';

type ModelPickerDialogProps = {
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  loading: boolean;
  switching: boolean;
  error: string | null;
  search: string;
  options: AgentModelOption[];
  selectedIndex: number;
  onSearchChange: (value: string) => void;
  onSelectIndex: (index: number) => void;
  onConfirm: () => void;
  onListKeyDown: (event: KeyEvent) => boolean;
};

const selectedBackground = '#f4b183';
const selectedForeground = '#050608';

const toProviderLabel = (provider: string) => {
  if (!provider) {
    return 'Other';
  }
  return provider.slice(0, 1).toUpperCase() + provider.slice(1);
};

export const ModelPickerDialog = ({
  visible,
  viewportWidth,
  viewportHeight,
  loading,
  switching,
  error,
  search,
  options,
  selectedIndex,
  onSearchChange,
  onSelectIndex,
  onConfirm,
  onListKeyDown,
}: ModelPickerDialogProps) => {
  const searchRef = useRef<TextareaRenderable | null>(null);

  const panelWidth = Math.min(78, Math.max(40, viewportWidth - 8));
  const panelHeight = Math.min(26, Math.max(14, viewportHeight - 4));
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

  const rows = useMemo(() => {
    const result: Array<{
      type: 'section' | 'option';
      label?: string;
      option?: AgentModelOption;
      index?: number;
    }> = [];
    let lastProvider = '';

    options.forEach((option, index) => {
      if (option.provider !== lastProvider) {
        lastProvider = option.provider;
        result.push({
          type: 'section',
          label: toProviderLabel(option.provider),
        });
      }

      result.push({
        type: 'option',
        option,
        index,
      });
    });

    return result;
  }, [options]);

  if (!visible) {
    return null;
  }

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={panelWidth}
      height={panelHeight}
      zIndex={140}
    >
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
            Select model
          </text>
          <text fg={uiTheme.muted}>
            <strong>esc</strong>
          </text>
        </box>

        <box paddingX={2} paddingTop={1} paddingBottom={1} flexDirection="column" gap={0}>
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
                if (onListKeyDown(event)) {
                  return;
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
                  <text fg={uiTheme.muted}>Loading models...</text>
                </box>
              ) : rows.length === 0 ? (
                <box paddingX={1}>
                  <text fg={uiTheme.muted}>No matching model</text>
                </box>
              ) : (
                rows.map((row, idx) => {
                  if (row.type === 'section') {
                    return (
                      <box
                        key={`section:${row.label}:${idx}`}
                        paddingX={1}
                        paddingTop={idx === 0 ? 0 : 1}
                      >
                        <text fg="#b294ff" attributes={TextAttributes.BOLD}>
                          {row.label}
                        </text>
                      </box>
                    );
                  }

                  const option = row.option!;
                  const optionIndex = row.index ?? 0;
                  const isSelected = optionIndex === selectedIndex;
                  const suffix = option.current
                    ? 'Current'
                    : option.configured
                      ? 'Ready'
                      : 'No key';

                  return (
                    <box
                      key={option.id}
                      flexDirection="row"
                      justifyContent="space-between"
                      paddingX={1}
                      backgroundColor={isSelected ? selectedBackground : uiTheme.surface}
                      onMouseOver={() => onSelectIndex(optionIndex)}
                      onMouseUp={() => onConfirm()}
                    >
                      <text
                        fg={isSelected ? selectedForeground : uiTheme.text}
                        attributes={TextAttributes.BOLD}
                        wrapMode="none"
                      >
                        {option.name}
                      </text>
                      <text fg={isSelected ? selectedForeground : uiTheme.muted}>{suffix}</text>
                    </box>
                  );
                })
              )}
            </box>
          </scrollbox>
        </box>

        <box paddingX={2} paddingY={1} justifyContent="space-between">
          <text fg={switching ? uiTheme.accent : uiTheme.muted}>
            {switching ? 'Switching model...' : 'enter select  up/down navigate'}
          </text>
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
