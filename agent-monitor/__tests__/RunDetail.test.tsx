import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { RunDetail } from '@/components/RunDetail';

// Mock fetch
global.fetch = vi.fn();

describe('RunDetail Component', () => {
  const mockRun = {
    execution_id: 'exec_001',
    run_id: 'run_001',
    conversation_id: 'conv_001',
    status: 'COMPLETED',
    created_at_ms: Date.now() - 100000,
    updated_at_ms: Date.now() - 50000,
    step_index: 5,
    started_at_ms: Date.now() - 90000,
    completed_at_ms: Date.now() - 50000,
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
    duration_ms: 40000,
    message_count: 10,
    tool_call_count: 5,
  };

  const mockLogs = [
    {
      id: 1,
      step_index: 1,
      level: 'info',
      source: 'agent',
      message: '[Agent] run.start',
      error_json: null,
      created_at_ms: Date.now() - 90000,
    },
    {
      id: 2,
      step_index: 5,
      level: 'info',
      source: 'agent',
      message: '[Agent] run.finish',
      error_json: null,
      created_at_ms: Date.now() - 50000,
    },
  ];

  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should show loading state initially', () => {
    vi.mocked(global.fetch).mockResolvedValue({
      json: async () => ({ run: null, stats: null }),
    } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    expect(screen.getByText(/loading/i)).toBeInTheDocument();
  });

  it('should render run details after loading', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Run Details')).toBeInTheDocument();
    });

    expect(screen.getByText('exec_001')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument(); // Steps
  });

  it('should display token usage statistics', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Token Usage')).toBeInTheDocument();
    });

    expect(screen.getByText('4,000')).toBeInTheDocument(); // Prompt tokens
    expect(screen.getByText('1,000')).toBeInTheDocument(); // Completion tokens
    expect(screen.getByText('5,000')).toBeInTheDocument(); // Total tokens
  });

  it('should display duration', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Duration')).toBeInTheDocument();
    });

    expect(screen.getByText('40.0s')).toBeInTheDocument();
  });

  it('should display message count', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Messages')).toBeInTheDocument();
    });

    expect(screen.getByText('10')).toBeInTheDocument();
  });

  it('should render logs section', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Logs')).toBeInTheDocument();
    });

    expect(screen.getByText('[Agent] run.start')).toBeInTheDocument();
    expect(screen.getByText('[Agent] run.finish')).toBeInTheDocument();
  });

  it('should filter logs by level', async () => {
    const logsWithLevels = [
      {
        id: 1,
        step_index: 1,
        level: 'info',
        source: 'agent',
        message: 'Info log',
        error_json: null,
        created_at_ms: Date.now(),
      },
      {
        id: 2,
        step_index: 2,
        level: 'error',
        source: 'agent',
        message: 'Error log',
        error_json: null,
        created_at_ms: Date.now(),
      },
      {
        id: 3,
        step_index: 3,
        level: 'debug',
        source: 'tool',
        message: 'Debug log',
        error_json: null,
        created_at_ms: Date.now(),
      },
    ];

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: logsWithLevels }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Logs')).toBeInTheDocument();
    });

    // Should have level filter dropdown
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Run Details')).toBeInTheDocument();
    });

    const closeButton = screen.getByRole('button');
    closeButton.click();

    expect(mockOnClose).toHaveBeenCalled();
  });

  it('should display error information when run failed', async () => {
    const failedRun = {
      ...mockRun,
      status: 'FAILED',
      error_code: 'AGENT_UNKNOWN_ERROR',
      error_message: 'Test error message',
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: failedRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('AGENT_UNKNOWN_ERROR')).toBeInTheDocument();
    });
  });

  it('should display timestamps', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: mockRun, stats: mockStats }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('Timestamps')).toBeInTheDocument();
    });

    expect(screen.getByText('Created')).toBeInTheDocument();
    expect(screen.getByText('Started')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Last Updated')).toBeInTheDocument();
  });

  it('should handle running status', async () => {
    const runningRun = {
      ...mockRun,
      status: 'RUNNING',
      completed_at_ms: null,
    };

    vi.mocked(global.fetch)
      .mockResolvedValueOnce({
        json: async () => ({ run: runningRun, stats: { ...mockStats, duration_ms: 0 } }),
      } as any)
      .mockResolvedValueOnce({
        json: async () => ({ logs: mockLogs }),
      } as any);

    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);

    await waitFor(() => {
      expect(screen.getByText('RUNNING')).toBeInTheDocument();
    });
  });
});
