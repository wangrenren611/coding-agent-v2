import { readFile } from 'node:fs/promises';
import { basename, extname } from 'node:path';

import type { InputContentPart, MessageContent } from '../../../src/providers';
import type { PromptFileSelection } from './types';

const IMAGE_MIME_BY_EXTENSION: Record<string, string> = {
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
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
  return IMAGE_MIME_BY_EXTENSION[extension] ?? FALLBACK_FILE_MIME;
};

const isImageMimeType = (mimeType: string) => mimeType.startsWith('image/');

const isProbablyText = (buffer: Uint8Array) => {
  const sample = buffer.subarray(0, Math.min(buffer.length, 8000));
  let suspicious = 0;
  for (const value of sample) {
    if (value === 0) {
      return false;
    }
    if (value < 0x09 || (value > 0x0d && value < 0x20)) {
      suspicious += 1;
    }
  }
  return suspicious <= sample.length * 0.1;
};

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

const toBinaryParts = (file: PromptFileSelection, buffer: Uint8Array): InputContentPart[] => {
  return [
    {
      type: 'text',
      text: `Attached binary file: ${file.relativePath}`,
    },
    {
      type: 'file',
      file: {
        filename: basename(file.relativePath),
        file_data: Buffer.from(buffer).toString('base64'),
      },
    },
  ];
};

const toFileParts = async (file: PromptFileSelection): Promise<InputContentPart[]> => {
  const buffer = await readFile(file.absolutePath);
  if (buffer.byteLength > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachment too large: ${file.relativePath}`);
  }

  const mimeType = inferMimeType(file.relativePath);
  if (isImageMimeType(mimeType)) {
    return [
      {
        type: 'text',
        text: `Attached image: ${file.relativePath}`,
      },
      toImagePart(file, buffer),
    ];
  }

  if (isProbablyText(buffer)) {
    return [toTextPart(file, buffer)];
  }

  return toBinaryParts(file, buffer);
};

export const buildPromptContent = async (
  prompt: string,
  files: PromptFileSelection[]
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
    parts.push(...(await toFileParts(file)));
  }

  return parts;
};
