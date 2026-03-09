import { describe, expect, it } from 'vitest';
import * as utils from '../index';
import * as messageUtils from '../message';
import { estimateTokens } from '../token';

describe('utils index exports', () => {
  it('re-exports message and token helpers', () => {
    expect(utils.contentToText).toBe(messageUtils.contentToText);
    expect(utils.stringifyContentPart).toBe(messageUtils.stringifyContentPart);
    expect(utils.getAssistantToolCalls).toBe(messageUtils.getAssistantToolCalls);
    expect(utils.getToolCallId).toBe(messageUtils.getToolCallId);
    expect(utils.isSummaryMessage).toBe(messageUtils.isSummaryMessage);
    expect(utils.splitMessages).toBe(messageUtils.splitMessages);
    expect(utils.processToolCallPairs).toBe(messageUtils.processToolCallPairs);
    expect(utils.rebuildMessages).toBe(messageUtils.rebuildMessages);
    expect(utils.estimateTokens).toBe(estimateTokens);
  });
});
