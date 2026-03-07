import type { Plugin } from '../hook';
import type { TerminalUiEvent } from './types';

export type TerminalUiDispatch = (event: TerminalUiEvent) => void;

export function createTerminalUiAgentPlugin(dispatch: TerminalUiDispatch): Plugin {
  return {
    name: 'terminal-ui-agent-bridge',
    textDelta: ({ text, isReasoning, messageId }) => {
      if (text.length === 0) {
        return;
      }
      dispatch({
        type: 'stream.text',
        text,
        isReasoning,
        messageId,
      });
    },
    toolStream: (event) => {
      dispatch({
        type: 'stream.tool',
        event,
      });
    },
    toolConfirm: (request) => {
      dispatch({
        type: 'tool.confirm.request',
        request,
      });
    },
    step: (
      {
        stepIndex,
        finishReason,
        toolCallsCount,
        assistantMessageId,
        assistantContent,
        assistantReasoningContent,
      },
      ctx
    ) => {
      dispatch({
        type: 'step',
        loopIndex: ctx.loopIndex,
        stepIndex,
        finishReason,
        toolCallsCount,
      });
      if (
        (assistantContent && assistantContent.length > 0) ||
        (assistantReasoningContent && assistantReasoningContent.length > 0)
      ) {
        dispatch({
          type: 'assistant.snapshot',
          messageId: assistantMessageId,
          content: assistantContent,
          reasoningContent: assistantReasoningContent,
          finishReason,
        });
      }
    },
    stop: ({ reason, message }) => {
      dispatch({
        type: 'stop',
        reason,
        message,
      });
    },
  };
}
