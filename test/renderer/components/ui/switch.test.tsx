import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Switch } from '@renderer/components/ui/switch';

describe('Switch', () => {
  it('renders a switch', () => {
    render(<Switch aria-label="Toggle feature" />);
    expect(screen.getByRole('switch')).toBeInTheDocument();
  });

  it('defaults to unchecked', () => {
    render(<Switch aria-label="Feature" />);
    expect(screen.getByRole('switch')).not.toBeChecked();
  });

  it('renders checked when defaultChecked', () => {
    render(<Switch defaultChecked aria-label="Feature" />);
    expect(screen.getByRole('switch')).toBeChecked();
  });

  it('toggles on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Switch aria-label="Feature" onCheckedChange={onChange} />);
    await user.click(screen.getByRole('switch'));
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('applies sm size data attribute', () => {
    render(<Switch size="sm" aria-label="Small" />);
    expect(screen.getByRole('switch')).toHaveAttribute('data-size', 'sm');
  });

  it('applies default size data attribute', () => {
    render(<Switch aria-label="Default" />);
    expect(screen.getByRole('switch')).toHaveAttribute('data-size', 'default');
  });

  it('is disabled when disabled prop set', () => {
    render(<Switch disabled aria-label="Disabled" />);
    expect(screen.getByRole('switch')).toHaveAttribute('aria-disabled', 'true');
  });
});
