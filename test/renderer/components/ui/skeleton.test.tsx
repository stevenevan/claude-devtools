import { render } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Skeleton } from '@renderer/components/ui/skeleton';

describe('Skeleton', () => {
  it('renders a div with skeleton classes', () => {
    const { container } = render(<Skeleton />);
    const el = container.firstElementChild!;
    expect(el.tagName).toBe('DIV');
    expect(el.className).toContain('animate-pulse');
    expect(el.className).toContain('rounded-md');
  });

  it('has data-slot attribute', () => {
    const { container } = render(<Skeleton />);
    expect(container.firstElementChild).toHaveAttribute('data-slot', 'skeleton');
  });

  it('merges custom className', () => {
    const { container } = render(<Skeleton className="h-10 w-full" />);
    const el = container.firstElementChild!;
    expect(el.className).toContain('h-10');
    expect(el.className).toContain('animate-pulse');
  });

  it('passes through additional props', () => {
    const { container } = render(<Skeleton data-testid="skel" />);
    expect(container.querySelector('[data-testid="skel"]')).toBeInTheDocument();
  });
});
