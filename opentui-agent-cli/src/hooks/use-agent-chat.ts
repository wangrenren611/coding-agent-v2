import { useCallback, useEffect, useRef, useState } from "react";

import { resolveSlashCommand } from "../commands/slash-commands";
import { getAgentModelLabel, runAgentPrompt } from "../agent/runtime/runtime";
import type {
  AgentToolConfirmDecision,
  AgentToolConfirmEvent,
  AgentUsageEvent,
} from "../agent/runtime/types";
import { requestExit } from "../runtime/exit";
import type { ChatTurn, ReplySegmentType } from "../types/chat";
import { buildAgentEventHandlers } from "./agent-event-handlers";
import { buildHelpSegments, buildUnsupportedSegments, extractErrorMessage } from "./chat-local-replies";
import {
  appendNoteLine,
  appendToSegment,
  createStreamingReply,
  orderReplySegments,
  patchTurn,
  setReplyStatus,
} from "./turn-updater";

export type UseAgentChatResult = {
  turns: ChatTurn[];
  inputValue: string;
  isThinking: boolean;
  modelLabel: string;
  contextUsagePercent: number | null;
  pendingToolConfirm: (AgentToolConfirmEvent & { selectedAction: "approve" | "deny" }) | null;
  setInputValue: (value: string) => void;
  submitInput: () => void;
  clearInput: () => void;
  resetConversation: () => void;
  setModelLabelDisplay: (label: string) => void;
  setToolConfirmSelection: (selection: "approve" | "deny") => void;
  submitToolConfirmSelection: () => void;
  rejectPendingToolConfirm: () => void;
};

const INITIAL_MODEL_LABEL = process.env.AGENT_MODEL?.trim() || "glm-5";

const normalizeTokenCount = (value: number | undefined): number | undefined => {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }
  return Math.max(0, Math.round(value));
};

/** Normalizes context usage percent, ensuring it's a finite non-negative number. */
const normalizeContextUsagePercent = (value: unknown): number | null => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.max(0, value);
  }
  return null;
};

const toReplyUsage = (
  usage?: AgentUsageEvent,
):
  | {
      usagePromptTokens?: number;
      usageCompletionTokens?: number;
      usageTotalTokens?: number;
    }
  | undefined => {
  if (!usage) {
    return undefined;
  }

  const usagePromptTokens = normalizeTokenCount(usage.cumulativePromptTokens ?? usage.promptTokens);
  const usageCompletionTokens = normalizeTokenCount(
    usage.cumulativeCompletionTokens ?? usage.completionTokens,
  );
  const usageTotalTokens = normalizeTokenCount(usage.cumulativeTotalTokens ?? usage.totalTokens);

  if (
    typeof usagePromptTokens !== "number" &&
    typeof usageCompletionTokens !== "number" &&
    typeof usageTotalTokens !== "number"
  ) {
    return undefined;
  }

  return {
    usagePromptTokens,
    usageCompletionTokens,
    usageTotalTokens,
  };
};

