import React from 'react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import { RunDetail } from '@/components/RunDetail';

global.fetch = vi.fn();

describe('RunDetail Component', () => {
  const mockRun = {
    execution_id: 'exec_001', run_id: 'run_001', conversation_id: 'conv_001',
    status: 'COMPLETED', created_at_ms: Date.now() - 100000, updated_at_ms: Date.now() - 50000,
    step_index: 5, started_at_ms: Date.now() - 90000, completed_at_ms: Date.now() - 50000,
    terminal_reason: 'stop', error_code: null, error_category: null, error_message: null,
  };

  const mockStats = {
    execution_id: 'exec_001', total_tokens: 5000, prompt_tokens: 4000, completion_tokens: 1000,
    duration_ms: 40000, message_count: 10, tool_call_count: 5,
  };

  const mockLogs = [
    { id: 1, step_index: 1, level: 'info', source: 'agent', message: '[Agent] run.start', error_json: null, created_at_ms: Date.now() - 90000 },
    { id: 2, step_index: 5, level: 'info', source: 'agent', message: '[Agent] run.finish', error_json: null, created_at_ms: Date.now() - 50000 },
  ];

  const mockOnClose = vi.fn();

  beforeEach(() => { vi.clearAllMocks(); });

  it('should show loading state initially', () => {
    vi.mocked(global.fetch).mockResolvedValue({ json: async () => ({ run: null, stats: null }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    expect(screen.getByText(/Loading/i)).toBeInTheDocument();
  });

  it('should render run details after loading', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: mockRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: mockLogs }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('Run Details')).toBeInTheDocument(); });
    expect(screen.getByText('exec_001')).toBeInTheDocument();
    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
  });

  it('should display token usage statistics', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: mockRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: mockLogs }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('Token Usage')).toBeInTheDocument(); });
    expect(screen.getByText('4,000')).toBeInTheDocument();
    expect(screen.getByText('1,000')).toBeInTheDocument();
    expect(screen.getByText('5,000')).toBeInTheDocument();
  });

  it('should display duration', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: mockRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: mockLogs }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('Duration')).toBeInTheDocument(); });
    expect(screen.getByText('40.0s')).toBeInTheDocument();
  });

  it('should render logs section', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: mockRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: mockLogs }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('[Agent] run.start')).toBeInTheDocument(); });
    expect(screen.getByText('[Agent] run.finish')).toBeInTheDocument();
  });

  it('should filter logs by level', async () => {
    const logsWithLevels = [
      { id: 1, step_index: 1, level: 'info', source: 'agent', message: 'Info log message', error_json: null, created_at_ms: Date.now() },
      { id: 2, step_index: 2, level: 'error', source: 'agent', message: 'Error log message', error_json: null, created_at_ms: Date.now() },
    ];
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: mockRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: logsWithLevels }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('Info log message')).toBeInTheDocument(); });
    const errorFilter = screen.getByRole('button', { name: 'Error' });
    fireEvent.click(errorFilter);
    expect(screen.getByText('Error log message')).toBeInTheDocument();
    expect(screen.queryByText('Info log message')).not.toBeInTheDocument();
  });

  it('should call onClose when close button is clicked', async () => {
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: mockRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: mockLogs }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('Run Details')).toBeInTheDocument(); });
    const buttons = screen.getAllByRole('button');
    const closeButton = buttons.find(btn => btn.querySelector('svg'));
    if (closeButton) { fireEvent.click(closeButton); expect(mockOnClose).toHaveBeenCalled(); }
  });

  it('should display error message when run has error', async () => {
    const errorRun = { ...mockRun, status: 'FAILED', error_code: 'ERR', error_category: 'agent', error_message: 'Test error message' };
    vi.mocked(global.fetch)
      .mockResolvedValueOnce({ json: async () => ({ run: errorRun, stats: mockStats }) } as any)
      .mockResolvedValueOnce({ json: async () => ({ logs: mockLogs }) } as any);
    render(<RunDetail executionId="exec_001" onClose={mockOnClose} />);
    await waitFor(() => { expect(screen.getByText('Test error message')).toBeInTheDocument(); });
  });
});
