import type { PromptFileSelection } from './types';

const formatSelectedFiles = (files: PromptFileSelection[]) => {
  return files.map(file => `@${file.relativePath}`).join(' ');
};

export const buildPromptDisplay = (prompt: string, files: PromptFileSelection[]): string => {
  const normalizedPrompt = prompt.trim();
  if (normalizedPrompt.length > 0) {
    return normalizedPrompt;
  }
  return files.length > 0 ? formatSelectedFiles(files) : '';
};
