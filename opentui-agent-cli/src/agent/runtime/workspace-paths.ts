import { resolve } from 'node:path';

export const resolveRepoRoot = () => {
  const explicit = process.env.AGENT_REPO_ROOT?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
};

export const resolveWorkspaceRoot = () => {
  const explicit = process.env.AGENT_WORKDIR?.trim();
  if (explicit) {
    return resolve(explicit);
  }
  return resolve(process.cwd());
};
