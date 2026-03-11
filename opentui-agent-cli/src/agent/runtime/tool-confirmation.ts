import type { AgentEventHandlers, AgentToolConfirmDecision, AgentToolConfirmEvent } from './types';

const DEFAULT_FALLBACK_DECISION: AgentToolConfirmDecision = { approved: true };

export const resolveToolConfirmDecision = async (
  event: AgentToolConfirmEvent,
  handlers: AgentEventHandlers
): Promise<AgentToolConfirmDecision> => {
  if (!handlers.onToolConfirmRequest) {
    return DEFAULT_FALLBACK_DECISION;
  }

  const decision = await handlers.onToolConfirmRequest(event);
  return decision ?? { approved: false, message: 'Tool confirmation was not resolved.' };
};
