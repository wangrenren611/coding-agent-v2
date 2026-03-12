import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/logs/route';

vi.mock('@/lib/db', () => ({
  getLogsByExecution: vi.fn(),
}));

import { getLogsByExecution } from '@/lib/db';

describe('API /api/logs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/logs', () => {
    it('should require execution_id parameter', async () => {
      const request = new Request('http://localhost:3888/api/logs');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('execution_id is required');
    });

    it('should return logs for specific execution', async () => {
      const mockLogs = [
        { id: 1, level: 'info', message: 'Log 1', created_at_ms: Date.now() },
        { id: 2, level: 'error', message: 'Log 2', created_at_ms: Date.now() },
        { id: 3, level: 'debug', message: 'Log 3', created_at_ms: Date.now() },
      ];
      vi.mocked(getLogsByExecution).mockReturnValue(mockLogs as any);

      const request = new Request('http://localhost:3888/api/logs?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      expect(getLogsByExecution).toHaveBeenCalledWith('exec_001', 200);
      expect(response.status).toBe(200);
      expect(data.logs).toHaveLength(3);
    });

    it('should respect custom limit parameter', async () => {
      const mockLogs = [{ id: 1, level: 'info', message: 'Log 1', created_at_ms: Date.now() }];
      vi.mocked(getLogsByExecution).mockReturnValue(mockLogs as any);

      const request = new Request('http://localhost:3888/api/logs?execution_id=exec_001&limit=10');
      await GET(request);

      expect(getLogsByExecution).toHaveBeenCalledWith('exec_001', 10);
    });

    it('should filter logs by level', async () => {
      const mockLogs = [
        { id: 1, level: 'info', message: 'Info log', created_at_ms: Date.now() },
        { id: 2, level: 'error', message: 'Error log', created_at_ms: Date.now() },
        { id: 3, level: 'warn', message: 'Warn log', created_at_ms: Date.now() },
      ];
      vi.mocked(getLogsByExecution).mockReturnValue(mockLogs as any);

      const request = new Request(
        'http://localhost:3888/api/logs?execution_id=exec_001&level=error'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.logs).toHaveLength(1);
      expect(data.logs[0].level).toBe('error');
    });

    it('should filter logs by level - info', async () => {
      const mockLogs = [
        { id: 1, level: 'info', message: 'Info log 1', created_at_ms: Date.now() },
        { id: 2, level: 'error', message: 'Error log', created_at_ms: Date.now() },
        { id: 3, level: 'info', message: 'Info log 2', created_at_ms: Date.now() },
      ];
      vi.mocked(getLogsByExecution).mockReturnValue(mockLogs as any);

      const request = new Request(
        'http://localhost:3888/api/logs?execution_id=exec_001&level=info'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.logs).toHaveLength(2);
      expect(data.logs.every((log: any) => log.level === 'info')).toBe(true);
    });

    it('should return empty array when no logs match filter', async () => {
      const mockLogs = [{ id: 1, level: 'info', message: 'Info log', created_at_ms: Date.now() }];
      vi.mocked(getLogsByExecution).mockReturnValue(mockLogs as any);

      const request = new Request(
        'http://localhost:3888/api/logs?execution_id=exec_001&level=error'
      );
      const response = await GET(request);
      const data = await response.json();

      expect(data.logs).toHaveLength(0);
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(getLogsByExecution).mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new Request('http://localhost:3888/api/logs?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch logs');
    });
  });
});
