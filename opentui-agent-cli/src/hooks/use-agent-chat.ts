import { useCallback, useEffect, useRef, useState } from "react";

import { resolveSlashCommand } from "../commands/slash-commands";
import { getAgentModelLabel, runAgentPrompt } from "../agent/runtime/runtime";
import { requestExit } from "../runtime/exit";
import type { ChatTurn, ReplySegmentType } from "../types/chat";
import { buildAgentEventHandlers } from "./agent-event-handlers";
import { buildHelpSegments, buildUnsupportedSegments, extractErrorMessage } from "./chat-local-replies";
import {
  appendNoteLine,
  appendToSegment,
  createStreamingReply,
  patchTurn,
  setReplyStatus,
} from "./turn-updater";

export type UseAgentChatResult = {
  turns: ChatTurn[];
  inputValue: string;
  isThinking: boolean;
  modelLabel: string;
  setInputValue: (value: string) => void;
  submitInput: () => void;
  clearInput: () => void;
  resetConversation: () => void;
  setModelLabelDisplay: (label: string) => void;
};

const INITIAL_MODEL_LABEL = process.env.AGENT_MODEL?.trim() || "glm-5";

export const useAgentChat = (): UseAgentChatResult => {
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [modelLabel, setModelLabel] = useState(INITIAL_MODEL_LABEL);

  const turnIdRef = useRef(1);
  const requestIdRef = useRef(0);

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

  const resetConversation = useCallback(() => {
    requestIdRef.current += 1;
    setIsThinking(false);
    setTurns([]);
  }, []);

  const appendSegment = useCallback(
    (turnId: number, segmentId: string, type: ReplySegmentType, chunk: string) => {
      setTurns((prev) =>
        patchTurn(prev, turnId, (turn) => {
          if (!turn.reply) {
            return turn;
          }
          return {
            ...turn,
            reply: {
              ...turn.reply,
              segments: appendToSegment(turn.reply.segments, segmentId, type, chunk),
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
            segments: appendNoteLine(turn.reply.segments, `${turnId}:events`, text),
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

    setIsThinking(true);

    const handlers = buildAgentEventHandlers({
      turnId,
      isCurrentRequest,
      appendSegment,
      appendEventLine,
    });

    void runAgentPrompt(text, handlers)
      .then((result) => {
        if (!isCurrentRequest()) {
          return;
        }

        setModelLabel(result.modelLabel);
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
                segments: appendToSegment(turn.reply.segments, `${turnId}:text`, "text", result.text),
              },
            };
          });

          return setReplyStatus(withFallbackText, turnId, "done", {
            durationSeconds: result.durationSeconds,
            completionReason: result.completionReason,
            completionMessage: result.completionMessage,
            modelLabel: result.modelLabel,
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

  return {
    turns,
    inputValue,
    isThinking,
    modelLabel,
    setInputValue,
    submitInput,
    clearInput,
    resetConversation,
    setModelLabelDisplay,
  };
};
