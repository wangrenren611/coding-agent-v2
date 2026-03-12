import React from 'react';
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ErrorList } from '@/components/ErrorList';

describe('ErrorList Component', () => {
  const mockErrors = [
    {
      id: 1,
      execution_id: 'exec_001',
      step_index: 5,
      level: 'error',
      code: 'AGENT_UNKNOWN_ERROR',
      source: 'agent',
      message: '[Agent] run.error',
      error_json: JSON.stringify({
        name: 'UnknownError',
        message: 'Responses stream failed',
        stack: 'Error: Responses stream failed\n    at test.ts:10:5',
      }),
      created_at_ms: Date.now() - 100000,
    },
    {
      id: 2,
      execution_id: 'exec_002',
      step_index: 10,
      level: 'error',
      code: 'TIMEOUT_ERROR',
      source: 'tool',
      message: '[Tool] execute timeout',
      error_json: null,
      created_at_ms: Date.now() - 50000,
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

  it('should display execution ID', () => {
    render(<ErrorList errors={mockErrors} />);

    expect(screen.getByText('exec_001')).toBeInTheDocument();
  });

  it('should show stack trace toggle when error_json has stack', () => {
    render(<ErrorList errors={mockErrors} />);

    expect(screen.getByText('Show stack trace')).toBeInTheDocument();
  });

  it('should display stack trace when expanded', () => {
    render(<ErrorList errors={mockErrors} />);

    const toggle = screen.getByText('Show stack trace');
    toggle.click();

    expect(screen.getByText(/Error: Responses stream failed/i)).toBeInTheDocument();
  });

  it('should call onDismiss when dismiss button is clicked', () => {
    const onDismiss = vi.fn();
    render(<ErrorList errors={mockErrors} onDismiss={onDismiss} />);

    const dismissButtons = screen.getAllByRole('button');
    dismissButtons[0].click();

    expect(onDismiss).toHaveBeenCalledWith(1);
  });

  it('should not show dismiss button when onDismiss is not provided', () => {
    const { container } = render(<ErrorList errors={mockErrors} />);

    // Should not have dismiss buttons (X icons)
    const dismissButtons = container.querySelectorAll('[aria-label="dismiss"]');
    expect(dismissButtons).toHaveLength(0);
  });

  it('should handle invalid error_json gracefully', () => {
    const errorsWithInvalidJson = [
      {
        ...mockErrors[0],
        error_json: 'invalid json {',
      },
    ];

    expect(() => {
      render(<ErrorList errors={errorsWithInvalidJson as any} />);
    }).not.toThrow();

    expect(screen.getByText('AGENT_UNKNOWN_ERROR')).toBeInTheDocument();
  });
});
