import {
  formatLoopEvent,
  formatStepEvent,
  formatStopEvent,
  formatToolConfirmEvent,
  formatToolResultEvent,
  formatToolResultEventCode,
  formatToolStreamEvent,
  formatToolUseEvent,
  formatToolUseEventCode,
} from "../agent/runtime/event-format";
import type { AgentEventHandlers } from "../agent/runtime/types";
import type { ReplySegmentType } from "../types/chat";

type BuildAgentEventHandlersParams = {
  turnId: number;
  isCurrentRequest: () => boolean;
  appendSegment: (turnId: number, segmentId: string, type: ReplySegmentType, chunk: string) => void;
  appendEventLine: (turnId: number, text: string) => void;
};

const shouldShowEventLog = () => {
  const value = process.env.AGENT_SHOW_EVENTS?.trim().toLowerCase();
  return value === "1" || value === "true" || value === "yes" || value === "on";
};

export const buildAgentEventHandlers = ({
  turnId,
  isCurrentRequest,
  appendSegment,
  appendEventLine,
}: BuildAgentEventHandlersParams): AgentEventHandlers => {
  const showEvents = shouldShowEventLog();
  const logEvent = (text: string) => {
    if (!showEvents) {
      return;
    }
    appendEventLine(turnId, text);
  };

  return {
    onTextDelta: (event) => {
      if (!isCurrentRequest() || !event.text) {
        return;
      }
      const segmentId = event.isReasoning ? `${turnId}:thinking` : `${turnId}:text`;
      const segmentType = event.isReasoning ? "thinking" : "text";
      appendSegment(turnId, segmentId, segmentType, event.text);
    },
    onTextComplete: () => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent("[text-complete]");
    },
    onToolStream: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      const mapped = formatToolStreamEvent(event);
      if (mapped.codeChunk && mapped.segmentKey) {
        appendSegment(turnId, `${turnId}:tool:${mapped.segmentKey}`, "code", mapped.codeChunk);
      }
      if (mapped.note) {
        logEvent(mapped.note);
      }
    },
    onToolConfirm: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatToolConfirmEvent(event));
    },
    onToolUse: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      appendSegment(turnId, `${turnId}:tool-use`, "code", `${formatToolUseEventCode(event)}\n`);
      logEvent(formatToolUseEvent(event));
    },
    onToolResult: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      appendSegment(turnId, `${turnId}:tool-result`, "code", `${formatToolResultEventCode(event)}\n`);
      logEvent(formatToolResultEvent(event));
    },
    onStep: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatStepEvent(event));
    },
    onLoop: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatLoopEvent(event));
    },
    onStop: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      logEvent(formatStopEvent(event));
    },
  };
};
