import { describe, expect, it } from 'vitest';
import { listSubAgentProfiles as listV3Profiles } from '../task-v3/profiles';

const REQUIRED_FILE_TOOLS = ['file_read', 'file_write', 'file_edit', 'file_stat'];

function assertFileToolsInAllowlist(
  profiles: Array<{ id: string; toolAllowlist?: string[] }>
): void {
  for (const profile of profiles) {
    const allowlist = profile.toolAllowlist ?? [];
    expect(allowlist, `profile ${profile.id} should not include legacy file tool`).not.toContain(
      'file'
    );
    expect(allowlist, `profile ${profile.id} should include split file tools`).toEqual(
      expect.arrayContaining(REQUIRED_FILE_TOOLS)
    );
  }
}

describe('task profile tool allowlists', () => {
  it('task-v3 profiles include split file tools', () => {
    const profiles = listV3Profiles();
    assertFileToolsInAllowlist(profiles);
  });
});
