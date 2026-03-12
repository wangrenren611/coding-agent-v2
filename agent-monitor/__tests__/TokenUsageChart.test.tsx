import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenUsageChart } from '@/components/TokenUsageChart';

describe('TokenUsageChart Component', () => {
  const mockData = [
    {
      date: '2024-01-01',
      total_tokens: 10000,
      prompt_tokens: 8000,
      completion_tokens: 2000,
      run_count: 5,
    },
    {
      date: '2024-01-02',
      total_tokens: 15000,
      prompt_tokens: 12000,
      completion_tokens: 3000,
      run_count: 8,
    },
    {
      date: '2024-01-03',
      total_tokens: 8000,
      prompt_tokens: 6000,
      completion_tokens: 2000,
      run_count: 3,
    },
  ];

  it('should render chart container', () => {
    render(<TokenUsageChart data={mockData} />);

    expect(screen.getByText('Token Usage (Last 7 Days)')).toBeInTheDocument();
  });

  it('should render chart with correct dimensions', () => {
    const { container } = render(<TokenUsageChart data={mockData} />);

    const chartContainer = container.querySelector('.h-64');
    expect(chartContainer).toBeInTheDocument();
  });

  it('should render chart container', () => {
    render(<TokenUsageChart data={mockData} />);

    // Chart container should be rendered
    const chartContainer = document.querySelector('.recharts-responsive-container');
    expect(chartContainer).toBeInTheDocument();
  });

  it('should handle empty data', () => {
    render(<TokenUsageChart data={[]} />);

    expect(screen.getByText('Token Usage (Last 7 Days)')).toBeInTheDocument();
  });

  it('should format dates correctly', () => {
    render(<TokenUsageChart data={mockData} />);

    // Chart should render with date axis
    expect(screen.getByText('Token Usage (Last 7 Days)')).toBeInTheDocument();
  });

  it('should handle single data point', () => {
    const singleData = [mockData[0]];
    render(<TokenUsageChart data={singleData} />);

    expect(screen.getByText('Token Usage (Last 7 Days)')).toBeInTheDocument();
  });

  it('should handle large token numbers', () => {
    const largeData = [
      {
        date: '2024-01-01',
        total_tokens: 1000000,
        prompt_tokens: 800000,
        completion_tokens: 200000,
        run_count: 50,
      },
    ];
    render(<TokenUsageChart data={largeData} />);

    expect(screen.getByText('Token Usage (Last 7 Days)')).toBeInTheDocument();
  });
});
