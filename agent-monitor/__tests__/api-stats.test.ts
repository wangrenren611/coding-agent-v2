import { describe, it, expect, vi, beforeEach } from 'vitest';
import { GET } from '@/app/api/stats/route';

vi.mock('@/lib/db', () => ({
  getAggregateStats: vi.fn(),
  getDailyStats: vi.fn(),
  getModelUsage: vi.fn(),
  getRunStats: vi.fn(),
}));

import {
  getAggregateStats,
  getDailyStats,
  getModelUsage,
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
      expect(data.stats).toEqual(mockStats);
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
      vi.mocked(getDailyStats).mockReturnValue(mockDaily as any);

      const request = new Request('http://localhost:3888/api/stats?type=daily');
      const response = await GET(request);
      const data = await response.json();

      expect(getDailyStats).toHaveBeenCalledWith(7);
      expect(data.daily_stats).toHaveLength(2);
    });

    it('should respect custom days parameter', async () => {
      vi.mocked(getDailyStats).mockReturnValue([]);

      const request = new Request('http://localhost:3888/api/stats?type=daily&days=30');
      const response = await GET(request);

      expect(getDailyStats).toHaveBeenCalledWith(30);
    });

    it('should return model usage when type=models', async () => {
      const mockModels = [
        { model: 'gpt-4', total_tokens: 10000, prompt_tokens: 8000, completion_tokens: 2000, message_count: 50, run_count: 10 },
      ];
      vi.mocked(getModelUsage).mockReturnValue(mockModels as any);

      const request = new Request('http://localhost:3888/api/stats?type=models');
      const response = await GET(request);
      const data = await response.json();

      expect(getModelUsage).toHaveBeenCalled();
      expect(data.model_usage).toHaveLength(1);
    });

    it('should return run stats for specific execution', async () => {
      const mockRunStats = {
        execution_id: 'exec_001',
        total_tokens: 5000,
        prompt_tokens: 4000,
        completion_tokens: 1000,
        duration_ms: 30000,
        message_count: 10,
        tool_call_count: 5,
      };
      vi.mocked(getRunStats).mockReturnValue(mockRunStats);

      const request = new Request('http://localhost:3888/api/stats?execution_id=exec_001');
      const response = await GET(request);
      const data = await response.json();

      expect(getRunStats).toHaveBeenCalledWith('exec_001');
      expect(data.stats).toEqual(mockRunStats);
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
