import { describe, expect, it } from 'vitest';

import { Models, ProviderRegistry } from '../../index';

describe('providers module exports', () => {
  it('should expose model IDs from registry', () => {
    const ids = ProviderRegistry.getModelIds();
    expect(ids.length).toBeGreaterThan(0);
    expect(ids).toContain('glm-4.7');
  });

  it('should expose convenience model accessors', () => {
    expect(Models.glm47.id).toBe('glm-4.7');
    expect(Models.kimiK25.provider).toBe('kimi');
  });
});
