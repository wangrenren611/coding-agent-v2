import type {
  AgentEventHandlers,
  AgentToolConfirmDecision,
  AgentToolConfirmEvent,
} from "./types";

const toBoolean = (raw?: string): boolean | undefined => {
  if (!raw) {
    return undefined;
  }
  const value = raw.trim().toLowerCase();
  if (["1", "true", "yes", "y", "on"].includes(value)) {
    return true;
  }
  if (["0", "false", "no", "n", "off"].includes(value)) {
    return false;
  }
  return undefined;
};

export const resolveAutoToolDecision = (
  rawValue = process.env.AGENT_AUTO_CONFIRM_TOOLS,
): AgentToolConfirmDecision | null => {
  const parsed = toBoolean(rawValue);
  if (parsed === true) {
    return { approved: true };
  }
  if (parsed === false) {
    return {
      approved: false,
      message: "Tool call denied by AGENT_AUTO_CONFIRM_TOOLS.",
    };
  }
  return null;
};

const DEFAULT_FALLBACK_DECISION: AgentToolConfirmDecision = { approved: true };

export const resolveToolConfirmDecision = async (
  event: AgentToolConfirmEvent,
  handlers: AgentEventHandlers,
  rawAutoDecision = process.env.AGENT_AUTO_CONFIRM_TOOLS,
): Promise<AgentToolConfirmDecision> => {
  const autoDecision = resolveAutoToolDecision(rawAutoDecision);
  if (autoDecision) {
    return autoDecision;
  }

  if (!handlers.onToolConfirmRequest) {
    return DEFAULT_FALLBACK_DECISION;
  }

  const decision = await handlers.onToolConfirmRequest(event);
  return decision ?? { approved: false, message: "Tool confirmation was not resolved." };
};
