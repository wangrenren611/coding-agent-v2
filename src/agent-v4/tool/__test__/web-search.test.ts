import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebSearchTool } from '../web-search';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WebSearchTool', () => {
  let tool: WebSearchTool;
  const savedEnv: Record<string, string | undefined> = {};

  beforeEach(() => {
    tool = new WebSearchTool();
    vi.clearAllMocks();
    // Save original env values
    savedEnv.TAVILY_API_KEY = process.env.TAVILY_API_KEY;
    savedEnv.BRAVE_SEARCH_API_KEY = process.env.BRAVE_SEARCH_API_KEY;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    // Restore original env values
    if (savedEnv.TAVILY_API_KEY !== undefined) {
      process.env.TAVILY_API_KEY = savedEnv.TAVILY_API_KEY;
    } else {
      delete process.env.TAVILY_API_KEY;
    }
    if (savedEnv.BRAVE_SEARCH_API_KEY !== undefined) {
      process.env.BRAVE_SEARCH_API_KEY = savedEnv.BRAVE_SEARCH_API_KEY;
    } else {
      delete process.env.BRAVE_SEARCH_API_KEY;
    }
  });

  function setEnv(tavily?: string, brave?: string) {
    if (tavily !== undefined) {
      process.env.TAVILY_API_KEY = tavily;
    } else {
      delete process.env.TAVILY_API_KEY;
    }
    if (brave !== undefined) {
      process.env.BRAVE_SEARCH_API_KEY = brave;
    } else {
      delete process.env.BRAVE_SEARCH_API_KEY;
    }
  }

  describe('Provider Selection', () => {
    it('throws when no API key is configured', async () => {
      setEnv();

      await expect(tool.execute({ query: 'test' })).rejects.toThrow('No search API key configured');
    });

    it('uses tavily when TAVILY_API_KEY is set', async () => {
      setEnv('test-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: 'test',
            results: [{ title: 'Result', url: 'https://example.com', content: 'Content' }],
          }),
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      expect(result.metadata?.provider).toBe('tavily');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://api.tavily.com/search',
        expect.objectContaining({
          method: 'POST',
          headers: expect.objectContaining({
            Authorization: 'Bearer test-key',
          }),
        })
      );
    });

    it('uses brave when BRAVE_SEARCH_API_KEY is set', async () => {
      setEnv(undefined, 'brave-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: { original: 'test' },
            web: {
              results: [{ title: 'Result', url: 'https://example.com', description: 'Desc' }],
            },
          }),
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      expect(result.metadata?.provider).toBe('brave');
    });

    it('prefers tavily when both keys are set and provider is auto', async () => {
      setEnv('tavily-key', 'brave-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: 'test',
            results: [],
          }),
      });

      const result = await tool.execute({ query: 'test', provider: 'auto' });
      expect(result.success).toBe(true);
      expect(result.metadata?.provider).toBe('tavily');
    });

    it('respects explicit provider choice', async () => {
      setEnv('tavily-key', 'brave-key');

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: { original: 'test' },
            web: { results: [] },
          }),
      });

      const result = await tool.execute({ query: 'test', provider: 'brave' });
      expect(result.success).toBe(true);
      expect(result.metadata?.provider).toBe('brave');
    });

    it('throws when explicit provider key is missing', async () => {
      setEnv(undefined, 'brave-key');

      await expect(tool.execute({ query: 'test', provider: 'tavily' })).rejects.toThrow(
        'TAVILY_API_KEY environment variable is not set'
      );
    });
  });

  describe('Tavily Search', () => {
    beforeEach(() => {
      setEnv('test-key');
    });

    it('returns formatted results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: 'typescript',
            results: [
              {
                title: 'TypeScript',
                url: 'https://typescriptlang.org',
                content: 'TypeScript is a typed superset of JavaScript',
                score: 0.95,
              },
              {
                title: 'TS Handbook',
                url: 'https://typescriptlang.org/docs',
                content: 'The TypeScript Handbook',
                score: 0.85,
              },
            ],
          }),
      });

      const result = await tool.execute({ query: 'typescript', maxResults: 5 });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Search: "typescript"');
      expect(result.output).toContain('Provider: tavily');
      expect(result.output).toContain('[1] TypeScript');
      expect(result.output).toContain('[2] TS Handbook');
      expect(result.metadata?.resultCount).toBe(2);
    });

    it('handles empty results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: 'nonexistent',
            results: [],
          }),
      });

      const result = await tool.execute({ query: 'nonexistent' });
      expect(result.success).toBe(true);
      expect(result.metadata?.resultCount).toBe(0);
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 429,
        statusText: 'Too Many Requests',
      });

      await expect(tool.execute({ query: 'test' })).rejects.toThrow('Tavily API error: 429');
    });

    it('truncates long snippets', async () => {
      const longContent = 'x'.repeat(500);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: 'test',
            results: [{ title: 'Test', url: 'https://example.com', content: longContent }],
          }),
      });

      const result = await tool.execute({ query: 'test' });
      expect(result.success).toBe(true);
      expect(result.output).toContain('...');
    });
  });

  describe('Brave Search', () => {
    beforeEach(() => {
      setEnv(undefined, 'brave-key');
    });

    it('returns formatted results', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            query: { original: 'nodejs' },
            web: {
              results: [
                { title: 'Node.js', url: 'https://nodejs.org', description: 'JavaScript runtime' },
              ],
            },
          }),
      });

      const result = await tool.execute({ query: 'nodejs' });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Provider: brave');
      expect(result.output).toContain('[1] Node.js');
    });

    it('handles API errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 401,
        statusText: 'Unauthorized',
      });

      await expect(tool.execute({ query: 'test' })).rejects.toThrow('Brave Search API error: 401');
    });
  });

  describe('Schema Validation', () => {
    it('validates query is required', () => {
      const validation = tool.safeValidateArgs({});
      expect(validation.success).toBe(false);
    });

    it('validates query max length', () => {
      const validation = tool.safeValidateArgs({ query: 'x'.repeat(501) });
      expect(validation.success).toBe(false);
    });

    it('validates maxResults range', () => {
      const validation = tool.safeValidateArgs({ query: 'test', maxResults: 11 });
      expect(validation.success).toBe(false);
    });

    it('validates provider enum', () => {
      const validation = tool.safeValidateArgs({ query: 'test', provider: 'google' });
      expect(validation.success).toBe(false);
    });

    it('accepts valid arguments', () => {
      const validation = tool.safeValidateArgs({
        query: 'test query',
        maxResults: 3,
        provider: 'auto',
      });
      expect(validation.success).toBe(true);
    });
  });
});