export const useAgentChat = (): UseAgentChatResult => {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [modelLabel, setModelLabel] = useState(INITIAL_MODEL_LABEL);
  const [contextUsagePercent, setContextUsagePercent] = useState<number | null>(null);
  const [pendingToolConfirm, setPendingToolConfirm] = useState<
    (AgentToolConfirmEvent & { selectedAction: "approve" | "deny" }) | null
  >(null);

  const turnIdRef = useRef(1);
  const requestIdRef = useRef(0);
  const pendingToolConfirmResolverRef = useRef<((decision: AgentToolConfirmDecision) => void) | null>(null);

  const resolvePendingToolConfirm = useCallback((decision: AgentToolConfirmDecision) => {
    const resolver = pendingToolConfirmResolverRef.current;
    pendingToolConfirmResolverRef.current = null;
    setPendingToolConfirm(null);
    resolver?.(decision);
  }, []);

  useEffect(() => {
    let disposed = false;
    void getAgentModelLabel()
      .then((label) => {
        if (!disposed) {
          setModelLabel(label);
        }
      })
      .catch(() => {});

    return () => {
      disposed = true;
    };
  }, []);

  useEffect(() => {
    return () => {
      const resolver = pendingToolConfirmResolverRef.current;
      pendingToolConfirmResolverRef.current = null;
      resolver?.({
        approved: false,
        message: "Tool confirmation cancelled because the UI was closed.",
      });
    };
  }, []);

  const resetConversation = useCallback(() => {
    resolvePendingToolConfirm({
      approved: false,
      message: "Tool confirmation cancelled because the conversation was reset.",
    });
    requestIdRef.current += 1;
    setIsThinking(false);
    setTurns([]);
    setContextUsagePercent(null);
  }, [resolvePendingToolConfirm]);

  const appendSegment = useCallback(
    (turnId: number, segmentId: string, type: ReplySegmentType, chunk: string, data?: unknown) => {
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => {
          if (!turn.reply) {
            return turn;
          }
          return {
            ...turn,
            reply: {
              ...turn.reply,
              segments: orderReplySegments(
                appendToSegment(turn.reply.segments, segmentId, type, chunk, data),
              ),
            },
          };
        }),
      );
    },
    [],
  );

  const appendEventLine = useCallback((turnId: number, text: string) => {
    setTurns((prev) =>
      patchTurn(prev, turnId, (turn) => {
        if (!turn.reply) {
          return turn;
        }
        return {
          ...turn,
          reply: {
            ...turn.reply,
            segments: orderReplySegments(appendNoteLine(turn.reply.segments, `${turnId}:events`, text)),
          },
        };
      }),
    );
  }, []);

  const addTurn = useCallback(
    (prompt: string, withStreamingReply = false): number => {
      const turnId = turnIdRef.current++;
      setTurns((prev) => [
        ...prev,
        {
          id: turnId,
          prompt,
          createdAtMs: Date.now(),
          reply: withStreamingReply ? createStreamingReply(modelLabel) : undefined,
        },
      ]);
      return turnId;
    },
    [modelLabel],
  );

  const setImmediateReply = useCallback(
    (turnId: number, segments: Array<{ id: string; type: "thinking" | "text"; content: string }>) => {
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => ({
          ...turn,
          reply: {
            ...createStreamingReply(modelLabel),
            status: "done",
            durationSeconds: 0,
            segments,
          },
        })),
      );
    },
    [modelLabel],
  );

  const runCommand = useCallback(
    (commandText: string): boolean => {
      const command = resolveSlashCommand(commandText);
      if (!command) {
        return false;
      }

      if (command.action === "clear") {
        resetConversation();
        return true;
      }

      if (command.action === "exit") {
        requestExit(0);
        return true;
      }

      if (command.action === "help") {
        const turnId = addTurn(commandText.trim(), true);
        setImmediateReply(turnId, buildHelpSegments(turnId));
        return true;
      }

      const turnId = addTurn(commandText.trim(), true);
      setImmediateReply(turnId, buildUnsupportedSegments(turnId, command.name));
      return true;
    },
    [addTurn, resetConversation, setImmediateReply],
  );

  const submitInput = useCallback(() => {
    const text = inputValue.trim();
    if (!text || isThinking) {
      return;
    }

    setInputValue("");

    if (text.startsWith("/") && runCommand(text)) {
      return;
    }

    const turnId = addTurn(text, true);
    const currentRequestId = ++requestIdRef.current;
    const isCurrentRequest = () => currentRequestId === requestIdRef.current;

    // Reset context usage at the start of each request to avoid showing stale data
    setContextUsagePercent(null);
    setIsThinking(true);

    const baseHandlers = buildAgentEventHandlers({
      turnId,
      isCurrentRequest,
      appendSegment,
      appendEventLine,
    });
    const handlers = {
      ...baseHandlers,
      onToolConfirmRequest: (event: AgentToolConfirmEvent) => {
        if (!isCurrentRequest()) {
          return Promise.resolve({
            approved: false,
            message: "Tool confirmation denied because the request is no longer active.",
          });
        }

        if (pendingToolConfirmResolverRef.current) {
          pendingToolConfirmResolverRef.current({
            approved: false,
            message: "Superseded by a newer tool confirmation request.",
          });
          pendingToolConfirmResolverRef.current = null;
        }

        return new Promise<AgentToolConfirmDecision>((resolve) => {
          pendingToolConfirmResolverRef.current = resolve;
          setPendingToolConfirm({
            ...event,
            selectedAction: "approve",
          });
        });
      },
      onUsage: (event: AgentUsageEvent) => {
        if (!isCurrentRequest()) {
          return;
        }
        const normalized = normalizeContextUsagePercent(event.contextUsagePercent);
        if (normalized !== null) {
          setContextUsagePercent(normalized);
        }
        const replyUsage = toReplyUsage(event);
        if (!replyUsage) {
          return;
        }
        setTurns((prev) =>
          patchTurn(prev, turnId, (turn) => {
            if (!turn.reply) {
              return turn;
            }
            return {
              ...turn,
              reply: {
                ...turn.reply,
                ...replyUsage,
              },
            };
          }),
        );
      },
    };

    void runAgentPrompt(text, handlers)
      .then((result) => {
        if (!isCurrentRequest()) {
          return;
        }

        setModelLabel(result.modelLabel);
        if (result.usage) {
          const normalized = normalizeContextUsagePercent(result.usage.contextUsagePercent);
          if (normalized !== null) {
            setContextUsagePercent(normalized);
          }
        }
        const replyUsage = toReplyUsage(result.usage);
        setTurns((prev) => {
          const withFallbackText = patchTurn(prev, turnId, (turn) => {
            if (!turn.reply || !result.text) {
              return turn;
            }

            const hasAssistantText = turn.reply.segments.some(
              (segment) =>
                (segment.type === "text" || segment.type === "thinking") &&
                segment.content.trim().length > 0,
            );
            if (hasAssistantText) {
              return turn;
            }

            return {
              ...turn,
              reply: {
                ...turn.reply,
                segments: orderReplySegments(
                  appendToSegment(turn.reply.segments, `${turnId}:text`, "text", result.text),
                ),
              },
            };
          });

          return setReplyStatus(withFallbackText, turnId, "done", {
            durationSeconds: result.durationSeconds,
            completionReason: result.completionReason,
            completionMessage: result.completionMessage,
            modelLabel: result.modelLabel,
            ...(replyUsage ?? {}),
          });
        });
      })
      .catch((error) => {
        if (!isCurrentRequest()) {
          return;
        }
        appendEventLine(turnId, `[error] ${extractErrorMessage(error)}`);
        setTurns((prev) => setReplyStatus(prev, turnId, "error"));
      })
      .finally(() => {
        if (!isCurrentRequest()) {
          return;
        }
        setIsThinking(false);
      });
  }, [addTurn, appendEventLine, appendSegment, inputValue, isThinking, runCommand]);

  const clearInput = useCallback(() => {
    setInputValue("");
  }, []);

  const setModelLabelDisplay = useCallback((label: string) => {
    setModelLabel(label);
  }, []);

  const setToolConfirmSelection = useCallback((selection: "approve" | "deny") => {
    setPendingToolConfirm((current) => (current ? { ...current, selectedAction: selection } : current));
  }, []);

  const rejectPendingToolConfirm = useCallback(() => {
    resolvePendingToolConfirm({
      approved: false,
      message: "Tool call denied by user.",
    });
  }, [resolvePendingToolConfirm]);

  const submitToolConfirmSelection = useCallback(() => {
    if (!pendingToolConfirm) {
      return;
    }

    if (pendingToolConfirm.selectedAction === "deny") {
      rejectPendingToolConfirm();
      return;
    }

    resolvePendingToolConfirm({ approved: true });
  }, [pendingToolConfirm, rejectPendingToolConfirm, resolvePendingToolConfirm]);

  return {
    turns,
    inputValue,
    isThinking,
    modelLabel,
    contextUsagePercent,
    pendingToolConfirm,
    setInputValue,
    submitInput,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
    setToolConfirmSelection,
    submitToolConfirmSelection,
    rejectPendingToolConfirm,
  };
};
