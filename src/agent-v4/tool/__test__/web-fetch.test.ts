import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { WebFetchTool } from '../web-fetch';

// Mock fetch globally
const mockFetch = vi.fn();
global.fetch = mockFetch;

describe('WebFetchTool', () => {
  let tool: WebFetchTool;

  beforeEach(() => {
    tool = new WebFetchTool();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('SSRF Protection', () => {
    it('blocks localhost', async () => {
      await expect(tool.execute({ url: 'http://localhost/secret' })).rejects.toThrow(
        'Blocked address: localhost'
      );
    });

    it('blocks 127.0.0.1', async () => {
      await expect(tool.execute({ url: 'http://127.0.0.1/admin' })).rejects.toThrow(
        'Blocked address: 127.0.0.1'
      );
    });

    it('blocks 0.0.0.0', async () => {
      await expect(tool.execute({ url: 'http://0.0.0.0/' })).rejects.toThrow(
        'Blocked address: 0.0.0.0'
      );
    });

    it('blocks 10.x.x.x private IP', async () => {
      await expect(tool.execute({ url: 'http://10.0.0.1/internal' })).rejects.toThrow(
        'Blocked address: 10.0.0.1'
      );
    });

    it('blocks 172.16-31.x.x private IP', async () => {
      await expect(tool.execute({ url: 'http://172.16.0.1/' })).rejects.toThrow(
        'Blocked address: 172.16.0.1'
      );

      await expect(tool.execute({ url: 'http://172.31.255.255/' })).rejects.toThrow(
        'Blocked address: 172.31.255.255'
      );
    });

    it('blocks 192.168.x.x private IP', async () => {
      await expect(tool.execute({ url: 'http://192.168.1.1/router' })).rejects.toThrow(
        'Blocked address: 192.168.1.1'
      );
    });

    it('blocks 169.254.x.x link-local', async () => {
      await expect(
        tool.execute({ url: 'http://169.254.169.254/latest/meta-data/' })
      ).rejects.toThrow('Blocked address: 169.254.169.254');
    });

    it('blocks cloud metadata hostnames', async () => {
      await expect(tool.execute({ url: 'http://metadata.google.internal/' })).rejects.toThrow(
        'Blocked address: metadata.google.internal'
      );
    });

    it('blocks non-http protocols', async () => {
      await expect(tool.execute({ url: 'file:///etc/passwd' })).rejects.toThrow(
        'Unsupported protocol: file:'
      );
    });

    it('allows public URLs', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: () => Promise.resolve('<html><body>Hello</body></html>'),
      });

      const result = await tool.execute({ url: 'https://example.com/' });
      expect(result.success).toBe(true);
      expect(mockFetch).toHaveBeenCalledOnce();
    });
  });

  describe('Content Extraction', () => {
    it('extracts text from HTML', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: () => Promise.resolve('<html><body><h1>Title</h1><p>Content</p></body></html>'),
      });

      const result = await tool.execute({
        url: 'https://example.com/',
        extractMode: 'text',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Title');
      expect(result.output).toContain('Content');
      expect(result.output).not.toContain('<h1>');
    });

    it('returns raw HTML when extractMode is html', async () => {
      const html = '<html><body><p>Test</p></body></html>';
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: () => Promise.resolve(html),
      });

      const result = await tool.execute({
        url: 'https://example.com/',
        extractMode: 'html',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('<p>Test</p>');
    });

    it('removes script and style tags in text mode', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/html']]),
        text: () =>
          Promise.resolve(
            '<html><head><script>alert("xss")</script><style>body{color:red}</style></head><body>Safe content</body></html>'
          ),
      });

      const result = await tool.execute({
        url: 'https://example.com/',
        extractMode: 'text',
      });

      expect(result.success).toBe(true);
      expect(result.output).toContain('Safe content');
      expect(result.output).not.toContain('alert');
      expect(result.output).not.toContain('color:red');
    });
  });

  describe('Error Handling', () => {
    it('handles HTTP errors', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        status: 404,
        statusText: 'Not Found',
      });

      await expect(tool.execute({ url: 'https://example.com/notfound' })).rejects.toThrow(
        'HTTP 404: Not Found'
      );
    });

    it('handles network errors', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network error'));

      await expect(tool.execute({ url: 'https://example.com/' })).rejects.toThrow(
        'Fetch failed: Network error'
      );
    });

    it('handles timeout', async () => {
      mockFetch.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            const error = new Error('Aborted');
            error.name = 'AbortError';
            setTimeout(() => reject(error), 10);
          })
      );

      await expect(tool.execute({ url: 'https://example.com/', timeout: 1000 })).rejects.toThrow(
        'Request timeout'
      );
    });
  });

  describe('Output Truncation', () => {
    it('truncates large content', async () => {
      const largeContent = 'x'.repeat(100000);
      mockFetch.mockResolvedValueOnce({
        ok: true,
        status: 200,
        headers: new Map([['content-type', 'text/plain']]),
        text: () => Promise.resolve(largeContent),
      });

      const result = await tool.execute({
        url: 'https://example.com/',
        maxChars: 1000,
      });

      expect(result.success).toBe(true);
      expect(result.metadata?.truncated).toBe(true);
      expect(result.output?.length ?? 0).toBeLessThan(2000);
    });
  });

  describe('Schema Validation', () => {
    it('validates URL format', () => {
      const validation = tool.safeValidateArgs({ url: 'not-a-url' });
      expect(validation.success).toBe(false);
    });

    it('validates extractMode enum', () => {
      const validation = tool.safeValidateArgs({
        url: 'https://example.com',
        extractMode: 'invalid',
      });
      expect(validation.success).toBe(false);
    });

    it('validates maxChars range', () => {
      const validation = tool.safeValidateArgs({
        url: 'https://example.com',
        maxChars: 50, // below minimum of 100
      });
      expect(validation.success).toBe(false);
    });

    it('accepts valid arguments', () => {
      const validation = tool.safeValidateArgs({
        url: 'https://example.com',
        extractMode: 'text',
        maxChars: 5000,
        timeout: 10000,
      });
      expect(validation.success).toBe(true);
    });
  });
});
