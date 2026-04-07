import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { OngoingBanner, OngoingIndicator } from '@renderer/components/common/OngoingIndicator';

describe('OngoingIndicator', () => {
  it('renders with title attribute', () => {
    const { container } = render(<OngoingIndicator />);
    expect(container.querySelector('[title="Session in progress"]')).toBeInTheDocument();
  });

  it('hides label by default', () => {
    render(<OngoingIndicator />);
    expect(screen.queryByText('Session in progress...')).not.toBeInTheDocument();
  });

  it('shows label when showLabel is true', () => {
    render(<OngoingIndicator showLabel />);
    expect(screen.getByText('Session in progress...')).toBeInTheDocument();
  });

  it('shows custom label text', () => {
    render(<OngoingIndicator showLabel label="Running..." />);
    expect(screen.getByText('Running...')).toBeInTheDocument();
  });

  it('applies sm size (smaller dot)', () => {
    const { container } = render(<OngoingIndicator size="sm" />);
    const dot = container.querySelector('.relative.flex.shrink-0');
    expect(dot?.className).toContain('h-2');
    expect(dot?.className).toContain('w-2');
  });

  it('applies md size (larger dot)', () => {
    const { container } = render(<OngoingIndicator size="md" />);
    const dot = container.querySelector('.relative.flex.shrink-0');
    expect(dot?.className).toContain('h-2.5');
    expect(dot?.className).toContain('w-2.5');
  });
});

describe('OngoingBanner', () => {
  it('renders banner text', () => {
    render(<OngoingBanner />);
    expect(screen.getByText('Session is in progress...')).toBeInTheDocument();
  });

  it('has animated spinner', () => {
    const { container } = render(<OngoingBanner />);
    expect(container.querySelector('.animate-spin')).toBeInTheDocument();
  });
});
