import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock all API routes
vi.mock('@/lib/db', () => ({
  getRuns: vi.fn(),
  getRunById: vi.fn(),
  getRunStats: vi.fn(),
  getErrorLogs: vi.fn(),
  getLogsByExecution: vi.fn(),
  getAggregateStats: vi.fn(),
  getDailyStats: vi.fn(),
  getModelUsage: vi.fn(),
}));

import {
  getRuns,
  getRunById,
  getRunStats,
  getErrorLogs,
  getAggregateStats,
  getDailyStats,
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

      vi.mocked(getDailyStats).mockReturnValue([
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
          created_at_ms: Date.now(),
        },
      ] as any);

      // Fetch stats
      const statsReq = new Request('http://localhost:3888/api/stats');
      const statsRes = await statsGet(statsReq);
      const statsData = await statsRes.json();

      expect(statsRes.status).toBe(200);
      expect(statsData.stats.total_runs).toBe(100);

      // Fetch runs
      const runsReq = new Request('http://localhost:3888/api/runs');
      const runsRes = await runsGet(runsReq);
      const runsData = await runsRes.json();

      expect(runsRes.status).toBe(200);
      expect(runsData.runs).toHaveLength(1);

      // Fetch errors
      const errorsReq = new Request('http://localhost:3888/api/errors');
      const errorsRes = await errorsGet(errorsReq);
      const errorsData = await errorsRes.json();

      expect(errorsRes.status).toBe(200);
      expect(errorsData.errors).toHaveLength(1);
    });
  });

  describe('Error Handling', () => {
    it('should handle all API errors consistently', async () => {
      vi.mocked(getAggregateStats).mockImplementation(() => {
        throw new Error('Test error');
      });
      vi.mocked(getRuns).mockImplementation(() => {
        throw new Error('Test error');
      });
      vi.mocked(getErrorLogs).mockImplementation(() => {
        throw new Error('Test error');
      });

      const statsReq = new Request('http://localhost:3888/api/stats');
      const statsRes = await statsGet(statsReq);
      expect(statsRes.status).toBe(500);

      const runsReq = new Request('http://localhost:3888/api/runs');
      const runsRes = await runsGet(runsReq);
      expect(runsRes.status).toBe(500);

      const errorsReq = new Request('http://localhost:3888/api/errors');
      const errorsRes = await errorsGet(errorsReq);
      expect(errorsRes.status).toBe(500);
    });
  });

  describe('Run Detail Flow', () => {
    it('should fetch run details with stats and logs', async () => {
      const mockRun = {
        execution_id: 'exec_001',
        run_id: 'run_001',
        conversation_id: 'conv_001',
        status: 'COMPLETED',
        created_at_ms: Date.now(),
        updated_at_ms: Date.now(),
        step_index: 5,
        started_at_ms: Date.now() - 10000,
        completed_at_ms: Date.now(),
        terminal_reason: 'stop',
        error_code: null,
        error_category: null,
        error_message: null,
      };

      const mockStats = {
        execution_id: 'exec_001',
        total_tokens: 5000,
        prompt_tokens: 4000,
        completion_tokens: 1000,
        duration_ms: 10000,
        message_count: 10,
        tool_call_count: 5,
      };

      vi.mocked(getRunById).mockReturnValue(mockRun as any);
      vi.mocked(getRunStats).mockReturnValue(mockStats);

      const request = new Request('http://localhost:3888/api/runs?execution_id=exec_001');
      const response = await runsGet(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.run.execution_id).toBe('exec_001');
      expect(data.stats.total_tokens).toBe(5000);
    });
  });
});
