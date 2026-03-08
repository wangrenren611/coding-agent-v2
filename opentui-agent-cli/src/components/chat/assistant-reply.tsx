import { TextAttributes } from "@opentui/core";

import type { AssistantReply as AssistantReplyType } from "../../types/chat";
import { uiTheme } from "../../ui/theme";
import { AssistantSegment } from "./assistant-segment";

type AssistantReplyProps = {
  reply: AssistantReplyType;
};

const renderStatus = (status: AssistantReplyType["status"]) => {
  if (status === "streaming") {
    return "streaming";
  }
  if (status === "error") {
    return "error";
  }
  return undefined;
};

export const AssistantReply = ({ reply }: AssistantReplyProps) => {
  const status = renderStatus(reply.status);

  return (
    <box flexDirection="column" gap={1}>
      {reply.segments.map((segment) => (
        <AssistantSegment key={segment.id} segment={segment} />
      ))}
      <box flexDirection="row" gap={1}>
        {/* <text fg={uiTheme.accent}>[]</text> */}
        {/* <text fg={uiTheme.text} attributes={TextAttributes.BOLD}>
          {reply.agentLabel}
        </text> */}
        <text fg={uiTheme.muted}>
          {reply.modelLabel} . {reply.durationSeconds.toFixed(1)}s
          {status ? ` . ${status}` : ""}
        </text>
      </box>
    </box>
  );
};
