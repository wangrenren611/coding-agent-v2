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
import type {
  AgentEventHandlers,
  AgentToolResultEvent,
  AgentToolUseEvent,
} from "../agent/runtime/types";
import type { ReplySegmentType } from "../types/chat";

type BuildAgentEventHandlersParams = {
  turnId: number;
  isCurrentRequest: () => boolean;
  appendSegment: (
    turnId: number,
    segmentId: string,
    type: ReplySegmentType,
    chunk: string,
    data?: unknown,
  ) => void;
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
  const streamedToolCallIds = new Set<string>();
  const renderedToolUseIds = new Set<string>();
  let anonymousToolUseCounter = 0;
  let anonymousToolResultCounter = 0;
  let streamSegmentCursor = 0;
  let activeTextSegment:
    | {
        id: string;
        type: "thinking" | "text";
      }
    | null = null;

  const createStreamSegmentId = (type: "thinking" | "text") => {
    streamSegmentCursor += 1;
    return `${turnId}:${type}:${streamSegmentCursor}`;
  };

  const appendTextDeltaInOrder = (text: string, isReasoning: boolean) => {
    const type: "thinking" | "text" = isReasoning ? "thinking" : "text";
    if (!activeTextSegment || activeTextSegment.type !== type) {
      activeTextSegment = {
        id: createStreamSegmentId(type),
        type,
      };
    }
    appendSegment(turnId, activeTextSegment.id, type, text);
  };

  const breakTextDeltaContinuation = () => {
    activeTextSegment = null;
  };

  const readToolCallIdFromResult = (event: AgentToolResultEvent): string | undefined => {
    if (!event.toolCall || typeof event.toolCall !== "object") {
      return undefined;
    }
    const maybeId = (event.toolCall as { id?: unknown }).id;
    return typeof maybeId === "string" ? maybeId : undefined;
  };

  const readToolCallIdFromUse = (event: AgentToolUseEvent): string | undefined => {
    if (!event || typeof event !== "object") {
      return undefined;
    }
    const maybeId = (event as { id?: unknown }).id;
    return typeof maybeId === "string" ? maybeId : undefined;
  };

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
      appendTextDeltaInOrder(event.text, Boolean(event.isReasoning));
    },
    onTextComplete: () => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      logEvent("[text-complete]");
    },
    onToolStream: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      const mapped = formatToolStreamEvent(event);
      if (mapped.codeChunk && mapped.segmentKey) {
        appendSegment(turnId, `${turnId}:tool:${mapped.segmentKey}`, "code", mapped.codeChunk);
      }
      if (
        (event.type === "stdout" || event.type === "stderr") &&
        typeof event.toolCallId === "string" &&
        event.toolCallId.length > 0
      ) {
        streamedToolCallIds.add(event.toolCallId);
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
      breakTextDeltaContinuation();
      const toolCallId = readToolCallIdFromUse(event);
      if (toolCallId && renderedToolUseIds.has(toolCallId)) {
        return;
      }
      if (toolCallId) {
        renderedToolUseIds.add(toolCallId);
      }
      const segmentSuffix = toolCallId ?? `anonymous_${++anonymousToolUseCounter}`;
      appendSegment(
        turnId,
        `${turnId}:tool-use:${segmentSuffix}`,
        "code",
        `${formatToolUseEventCode(event)}\n`,
        event,
      );
      logEvent(formatToolUseEvent(event));
    },
    onToolResult: (event) => {
      if (!isCurrentRequest()) {
        return;
      }
      breakTextDeltaContinuation();
      const toolCallId = readToolCallIdFromResult(event);
      const suppressOutput = Boolean(toolCallId && streamedToolCallIds.has(toolCallId));
      const segmentSuffix = toolCallId ?? `anonymous_${++anonymousToolResultCounter}`;
      appendSegment(
        turnId,
        `${turnId}:tool-result:${segmentSuffix}`,
        "code",
        `${formatToolResultEventCode(event, { suppressOutput })}\n`,
        event,
      );
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
      breakTextDeltaContinuation();
      logEvent(formatStopEvent(event));
    },
  };
};
