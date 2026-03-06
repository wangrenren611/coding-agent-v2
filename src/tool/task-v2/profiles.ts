import type { SubAgentConfigSnapshot, SubAgentMemoryMode } from './types';

export interface SubAgentProfile {
  id: string;
  name: string;
  version: number;
  description: string;
  systemPrompt: string;
  outputContract?: string;
  maxSteps: number;
  timeoutMs?: number;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  memoryMode: SubAgentMemoryMode;
  metadata?: Record<string, unknown>;
}

export interface SubAgentProfileOverrides {
  systemPrompt?: string;
  outputContract?: string;
  maxSteps?: number;
  timeoutMs?: number;
  toolAllowlist?: string[];
  toolDenylist?: string[];
  memoryMode?: SubAgentMemoryMode;
}

const DEFAULT_PROFILE_VERSION = 1;

export const DEFAULT_SUBAGENT_PROFILES: Record<string, SubAgentProfile> = {
  'general-purpose': {
    id: 'general-purpose',
    name: 'General Purpose',
    version: DEFAULT_PROFILE_VERSION,
    description: 'Balanced coding and analysis profile for general tasks.',
    systemPrompt:
      'You are a pragmatic software engineering assistant. Solve the delegated task and verify key outcomes.',
    maxSteps: 100,
    timeoutMs: 10 * 60_000,
    toolAllowlist: ['bash', 'file', 'glob', 'grep', 'skill'],
    memoryMode: 'isolated',
  },
  bash: {
    id: 'bash',
    name: 'Bash Specialist',
    version: DEFAULT_PROFILE_VERSION,
    description: 'Shell-focused execution profile.',
    systemPrompt:
      'You are a shell-focused engineering assistant. Execute commands safely and summarize results clearly.',
    maxSteps: 40,
    timeoutMs: 5 * 60_000,
    toolAllowlist: ['bash', 'file', 'glob', 'grep'],
    memoryMode: 'isolated',
  },
  explore: {
    id: 'explore',
    name: 'Explore',
    version: DEFAULT_PROFILE_VERSION,
    description: 'Codebase exploration and context gathering profile.',
    systemPrompt:
      'You are a code exploration assistant. Gather accurate context, cite relevant files, and avoid assumptions.',
    maxSteps: 60,
    timeoutMs: 10 * 60_000,
    toolAllowlist: ['file', 'glob', 'grep', 'bash', 'skill'],
    memoryMode: 'isolated',
  },
  plan: {
    id: 'plan',
    name: 'Planner',
    version: DEFAULT_PROFILE_VERSION,
    description: 'Planning and architecture profile.',
    systemPrompt:
      'You are an architecture planner. Produce actionable implementation plans with risks and acceptance criteria.',
    maxSteps: 50,
    timeoutMs: 8 * 60_000,
    toolAllowlist: ['file', 'glob', 'grep', 'skill'],
    memoryMode: 'isolated',
  },
  'ui-sketcher': {
    id: 'ui-sketcher',
    name: 'UI Sketcher',
    version: DEFAULT_PROFILE_VERSION,
    description: 'UI interaction and layout profile.',
    systemPrompt:
      'You are a UI blueprint assistant. Translate requirements into concrete interaction and layout guidance.',
    maxSteps: 50,
    timeoutMs: 8 * 60_000,
    toolAllowlist: ['file', 'glob', 'grep', 'bash'],
    memoryMode: 'isolated',
  },
  'bug-analyzer': {
    id: 'bug-analyzer',
    name: 'Bug Analyzer',
    version: DEFAULT_PROFILE_VERSION,
    description: 'Debugging and root-cause analysis profile.',
    systemPrompt:
      'You are a debugging specialist. Trace execution paths and identify root cause with minimal-risk fixes.',
    maxSteps: 60,
    timeoutMs: 12 * 60_000,
    toolAllowlist: ['bash', 'file', 'glob', 'grep', 'skill'],
    memoryMode: 'isolated',
  },
  'code-reviewer': {
    id: 'code-reviewer',
    name: 'Code Reviewer',
    version: DEFAULT_PROFILE_VERSION,
    description: 'Code review profile focused on quality and safety.',
    systemPrompt:
      'You are a code reviewer focused on correctness, security, reliability, and performance.',
    maxSteps: 60,
    timeoutMs: 10 * 60_000,
    toolAllowlist: ['file', 'glob', 'grep', 'bash'],
    memoryMode: 'isolated',
  },
};

export function listSubAgentProfiles(): SubAgentProfile[] {
  return Object.values(DEFAULT_SUBAGENT_PROFILES).map((profile) => ({
    ...profile,
    toolAllowlist: profile.toolAllowlist ? [...profile.toolAllowlist] : undefined,
    toolDenylist: profile.toolDenylist ? [...profile.toolDenylist] : undefined,
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
  }));
}

export function getSubAgentProfile(profileId: string): SubAgentProfile | null {
  const profile = DEFAULT_SUBAGENT_PROFILES[profileId];
  if (!profile) {
    return null;
  }
  return {
    ...profile,
    toolAllowlist: profile.toolAllowlist ? [...profile.toolAllowlist] : undefined,
    toolDenylist: profile.toolDenylist ? [...profile.toolDenylist] : undefined,
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
  };
}

function dedupe(names?: string[]): string[] | undefined {
  if (!names) return undefined;
  const normalized = names
    .map((name) => name.trim())
    .filter((name) => name.length > 0)
    .map((name) => name.toLowerCase());
  if (normalized.length === 0) return undefined;
  return Array.from(new Set(normalized));
}

export function resolveSubAgentConfigSnapshot(params: {
  profile: SubAgentProfile;
  overrides?: SubAgentProfileOverrides;
  timeoutMs?: number;
}): SubAgentConfigSnapshot {
  const { profile, overrides } = params;
  const timeoutMs = params.timeoutMs ?? overrides?.timeoutMs ?? profile.timeoutMs;
  const toolAllowlist = dedupe(overrides?.toolAllowlist ?? profile.toolAllowlist);
  const toolDenylist = dedupe(overrides?.toolDenylist ?? profile.toolDenylist);

  return {
    profileId: profile.id,
    profileName: profile.name,
    profileVersion: profile.version,
    systemPrompt: overrides?.systemPrompt ?? profile.systemPrompt,
    outputContract: overrides?.outputContract ?? profile.outputContract,
    maxSteps: overrides?.maxSteps ?? profile.maxSteps,
    timeoutMs,
    toolAllowlist,
    toolDenylist,
    memoryMode: overrides?.memoryMode ?? profile.memoryMode,
    metadata: profile.metadata ? { ...profile.metadata } : undefined,
  };
}
