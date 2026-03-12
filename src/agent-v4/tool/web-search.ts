import { z } from 'zod';
import { BaseTool, ToolResult } from './base-tool';
import { ToolExecutionError } from './error';
import { WEB_SEARCH_TOOL_DESCRIPTION } from './tool-prompts';
import type { ToolExecutionContext } from './types';

// 搜索结果接口
interface SearchResult {
  title: string;
  url: string;
  snippet: string;
  score?: number;
}

interface SearchResponse {
  query: string;
  results: SearchResult[];
  provider: string;
}

/**
 * Tavily 搜索实现
 */
async function searchWithTavily(query: string, maxResults: number): Promise<SearchResponse> {
  const apiKey = process.env.TAVILY_API_KEY;
  if (!apiKey) {
    throw new ToolExecutionError('TAVILY_API_KEY environment variable is not set', 2020);
  }

  const response = await fetch('https://api.tavily.com/search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      query,
      max_results: maxResults,
      search_depth: 'basic',
      include_answer: false,
      include_raw_content: false,
    }),
  });

  if (!response.ok) {
    throw new ToolExecutionError(
      `Tavily API error: ${response.status} ${response.statusText}`,
      2021
    );
  }

  const data = (await response.json()) as {
    query?: string;
    results?: Array<{ title?: string; url?: string; content?: string; score?: number }>;
  };

  return {
    query: data.query || query,
    provider: 'tavily',
    results: (data.results || []).map((r) => ({
      title: r.title || 'No title',
      url: r.url || '',
      snippet: r.content || '',
      score: r.score,
    })),
  };
}

/**
 * Brave Search 实现
 */
async function searchWithBrave(query: string, maxResults: number): Promise<SearchResponse> {
  const apiKey = process.env.BRAVE_SEARCH_API_KEY;
  if (!apiKey) {
    throw new ToolExecutionError('BRAVE_SEARCH_API_KEY environment variable is not set', 2022);
  }

  const url = new URL('https://api.search.brave.com/res/v1/web/search');
  url.searchParams.set('q', query);
  url.searchParams.set('count', String(maxResults));

  const response = await fetch(url.toString(), {
    headers: {
      Accept: 'application/json',
      'Accept-Encoding': 'identity',
      'X-Subscription-Token': apiKey,
    },
  });

  if (!response.ok) {
    throw new ToolExecutionError(
      `Brave Search API error: ${response.status} ${response.statusText}`,
      2023
    );
  }

  const data = (await response.json()) as {
    query?: { original?: string };
    web?: { results?: Array<{ title?: string; url?: string; description?: string }> };
  };

  return {
    query: data.query?.original || query,
    provider: 'brave',
    results: (data.web?.results || []).map((r) => ({
      title: r.title || 'No title',
      url: r.url || '',
      snippet: r.description || '',
    })),
  };
}

/**
 * 根据可用的 API Key 选择搜索提供商
 */
function getSearchProvider(): 'tavily' | 'brave' {
  if (process.env.TAVILY_API_KEY) return 'tavily';
  if (process.env.BRAVE_SEARCH_API_KEY) return 'brave';
  throw new ToolExecutionError(
    'No search API key configured. Set TAVILY_API_KEY or BRAVE_SEARCH_API_KEY environment variable.',
    2024
  );
}

const schema = z
  .object({
    query: z.string().min(1).max(500).describe('Search query'),
    maxResults: z
      .number()
      .int()
      .min(1)
      .max(10)
      .default(5)
      .describe('Maximum number of results (1-10)'),
    provider: z
      .enum(['tavily', 'brave', 'auto'])
      .default('auto')
      .describe('Search provider: tavily, brave, or auto (uses first available)'),
  })
  .strict();

export class WebSearchTool extends BaseTool<typeof schema> {
  readonly name = 'web_search';
  readonly description = WEB_SEARCH_TOOL_DESCRIPTION;
  readonly parameters = schema;

  async execute(
    args: z.input<typeof schema>,
    _context?: ToolExecutionContext
  ): Promise<ToolResult> {
    // Apply defaults (zod defaults may not be applied when calling execute directly)
    const query = args.query;
    const maxResults = args.maxResults ?? 5;
    const provider = args.provider ?? 'auto';

    // 确定使用的搜索提供商
    const selectedProvider = provider === 'auto' ? getSearchProvider() : provider;

    // 执行搜索
    let response: SearchResponse;
    switch (selectedProvider) {
      case 'tavily':
        response = await searchWithTavily(query, maxResults);
        break;
      case 'brave':
        response = await searchWithBrave(query, maxResults);
        break;
      default:
        throw new ToolExecutionError(`Unknown search provider: ${selectedProvider}`, 2025);
    }

    // 格式化输出
    const lines: string[] = [
      `Search: "${response.query}"`,
      `Provider: ${response.provider}`,
      `Results: ${response.results.length}`,
      '',
    ];

    for (let i = 0; i < response.results.length; i++) {
      const r = response.results[i];
      lines.push(`[${i + 1}] ${r.title}`);
      lines.push(`    URL: ${r.url}`);
      if (r.score !== undefined) {
        lines.push(`    Score: ${r.score.toFixed(2)}`);
      }
      if (r.snippet) {
        // 截断过长的摘要
        const snippet = r.snippet.length > 300 ? r.snippet.slice(0, 300) + '...' : r.snippet;
        lines.push(`    ${snippet}`);
      }
      lines.push('');
    }

    return {
      success: true,
      output: lines.join('\n'),
      metadata: {
        query: response.query,
        provider: response.provider,
        resultCount: response.results.length,
        results: response.results,
      },
    };
  }
}

export default WebSearchTool;
