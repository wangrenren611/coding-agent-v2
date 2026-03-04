/**
 * 流解析器工具
 *
 * 处理 SSE（服务器发送事件）流解析，用于 LLM 流式响应。
 */

import type { Chunk } from '../types';

/**
 * SSE（服务器发送事件）的流解析器
 */
export class StreamParser {
  /**
   * 解析 SSE 行并提取数据
   * 对于空行、注释或非数据行返回 null
   */
  static parseSseLine(line: string): string | null {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith(':')) {
      return null;
    }
    if (trimmed.startsWith('data:')) {
      return trimmed.slice(5).trim();
    }
    if (trimmed.startsWith('{')) {
      return trimmed;
    }
    return null;
  }

  /**
   * 检查数据是否指示流结束
   */
  static isStreamEnd(data: string): boolean {
    return data === '[DONE]';
  }

  /**
   * 安全地解析 JSON，失败时返回 null
   */
  static safeJsonParse<T>(data: string): T | null {
    try {
      return JSON.parse(data) as T;
    } catch {
      return null;
    }
  }

  /**
   * 处理可读流并返回 AsyncGenerator
   *
   * 注意：使用 try/finally 确保在生成器被提前终止时（如 break 或 return）
   * reader 能够被正确释放，避免流锁定问题
   *
   * @param reader - 可读流读取器
   * @returns 异步生成器，每次 yield 一个 chunk
   */
  static async *parseAsync(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<Chunk> {
    const decoder = new TextDecoder();
    let buffer = '';
    let shouldStop = false;

    try {
      while (!shouldStop) {
        const { done, value } = await reader.read();

        if (done) {
          // 处理流结束时剩余的缓冲区
          if (buffer.trim()) {
            const data = this.parseSseLine(buffer);
            if (data && !this.isStreamEnd(data)) {
              const chunk = this.safeJsonParse<Chunk>(data);
              if (chunk) yield chunk;
            }
          }
          break;
        }

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split(/[\r\n]+/);
        buffer = lines.pop() ?? '';

        for (const line of lines) {
          const data = this.parseSseLine(line);

          if (!data) continue;

          if (this.isStreamEnd(data)) {
            shouldStop = true;
            break;
          }

          const chunk = this.safeJsonParse<Chunk>(data);
          if (!chunk) continue;

          yield chunk;
        }
      }
    } finally {
      // 确保在生成器结束时释放 reader 锁
      // 这样即使消费者提前 break，也不会导致流被锁定
      try {
        reader.releaseLock();
      } catch {
        // 忽略释放锁时的错误（如流已关闭）
      }
    }
  }
}
