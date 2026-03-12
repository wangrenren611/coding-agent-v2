import { z } from 'zod';
import { BaseTool, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import { WEB_FETCH_TOOL_DESCRIPTION } from './tool-prompts';
import type { ToolExecutionContext } from './types';

// 安全常量
const MAX_RESPONSE_SIZE = 5 * 1024 * 1024; // 5MB
const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;

// SSRF 防护：禁止访问的地址模式
const BLOCKED_HOST_PATTERNS: RegExp[] = [
  // localhost 和回环地址
  /^(localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])$/i,
  // 内网 IP
  /^10\./,
  /^172\.(1[6-9]|2[0-9]|3[0-1])\./,
  /^192\.168\./,
  // 链路本地和云元数据地址
  /^169\.254\./,
  /^(metadata\.google\.internal|metadata\.azure|169\.254\.169\.254)$/i,
];

/**
 * 检查 URL 是否为内网或敏感地址（SSRF 防护）
 */
function isBlockedAddress(url: string): { blocked: boolean; reason?: string } {
  try {
    const parsed = new URL(url);
    const hostname = parsed.hostname.toLowerCase();

    for (const pattern of BLOCKED_HOST_PATTERNS) {
      if (pattern.test(hostname)) {
        return { blocked: true, reason: `Blocked address: ${hostname}` };
      }
    }

    // 检查协议
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return { blocked: true, reason: `Unsupported protocol: ${parsed.protocol}` };
    }

    return { blocked: false };
  } catch {
    return { blocked: true, reason: 'Invalid URL format' };
  }
}

/**
 * 安全地截断输出，避免内存溢出
 */
function truncateOutput(
  content: string,
  maxLength: number
): { output: string; truncated: boolean } {
  if (content.length <= maxLength) {
    return { output: content, truncated: false };
  }

  const marker = '\n\n[... Content Truncated ...]\n\n';
  const available = maxLength - marker.length;
  if (available <= 100) {
    return { output: content.slice(0, maxLength), truncated: true };
  }

  const headLength = Math.floor(available * 0.7);
  const tailLength = available - headLength;

  return {
    output: content.slice(0, headLength) + marker + content.slice(content.length - tailLength),
    truncated: true,
  };
}

/**
 * 简单的 HTML 到纯文本转换（无外部依赖）
 */
function htmlToText(html: string): string {
  let text = html;
  // 移除 script 和 style 标签
  text = text.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // 移除 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  // 解码常见 HTML 实体
  const entities: Record<string, string> = {
    '&nbsp;': ' ',
    '&amp;': '&',
    '&lt;': '<',
    '&gt;': '>',
    '&quot;': '"',
    '&#39;': "'",
    '&apos;': "'",
  };
  for (const [entity, char] of Object.entries(entities)) {
    text = text.replace(new RegExp(entity, 'g'), char);
  }
  // 清理多余空白
  return text.replace(/\s+/g, ' ').trim();
}

const schema = z
  .object({
    url: z.string().url().describe('The URL to fetch'),
    extractMode: z
      .enum(['text', 'markdown', 'html'])
      .default('text')
      .describe('Content extraction mode: text (plain text), markdown (simplified), or html (raw)'),
    maxChars: z
      .number()
      .int()
      .min(100)
      .max(100_000)
      .default(30_000)
      .describe('Maximum characters to return'),
    timeout: z
      .number()
      .int()
      .min(1000)
      .max(MAX_TIMEOUT_MS)
      .default(DEFAULT_TIMEOUT_MS)
      .describe('Request timeout in milliseconds'),
  })
  .strict();

export class WebFetchTool extends BaseTool<typeof schema> {
  readonly name = 'web_fetch';
  readonly description = WEB_FETCH_TOOL_DESCRIPTION;
  readonly parameters = schema;

  async execute(
    args: z.input<typeof schema>,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    // Apply defaults (zod defaults may not be applied when calling execute directly)
    const url = args.url;
    const extractMode = args.extractMode ?? 'text';
    const maxChars = args.maxChars ?? 30_000;
    const timeout = args.timeout ?? DEFAULT_TIMEOUT_MS;

    // SSRF 防护检查
    const blockCheck = isBlockedAddress(url);
    if (blockCheck.blocked) {
      throw new ToolExecutionError(`Security: ${blockCheck.reason}`, 2010);
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    try {
      const response = await fetch(url, {
        signal: controller.signal,
        headers: {
          'User-Agent': 'Mozilla/5.0 (compatible; AgentBot/1.0)',
          Accept: 'text/html,text/plain,application/json,*/*',
        },
        redirect: 'follow',
      });

      if (!response.ok) {
        throw new ToolExecutionError(`HTTP ${response.status}: ${response.statusText}`, 2011);
      }

      // 检查内容大小
      const contentLength = response.headers.get('content-length');
      if (contentLength && parseInt(contentLength) > MAX_RESPONSE_SIZE) {
        throw new ToolExecutionError(
          `Response too large: ${contentLength} bytes exceeds limit of ${MAX_RESPONSE_SIZE}`,
          2012
        );
      }

      const contentType = response.headers.get('content-type') || '';
      let body = await response.text();

      // 限制响应大小
      if (body.length > MAX_RESPONSE_SIZE) {
        body = body.slice(0, MAX_RESPONSE_SIZE);
      }

      // 根据模式提取内容
      let extractedContent: string;
      switch (extractMode) {
        case 'html':
          extractedContent = body;
          break;
        case 'markdown':
        case 'text':
        default:
          extractedContent = htmlToText(body);
          break;
      }

      // 截断到指定长度
      const { output, truncated } = truncateOutput(extractedContent, maxChars);

      return {
        success: true,
        output: `URL: ${url}\nContent-Type: ${contentType}\nExtracted: ${extractMode}\n${truncated ? '(Content truncated)\n' : ''}\n${output}`,
        metadata: {
          url,
          contentType,
          extractMode,
          truncated,
          originalLength: extractedContent.length,
          returnedLength: output.length,
        },
      };
    } catch (error) {
      if (error instanceof ToolExecutionError) {
        throw error;
      }
      if (error instanceof Error && error.name === 'AbortError') {
        throw new ToolExecutionError(`Request timeout after ${timeout}ms`, 2013);
      }
      throw new ToolExecutionError(
        `Fetch failed: ${error instanceof Error ? error.message : String(error)}`,
        2014
      );
    } finally {
      clearTimeout(timeoutId);
    }
  }
}

export default WebFetchTool;
