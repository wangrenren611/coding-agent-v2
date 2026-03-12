import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/stats/route';

vi.mock('@/lib/db', () => ({
  getAggregateStats: vi.fn(),
  getTokenUsageByDay: vi.fn(),
  getStatusDistribution: vi.fn(),
  getRunStats: vi.fn(),
}));

import {
  getAggregateStats,
  getTokenUsageByDay,
  getStatusDistribution,
  getRunStats,
} from '@/lib/db';

describe('API /api/stats', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('GET /api/stats', () => {
    it('should return aggregate stats by default', async () => {
      const mockStats = {
        total_runs: 100,
        running_runs: 5,
        completed_runs: 90,
        failed_runs: 3,
        cancelled_runs: 2,
        total_tokens: 50000,
        avg_duration_ms: 30000,
        total_errors: 10,
      };
      vi.mocked(getAggregateStats).mockReturnValue(mockStats);

      const request = new Request('http://localhost:3888/api/stats');
      const response = await GET(request);
      const data = await response.json();

      expect(getAggregateStats).toHaveBeenCalled();
      expect(response.status).toBe(200);
      expect(data.aggregate).toEqual(mockStats);
    });

    it('should return daily token usage when type=daily', async () => {
      const mockDaily = [
        {
          date: '2024-01-01',
          total_tokens: 1000,
          prompt_tokens: 800,
          completion_tokens: 200,
          run_count: 5,
        },
        {
          date: '2024-01-02',
          total_tokens: 1500,
          prompt_tokens: 1200,
          completion_tokens: 300,
          run_count: 8,
        },
      ];
      vi.mocked(getTokenUsageByDay).mockReturnValue(mockDaily as any);

      const request = new Request('http://localhost:3888/api/stats?type=daily');
      const response = await GET(request);
      const data = await response.json();

      expect(getTokenUsageByDay).toHaveBeenCalledWith(7);
      expect(data.daily).toHaveLength(2);
      expect(data.daily[0].total_tokens).toBe(1000);
    });

    it('should respect custom days parameter', async () => {
      vi.mocked(getTokenUsageByDay).mockReturnValue([]);

      const request = new Request('http://localhost:3888/api/stats?type=daily&days=30');
      await GET(request);

      expect(getTokenUsageByDay).toHaveBeenCalledWith(30);
    });

    it('should return status distribution when type=distribution', async () => {
      const mockDistribution = [
        { status: 'COMPLETED', count: 90, percentage: 90 },
        { status: 'FAILED', count: 5, percentage: 5 },
        { status: 'RUNNING', count: 5, percentage: 5 },
      ];
      vi.mocked(getStatusDistribution).mockReturnValue(mockDistribution as any);

      const request = new Request('http://localhost:3888/api/stats?type=distribution');
      const response = await GET(request);
      const data = await response.json();

      expect(getStatusDistribution).toHaveBeenCalled();
      expect(data.distribution).toHaveLength(3);
      expect(data.distribution[0].status).toBe('COMPLETED');
    });

    it('should return stats for specific execution', async () => {
      const mockStats = {
        execution_id: 'exec_001',
        total_tokens: 5000,
        prompt_tokens: 4000,
        completion_tokens: 1000,
        duration_ms: 25000,
        message_count: 10,
        tool_call_count: 5,
      };
      vi.mocked(getRunStats).mockReturnValue(mockStats as any);

      const request = new Request('http://localhost:3888/api/stats?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      expect(getRunStats).toHaveBeenCalledWith('exec_001');
      expect(data.stats).toEqual(mockStats);
    });

    it('should handle database errors gracefully', async () => {
      vi.mocked(getAggregateStats).mockImplementation(() => {
        throw new Error('Database error');
      });

      const request = new Request('http://localhost:3888/api/stats');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch stats');
    });
  });
});
