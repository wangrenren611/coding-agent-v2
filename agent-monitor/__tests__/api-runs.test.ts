import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/runs/route';

// Mock the database module
vi.mock('@/lib/db', () => ({
  getRuns: vi.fn(),
  getRunById: vi.fn(),
  getRunStats: vi.fn(),
}));

import { getRuns, getRunById, getRunStats } from '@/lib/db';

describe('API /api/runs', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/runs', () => {
    it('should return list of runs with default limit', async () => {
      const mockRuns = [
        { execution_id: 'exec_001', status: 'COMPLETED', created_at_ms: Date.now() },
        { execution_id: 'exec_002', status: 'RUNNING', created_at_ms: Date.now() },
      ];
      vi.mocked(getRuns).mockReturnValue(mockRuns as any);

      const request = new Request('http://localhost:3888/api/runs');
      const response = await GET(request);
      const data = await response.json();

      expect(getRuns).toHaveBeenCalledWith(100);
      expect(response.status).toBe(200);
      expect(data.runs).toHaveLength(2);
      expect(data.runs[0].execution_id).toBe('exec_001');
    });

    it('should respect custom limit parameter', async () => {
      const mockRuns = [
        { execution_id: 'exec_001', status: 'COMPLETED', created_at_ms: Date.now() },
      ];
      vi.mocked(getRuns).mockReturnValue(mockRuns as any);

      const request = new Request('http://localhost:3888/api/runs?limit=10');
      const response = await GET(request);
      const data = await response.json();

      expect(getRuns).toHaveBeenCalledWith(10);
      expect(data.runs).toHaveLength(1);
    });

    it('should return single run by execution_id', async () => {
      const mockRun = { execution_id: 'exec_001', status: 'COMPLETED', created_at_ms: Date.now() };
      const mockStats = { total_tokens: 1000, prompt_tokens: 800, completion_tokens: 200 };

      vi.mocked(getRunById).mockReturnValue(mockRun as any);
      vi.mocked(getRunStats).mockReturnValue(mockStats as any);

      const request = new Request('http://localhost:3888/api/runs?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      expect(getRunById).toHaveBeenCalledWith('exec_001');
      expect(getRunStats).toHaveBeenCalledWith('exec_001');
      expect(data.run).toBeDefined();
      expect(data.stats).toBeDefined();
      expect(data.stats.total_tokens).toBe(1000);
    });

    it('should return 404 for non-existent run', async () => {
      vi.mocked(getRunById).mockReturnValue(null);

      const request = new Request('http://localhost:3888/api/runs?execution_id=non_existent');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Run not found');
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(getRuns).mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new Request('http://localhost:3888/api/runs');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch runs');
    });
  });
});
