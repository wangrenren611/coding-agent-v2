import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { StatCards } from '@/components/StatCards';

describe('StatCards Component', () => {
  const mockStats = {
    total_runs: 150,
    running_runs: 5,
    completed_runs: 140,
    failed_runs: 3,
    cancelled_runs: 2,
    total_tokens: 75000,
    avg_duration_ms: 45000,
    total_errors: 15,
  };

  it('should render all stat cards', () => {
    render(<StatCards stats={mockStats} />);

    expect(screen.getByText('Total Runs')).toBeInTheDocument();
    expect(screen.getByText('Running')).toBeInTheDocument();
    expect(screen.getByText('Completed')).toBeInTheDocument();
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Total Tokens')).toBeInTheDocument();
    expect(screen.getByText('Errors')).toBeInTheDocument();
  });

  it('should display correct values', () => {
    render(<StatCards stats={mockStats} />);

    expect(screen.getByText('150')).toBeInTheDocument();
    expect(screen.getByText('5')).toBeInTheDocument();
    expect(screen.getByText('140')).toBeInTheDocument();
    expect(screen.getByText('3')).toBeInTheDocument();
    expect(screen.getByText('75,000')).toBeInTheDocument();
    expect(screen.getByText('15')).toBeInTheDocument();
  });

  it('should format large token numbers', () => {
    const largeStats = {
      ...mockStats,
      total_tokens: 1250000,
    };

    render(<StatCards stats={largeStats} />);
    expect(screen.getByText('1,250,000')).toBeInTheDocument();
  });

  it('should handle zero values', () => {
    const zeroStats = {
      total_runs: 0,
      running_runs: 0,
      completed_runs: 0,
      failed_runs: 0,
      cancelled_runs: 0,
      total_tokens: 0,
      avg_duration_ms: 0,
      total_errors: 0,
    };

    render(<StatCards stats={zeroStats} />);
    expect(screen.getAllByText('0')).toHaveLength(6);
  });

  it('should display icons for each stat', () => {
    const { container } = render(<StatCards stats={mockStats} />);
    const svgs = container.querySelectorAll('svg');

    // Should have 6 icons (one for each stat card)
    expect(svgs).toHaveLength(6);
  });

  it('should have proper grid layout classes', () => {
    const { container } = render(<StatCards stats={mockStats} />);
    const grid = container.firstChild;

    expect(grid).toHaveClass('grid');
    expect(grid).toHaveClass('grid-cols-2');
  });
});
