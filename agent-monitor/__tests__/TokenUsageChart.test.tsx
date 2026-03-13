import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TokenUsageChart } from '@/components/TokenUsageChart';

describe('TokenUsageChart Component', () => {
  const mockData = [
    { date: '2024-01-01', total_tokens: 10000, prompt_tokens: 8000, completion_tokens: 2000, run_count: 5 },
    { date: '2024-01-02', total_tokens: 15000, prompt_tokens: 12000, completion_tokens: 3000, run_count: 8 },
    { date: '2024-01-03', total_tokens: 8000, prompt_tokens: 6000, completion_tokens: 2000, run_count: 3 },
  ];

  it('should render chart title', () => {
    render(<TokenUsageChart data={mockData} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('should render chart with correct dimensions', () => {
    const { container } = render(<TokenUsageChart data={mockData} />);
    expect(container.querySelector('.h-64')).toBeInTheDocument();
  });

  it('should render chart container', () => {
    render(<TokenUsageChart data={mockData} />);
    expect(document.querySelector('.recharts-responsive-container')).toBeInTheDocument();
  });

  it('should handle empty data', () => {
    render(<TokenUsageChart data={[]} />);
    expect(screen.getByText('Token Usage')).toBeInTheDocument();
  });

  it('should render with card styling', () => {
    const { container } = render(<TokenUsageChart data={mockData} />);
    expect(container.querySelector('.card')).toBeInTheDocument();
  });
});
