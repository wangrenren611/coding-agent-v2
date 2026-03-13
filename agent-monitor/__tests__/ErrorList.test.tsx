import React from 'react';
import { describe, it, expect } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorList } from '@/components/ErrorList';

describe('ErrorList Component', () => {
  const mockErrors = [
    {
      id: 1, execution_id: 'exec_001', step_index: 5, level: 'error',
      code: 'AGENT_UNKNOWN_ERROR', source: 'agent', message: '[Agent] run.error',
      error_json: JSON.stringify({ name: 'UnknownError', message: 'Responses stream failed' }),
      created_at_ms: Date.now() - 100000,
    },
    {
      id: 2, execution_id: 'exec_002', step_index: 10, level: 'error',
      code: 'TIMEOUT_ERROR', source: 'tool', message: '[Tool] execute timeout',
      error_json: null, created_at_ms: Date.now() - 50000,
    },
  ];

  it('should render empty state when no errors', () => {
    render(<ErrorList errors={[]} />);
    expect(screen.getByText('No errors found')).toBeInTheDocument();
    expect(screen.getByText('Recent Errors')).toBeInTheDocument();
  });

  it('should render list of errors', () => {
    render(<ErrorList errors={mockErrors} />);
    expect(screen.getByText('Recent Errors')).toBeInTheDocument();
  });

  it('should display error code', () => {
    render(<ErrorList errors={mockErrors} />);
    expect(screen.getByText('AGENT_UNKNOWN_ERROR')).toBeInTheDocument();
  });

  it('should expand error details on click', () => {
    render(<ErrorList errors={mockErrors} />);
    const errorItem = screen.getByText('AGENT_UNKNOWN_ERROR').closest('[class*="cursor-pointer"]');
    if (errorItem) { fireEvent.click(errorItem); }
    expect(screen.getByText('[Agent] run.error')).toBeInTheDocument();
  });

  it('should display source information', () => {
    render(<ErrorList errors={mockErrors} />);
    const srcElements = screen.getAllByText(/Source:/);
    expect(srcElements.length).toBeGreaterThan(0);
  });

  it('should render multiple errors', () => {
    render(<ErrorList errors={mockErrors} />);
    expect(screen.getByText('AGENT_UNKNOWN_ERROR')).toBeInTheDocument();
    expect(screen.getByText('TIMEOUT_ERROR')).toBeInTheDocument();
  });
});
