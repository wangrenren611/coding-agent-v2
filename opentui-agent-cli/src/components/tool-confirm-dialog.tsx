import { TextAttributes } from '@opentui/core';

import type { AgentToolConfirmEvent } from '../agent/runtime/types';
import { uiTheme } from '../ui/theme';
import { buildToolConfirmDialogContent } from './tool-confirm-dialog-content';

type ToolConfirmDialogProps = {
  visible: boolean;
  viewportWidth: number;
  viewportHeight: number;
  request: (AgentToolConfirmEvent & { selectedAction: 'approve' | 'deny' }) | null;
};

const selectedForeground = '#050608';

const renderButton = (label: string, selected: boolean) => {
  return (
    <box
      paddingLeft={1}
      paddingRight={1}
      backgroundColor={selected ? uiTheme.accent : uiTheme.surface}
      border={['top', 'bottom', 'left', 'right']}
      borderColor={selected ? uiTheme.accent : uiTheme.divider}
    >
      <text fg={selected ? selectedForeground : uiTheme.text} attributes={TextAttributes.BOLD}>
        {label}
      </text>
    </box>
  );
};

export const ToolConfirmDialog = ({
  visible,
  viewportWidth,
  viewportHeight,
  request,
}: ToolConfirmDialogProps) => {
  if (!visible || !request) {
    return null;
  }

  const content = buildToolConfirmDialogContent(request);
  const panelWidth = Math.min(86, Math.max(48, viewportWidth - 8));
  const panelHeight = Math.min(22, Math.max(14, viewportHeight - 6));
  const left = Math.max(2, Math.floor((viewportWidth - panelWidth) / 2));
  const top = Math.max(1, Math.floor((viewportHeight - panelHeight) / 2));
  const selectedAction = request.selectedAction;

  return (
    <box
      position="absolute"
      top={top}
      left={left}
      width={panelWidth}
      height={panelHeight}
      zIndex={150}
    >
      <box
        width="100%"
        height="100%"
        flexDirection="column"
        backgroundColor={uiTheme.surface}
        border={['top', 'bottom', 'left', 'right']}
        borderColor={uiTheme.divider}
      >
        <box
          gap={1}
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          flexDirection="column"
        >
          <box flexDirection="row" gap={1}>
            <text fg={uiTheme.accent} attributes={TextAttributes.BOLD}>
              {'△'}
            </text>
            <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
              Permission required
            </text>
          </box>

          <box paddingLeft={1}>
            <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
              {content.summary}
            </text>
          </box>

          {content.detail ? (
            <box paddingLeft={1}>
              <text fg={uiTheme.text}>{content.detail}</text>
            </box>
          ) : null}

          {content.reason ? (
            <box paddingLeft={1} flexDirection="column">
              <text fg={uiTheme.muted}>Reason</text>
              <text fg={uiTheme.text} wrapMode="word">
                {content.reason}
              </text>
            </box>
          ) : null}

          {content.requestedPath ? (
            <box paddingLeft={1} flexDirection="column">
              <text fg={uiTheme.muted}>Requested path</text>
              <text fg={uiTheme.text} wrapMode="word">
                {content.requestedPath}
              </text>
            </box>
          ) : null}

          {content.allowedDirectories.length > 0 ? (
            <box paddingLeft={1} flexDirection="column">
              <text fg={uiTheme.muted}>Allowed directories</text>
              {content.allowedDirectories.map(directory => (
                <text key={directory} fg={uiTheme.text} wrapMode="word">
                  {directory}
                </text>
              ))}
            </box>
          ) : null}

          {content.argumentItems.length > 0 ? (
            <box flexGrow={1} paddingLeft={1} paddingRight={1}>
              <scrollbox
                height="100%"
                scrollY
                stickyScroll
                scrollbarOptions={{ visible: false }}
                viewportOptions={{ backgroundColor: uiTheme.panel }}
                contentOptions={{ backgroundColor: uiTheme.panel }}
              >
                <box
                  backgroundColor={uiTheme.panel}
                  paddingX={1}
                  paddingY={1}
                  gap={1}
                  flexDirection="column"
                >
                  <text fg={uiTheme.muted}>Arguments</text>
                  {content.argumentItems.map((item, index) => (
                    <box key={`${item.label}:${index}`} flexDirection="column">
                      <text fg={uiTheme.muted}>{item.label}</text>
                      <text
                        fg={uiTheme.text}
                        wrapMode={item.multiline ? 'char' : 'word'}
                        attributes={item.multiline ? uiTheme.typography.code : undefined}
                      >
                        {item.value}
                      </text>
                    </box>
                  ))}
                </box>
              </scrollbox>
            </box>
          ) : null}
        </box>

        <box
          flexDirection="row"
          justifyContent="space-between"
          paddingLeft={2}
          paddingRight={2}
          paddingTop={1}
          paddingBottom={1}
          backgroundColor={uiTheme.panel}
        >
          <box flexDirection="row" gap={1}>
            {renderButton('Allow once', selectedAction === 'approve')}
            {renderButton('Reject', selectedAction === 'deny')}
          </box>
          <text fg={uiTheme.muted}>left/right select enter confirm esc reject</text>
        </box>

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
