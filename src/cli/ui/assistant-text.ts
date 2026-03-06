export function mergeAssistantText(streamedText: string, finalText: string): string {
  const streamed = streamedText;
  const finalValue = finalText;

  if (!streamed.trim()) {
    return finalValue;
  }
  if (!finalValue.trim()) {
    return streamed;
  }
  if (streamed === finalValue) {
    return streamed;
  }
  if (finalValue.startsWith(streamed)) {
    return finalValue;
  }
  if (streamed.startsWith(finalValue)) {
    return streamed;
  }

  const maxOverlap = Math.min(streamed.length, finalValue.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (streamed.slice(-overlap) === finalValue.slice(0, overlap)) {
      return `${streamed}${finalValue.slice(overlap)}`;
    }
  }

  return finalValue.length >= streamed.length ? finalValue : streamed;
}

export function shouldStartNewAssistantMessage(step: {
  finishReason?: string;
  toolCallsCount: number;
}): boolean {
  if (step.finishReason === 'tool_calls') {
    return true;
  }
  if (!step.finishReason && step.toolCallsCount > 0) {
    return true;
  }
  return false;
}
