import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Spinner } from '@renderer/components/ui/spinner';

describe('Spinner', () => {
  it('renders with role="status"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toBeInTheDocument();
  });

  it('has aria-label "Loading"', () => {
    render(<Spinner />);
    expect(screen.getByRole('status')).toHaveAttribute('aria-label', 'Loading');
  });

  it('has spin animation class', () => {
    render(<Spinner />);
    expect(screen.getByRole('status').className).toContain('animate-spin');
  });

  it('merges custom className', () => {
    render(<Spinner className="size-8" />);
    const el = screen.getByRole('status');
    expect(el.className).toContain('size-8');
    expect(el.className).toContain('animate-spin');
  });
});
