import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { RunTable } from '@/components/RunTable';

describe('RunTable Component', () => {
  const mockRuns = [
    {
      execution_id: 'exec_001',
      status: 'COMPLETED',
      created_at_ms: Date.now() - 100000,
      step_index: 5,
      terminal_reason: 'stop',
      error_code: null,
      error_message: null,
    },
    {
      execution_id: 'exec_002',
      status: 'RUNNING',
      created_at_ms: Date.now() - 50000,
      step_index: 3,
      terminal_reason: null,
      error_code: null,
      error_message: null,
    },
    {
      execution_id: 'exec_003',
      status: 'FAILED',
      created_at_ms: Date.now() - 80000,
      step_index: 10,
      terminal_reason: 'error',
      error_code: 'AGENT_UNKNOWN_ERROR',
      error_message: 'Test error',
    },
    {
      execution_id: 'exec_004',
      status: 'CANCELLED',
      created_at_ms: Date.now() - 30000,
      step_index: 2,
      terminal_reason: 'aborted',
      error_code: null,
      error_message: null,
    },
  ];

  const mockOnSelectRun = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should render table with all runs', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    expect(screen.getByText('exec_001')).toBeInTheDocument();
    expect(screen.getByText('exec_002')).toBeInTheDocument();
    expect(screen.getByText('exec_003')).toBeInTheDocument();
    expect(screen.getByText('exec_004')).toBeInTheDocument();
  });

  it('should display status badges', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    expect(screen.getByText('COMPLETED')).toBeInTheDocument();
    expect(screen.getByText('RUNNING')).toBeInTheDocument();
    expect(screen.getByText('FAILED')).toBeInTheDocument();
    expect(screen.getByText('CANCELLED')).toBeInTheDocument();
  });

  it('should display step counts', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('10')).toBeInTheDocument();
    expect(screen.getByText('2')).toBeInTheDocument();
  });

  it('should show error code for failed runs', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    expect(screen.getByText('AGENT_UNKNOWN_ERROR')).toBeInTheDocument();
  });

  it('should call onSelectRun when row is clicked', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    const row = screen.getByText('exec_001').closest('tr');
    fireEvent.click(row!);

    expect(mockOnSelectRun).toHaveBeenCalledWith('exec_001');
  });

  it('should filter by search text', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    const searchInput = screen.getByPlaceholderText('Search execution ID...');
    fireEvent.change(searchInput, { target: { value: 'exec_001' } });

    expect(screen.getByText('exec_001')).toBeInTheDocument();
    expect(screen.queryByText('exec_002')).not.toBeInTheDocument();
  });

  it('should filter by status', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    const statusSelect = screen.getByRole('combobox');
    fireEvent.change(statusSelect, { target: { value: 'COMPLETED' } });

    expect(screen.getByText('exec_001')).toBeInTheDocument();
  });

  it('should show all runs when "All Status" is selected', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    const statusSelect = screen.getByRole('combobox');
    fireEvent.change(statusSelect, { target: { value: 'all' } });

    expect(screen.getByText('exec_001')).toBeInTheDocument();
    expect(screen.getByText('exec_002')).toBeInTheDocument();
  });

  it('should show empty state when no runs match filter', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    const searchInput = screen.getByPlaceholderText('Search execution ID...');
    fireEvent.change(searchInput, { target: { value: 'non_existent' } });

    expect(screen.getByText('No runs found')).toBeInTheDocument();
  });

  it('should display time information', () => {
    render(<RunTable runs={mockRuns} onSelectRun={mockOnSelectRun} />);

    // Should have time column with relative time
    const timeCells = document.querySelectorAll('td');
    expect(timeCells.length).toBeGreaterThan(0);
  });
});
