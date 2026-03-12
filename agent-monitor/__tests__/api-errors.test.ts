import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/errors/route';

vi.mock('@/lib/db', () => ({
  getErrorLogs: vi.fn(),
  getLogsByExecution: vi.fn(),
}));

import { getErrorLogs, getLogsByExecution } from '@/lib/db';

describe('API /api/errors', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/errors', () => {
    it('should return list of error logs with default limit', async () => {
      const mockErrors = [
        { id: 1, level: 'error', message: 'Error 1', created_at_ms: Date.now() },
        { id: 2, level: 'error', message: 'Error 2', created_at_ms: Date.now() },
      ];
      vi.mocked(getErrorLogs).mockReturnValue(mockErrors as any);

      const request = new Request('http://localhost:3888/api/errors');
      const response = await GET(request);
      const data = await response.json();

      expect(getErrorLogs).toHaveBeenCalledWith(100);
      expect(response.status).toBe(200);
      expect(data.logs).toHaveLength(2);
    });

    it('should respect custom limit parameter', async () => {
      const mockErrors = [{ id: 1, level: 'error', message: 'Error 1', created_at_ms: Date.now() }];
      vi.mocked(getErrorLogs).mockReturnValue(mockErrors as any);

      const request = new Request('http://localhost:3888/api/errors?limit=5');
      const response = await GET(request);
      const data = await response.json();

      expect(getErrorLogs).toHaveBeenCalledWith(5);
      expect(data.logs).toHaveLength(1);
    });

    it('should return errors for specific execution', async () => {
      const mockErrors = [
        {
          id: 1,
          execution_id: 'exec_001',
          level: 'error',
          message: 'Error 1',
          created_at_ms: Date.now(),
        },
      ];
      vi.mocked(getLogsByExecution).mockReturnValue(mockErrors as any);

      const request = new Request('http://localhost:3888/api/errors?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      expect(getLogsByExecution).toHaveBeenCalledWith('exec_001');
      expect(data.logs).toHaveLength(1);
      expect(data.logs[0].execution_id).toBe('exec_001');
    });

    it('should filter only error level logs', async () => {
      const mockAllLogs = [
        { id: 1, level: 'error', message: 'Error', created_at_ms: Date.now() },
        { id: 2, level: 'info', message: 'Info', created_at_ms: Date.now() },
        { id: 3, level: 'error', message: 'Error 2', created_at_ms: Date.now() },
      ];
      vi.mocked(getLogsByExecution).mockReturnValue(mockAllLogs as any);

      const request = new Request('http://localhost:3888/api/errors?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      // The API should filter to only errors
      expect(data.logs).toHaveLength(2);
      expect(data.logs.every((log: any) => log.level === 'error')).toBe(true);
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(getErrorLogs).mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new Request('http://localhost:3888/api/errors');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch errors');
    });
  });
});
