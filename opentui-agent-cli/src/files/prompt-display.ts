import type { PromptFileSelection } from './types';

export const buildPromptDisplay = (prompt: string, files: PromptFileSelection[]): string => {
  const normalizedPrompt = prompt.trim();
  if (normalizedPrompt.length > 0) {
    return normalizedPrompt;
  }
  return files.length > 0 ? 'Attached files' : '';
};
