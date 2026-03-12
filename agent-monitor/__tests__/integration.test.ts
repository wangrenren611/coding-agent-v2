import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all API routes
vi.mock('@/lib/db', () => ({
  getRuns: vi.fn(),
  getRunById: vi.fn(),
  getRunStats: vi.fn(),
  getErrorLogs: vi.fn(),
  getLogsByExecution: vi.fn(),
  getAggregateStats: vi.fn(),
  getTokenUsageByDay: vi.fn(),
  getStatusDistribution: vi.fn(),
}));

import {
  getRuns,
  getRunById,
  getRunStats,
  getErrorLogs,
  getAggregateStats,
  getTokenUsageByDay,
  getLogsByExecution,
} from '@/lib/db';
import { GET as runsGet } from '@/app/api/runs/route';
import { GET as errorsGet } from '@/app/api/errors/route';
import { GET as statsGet } from '@/app/api/stats/route';

describe('Integration Tests', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('Dashboard Data Flow', () => {
    it('should fetch all required data for dashboard', async () => {
      // Mock all data sources
      vi.mocked(getAggregateStats).mockReturnValue({
        total_runs: 100,
        running_runs: 5,
        completed_runs: 90,
        failed_runs: 3,
        cancelled_runs: 2,
        total_tokens: 50000,
        avg_duration_ms: 30000,
        total_errors: 10,
      });

      vi.mocked(getRuns).mockReturnValue([
        {
          execution_id: 'exec_001',
          status: 'COMPLETED',
          created_at_ms: Date.now(),
          step_index: 5,
          terminal_reason: null,
          error_code: null,
          error_message: null,
        },
      ] as any);

      vi.mocked(getTokenUsageByDay).mockReturnValue([
        {
          date: '2024-01-01',
          total_tokens: 1000,
          prompt_tokens: 800,
          completion_tokens: 200,
          run_count: 5,
        },
      ] as any);

      vi.mocked(getErrorLogs).mockReturnValue([
        {
          id: 1,
          execution_id: 'exec_002',
          step_index: 10,
          level: 'error',
          code: 'ERROR',
          source: 'agent',
          message: 'Error',
          error_json: null,
          created_at_ms: Date.now(),
        },
      ] as any);

      // Fetch all dashboard data
      const [statsRes, runsRes, dailyRes, errorsRes] = await Promise.all([
        statsGet(new Request('http://localhost:3888/api/stats')),
        runsGet(new Request('http://localhost:3888/api/runs?limit=50')),
        statsGet(new Request('http://localhost:3888/api/stats?type=daily')),
        errorsGet(new Request('http://localhost:3888/api/errors?limit=10')),
      ]);

      const stats = await statsRes.json();
      const runs = await runsRes.json();
      const daily = await dailyRes.json();
      const errors = await errorsRes.json();

      // Verify all data is fetched correctly
      expect(stats.aggregate.total_runs).toBe(100);
      expect(runs.runs).toHaveLength(1);
      expect(daily.daily).toHaveLength(1);
      expect(errors.logs).toHaveLength(1);
    });

    it('should handle partial failures gracefully', async () => {
      vi.mocked(getAggregateStats).mockReturnValue({
        total_runs: 100,
        running_runs: 5,
        completed_runs: 90,
        failed_runs: 3,
        cancelled_runs: 2,
        total_tokens: 50000,
        avg_duration_ms: 30000,
        total_errors: 10,
      });

      vi.mocked(getRuns).mockImplementation(() => {
        throw new Error('Database unavailable');
      });

      // Stats should still work
      const statsRes = await statsGet(new Request('http://localhost:3888/api/stats'));
      expect(statsRes.status).toBe(200);

      // Runs should fail gracefully
      const runsRes = await runsGet(new Request('http://localhost:3888/api/runs'));
      expect(runsRes.status).toBe(500);
    });
  });

  describe('Run Detail Flow', () => {
    it('should fetch run detail with stats and logs', async () => {
      const mockRun = {
        execution_id: 'exec_001',
        status: 'COMPLETED',
        created_at_ms: Date.now(),
        step_index: 5,
        terminal_reason: 'stop',
        error_code: null,
        error_message: null,
      };

      const mockStats = {
        execution_id: 'exec_001',
        total_tokens: 5000,
        prompt_tokens: 4000,
        completion_tokens: 1000,
        duration_ms: 25000,
        message_count: 10,
        tool_call_count: 5,
      };

      vi.mocked(getRunById).mockReturnValue(mockRun as any);
      vi.mocked(getRunStats).mockReturnValue(mockStats as any);
      vi.mocked(getLogsByExecution).mockReturnValue([]);

      // Fetch run detail
      const runRes = await runsGet(
        new Request('http://localhost:3888/api/runs?execution_id=exec_001')
      );
      const runData = await runRes.json();

      expect(runData.run).toBeDefined();
      expect(runData.stats).toBeDefined();
      expect(runData.run.execution_id).toBe('exec_001');
      expect(runData.stats.total_tokens).toBe(5000);
    });
  });

  describe('Error Handling', () => {
    it('should handle all API errors consistently', async () => {
      vi.mocked(getAggregateStats).mockImplementation(() => {
        throw new Error('Test error');
      });

      const response = await statsGet(new Request('http://localhost:3888/api/stats'));
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch stats');
    });

    it('should return proper error responses', async () => {
      vi.mocked(getRunById).mockReturnValue(null);

      const response = await runsGet(
        new Request('http://localhost:3888/api/runs?execution_id=nonexistent')
      );
      const data = await response.json();

      expect(response.status).toBe(404);
      expect(data.error).toBe('Run not found');
    });
  });

  describe('Data Consistency', () => {
    it('should have consistent execution_id across related data', async () => {
      const executionId = 'exec_test_123';

      vi.mocked(getRunById).mockReturnValue({
        execution_id: executionId,
        status: 'COMPLETED',
        created_at_ms: Date.now(),
        step_index: 5,
        terminal_reason: null,
        error_code: null,
        error_message: null,
      } as any);

      vi.mocked(getRunStats).mockReturnValue({
        execution_id: executionId,
        total_tokens: 1000,
        prompt_tokens: 800,
        completion_tokens: 200,
        duration_ms: 10000,
        message_count: 5,
        tool_call_count: 2,
      } as any);

      const runRes = await runsGet(
        new Request(`http://localhost:3888/api/runs?execution_id=${executionId}`)
      );
      const runData = await runRes.json();

      expect(runData.run.execution_id).toBe(executionId);
      expect(runData.stats.execution_id).toBe(executionId);
    });
  });
});
