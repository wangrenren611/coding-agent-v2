import { readFile } from 'node:fs/promises';
import { extname } from 'node:path';

import type { InputContentPart, MessageContent } from '../types/message-content';
import type { PromptFileSelection } from './types';
import {
  type AttachmentModelCapabilities,
  isAudioSelection,
  isImageSelection,
  isVideoSelection,
} from './attachment-capabilities';

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
};

const VIDEO_MIME_BY_EXTENSION: Record<string, string> = {
  '.avi': 'video/x-msvideo',
  '.m4v': 'video/mp4',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
};

const AUDIO_MIME_BY_EXTENSION: Record<string, string> = {
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.m4a': 'audio/mp4',
  '.mp3': 'audio/mpeg',
  '.ogg': 'audio/ogg',
  '.wav': 'audio/wav',
};

const FALLBACK_FILE_MIME = 'application/octet-stream';
const MAX_ATTACHMENT_BYTES = 2 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_CHARS = 80_000;
const TEXT_DECODER = new TextDecoder('utf-8', { fatal: false });

const formatFileFence = (path: string, content: string, truncated: boolean) => {
  const suffix = truncated ? '\n\n[truncated for prompt size]' : '';
  return `Attached file: ${path}\n\n\`\`\`\n${content}\n\`\`\`${suffix}`;
};

const inferMimeType = (path: string) => {
  const extension = extname(path).toLowerCase();
  return (
    IMAGE_MIME_BY_EXTENSION[extension] ??
    VIDEO_MIME_BY_EXTENSION[extension] ??
    AUDIO_MIME_BY_EXTENSION[extension] ??
    FALLBACK_FILE_MIME
  );
};

const isImageMimeType = (mimeType: string) => mimeType.startsWith('image/');
const isAudioMimeType = (mimeType: string) => mimeType.startsWith('audio/');
const isVideoMimeType = (mimeType: string) => mimeType.startsWith('video/');

const toImagePart = (file: PromptFileSelection, buffer: Uint8Array): InputContentPart => {
  const mimeType = inferMimeType(file.relativePath);
  const dataUrl = `data:${mimeType};base64,${Buffer.from(buffer).toString('base64')}`;
  return {
    type: 'image_url',
    image_url: {
      url: dataUrl,
      detail: 'auto',
    },
  };
};

const toTextPart = (file: PromptFileSelection, buffer: Uint8Array): InputContentPart => {
  const rawText = TEXT_DECODER.decode(buffer);
  const normalized = rawText.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
  const truncated = normalized.length > MAX_TEXT_ATTACHMENT_CHARS;
  const content = truncated ? normalized.slice(0, MAX_TEXT_ATTACHMENT_CHARS) : normalized;
  return {
    type: 'text',
    text: formatFileFence(file.relativePath, content, truncated),
  };
};

const toAudioTextPart = (file: PromptFileSelection): InputContentPart => {
  return {
    type: 'text',
    text: `Attached audio: ${file.relativePath}`,
  };
};

const toVideoTextPart = (file: PromptFileSelection): InputContentPart => {
  return {
    type: 'text',
    text: `Attached video: ${file.relativePath}`,
  };
};

const toFileParts = async (
  file: PromptFileSelection,
  capabilities: AttachmentModelCapabilities
): Promise<InputContentPart[]> => {
  const buffer = await readFile(file.absolutePath);
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment too large: ${file.relativePath}`);
  }

  const mimeType = inferMimeType(file.relativePath);
  if (isImageMimeType(mimeType) && capabilities.image && isImageSelection(file)) {
    return [
      {
        type: 'text',
        text: `Attached image: ${file.relativePath}`,
      },
      toImagePart(file, buffer),
    ];
  }

  if (isAudioMimeType(mimeType) && capabilities.audio && isAudioSelection(file)) {
    return [toAudioTextPart(file)];
  }

  if (isVideoMimeType(mimeType) && capabilities.video && isVideoSelection(file)) {
    return [toVideoTextPart(file)];
  }

  return [toTextPart(file, buffer)];
};

export const buildPromptContent = async (
  prompt: string,
  files: PromptFileSelection[],
  capabilities: AttachmentModelCapabilities
): Promise<MessageContent> => {
  if (files.length === 0) {
    return prompt;
  }

  const parts: InputContentPart[] = [];
  if (prompt.trim().length > 0) {
    parts.push({
      type: 'text',
      text: prompt,
    });
  }

  for (const file of files) {
    parts.push(...(await toFileParts(file, capabilities)));
  }

  return parts;
};
