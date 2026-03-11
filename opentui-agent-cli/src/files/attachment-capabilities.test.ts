import { describe, expect, it } from 'bun:test';

import {
  DEFAULT_ATTACHMENT_MODEL_CAPABILITIES,
  resolveAttachmentModelCapabilities,
} from './attachment-capabilities';

describe('attachment-capabilities', () => {
  it('defaults all modalities to false when model config omits them', () => {
    expect(resolveAttachmentModelCapabilities(undefined)).toEqual(
      DEFAULT_ATTACHMENT_MODEL_CAPABILITIES
    );
  });

  it('maps explicit modality flags from model config', () => {
    expect(
      resolveAttachmentModelCapabilities({
        modalities: {
          image: true,
          audio: false,
          video: true,
        },
      })
    ).toEqual({
      image: true,
      audio: false,
      video: true,
    });
  });
});
