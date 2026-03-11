import type { PromptFileSelection } from './types';

export type AttachmentModelCapabilities = {
  image: boolean;
  audio: boolean;
  video: boolean;
};

export const DEFAULT_ATTACHMENT_MODEL_CAPABILITIES: AttachmentModelCapabilities = {
  image: false,
  audio: false,
  video: false,
};

const normalizeFlag = (value: boolean | undefined): boolean => value === true;

export const resolveAttachmentModelCapabilities = (modelConfig: {
  modalities?: {
    image?: boolean;
    audio?: boolean;
    video?: boolean;
  };
} | null | undefined): AttachmentModelCapabilities => {
  return {
    image: normalizeFlag(modelConfig?.modalities?.image),
    audio: normalizeFlag(modelConfig?.modalities?.audio),
    video: normalizeFlag(modelConfig?.modalities?.video),
  };
};

export const isImageSelection = (file: PromptFileSelection): boolean => {
  return /\.(gif|jpe?g|png|webp)$/i.test(file.relativePath);
};

export const isAudioSelection = (file: PromptFileSelection): boolean => {
  return /\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(file.relativePath);
};

export const isVideoSelection = (file: PromptFileSelection): boolean => {
  return /\.(mp4|mov|webm|m4v|avi|mkv)$/i.test(file.relativePath);
};

export const isMediaSelection = (file: PromptFileSelection): boolean => {
  return isImageSelection(file) || isAudioSelection(file) || isVideoSelection(file);
};
