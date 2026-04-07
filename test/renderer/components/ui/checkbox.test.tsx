import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { Checkbox } from '@renderer/components/ui/checkbox';

describe('Checkbox', () => {
  it('renders an unchecked checkbox', () => {
    render(<Checkbox aria-label="Accept" />);
    expect(screen.getByRole('checkbox')).toBeInTheDocument();
    expect(screen.getByRole('checkbox')).not.toBeChecked();
  });

  it('renders checked when defaultChecked', () => {
    render(<Checkbox defaultChecked aria-label="Accept" />);
    expect(screen.getByRole('checkbox')).toBeChecked();
  });

  it('toggles on click', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<Checkbox aria-label="Toggle" onCheckedChange={onChange} />);
    await user.click(screen.getByRole('checkbox'));
    expect(onChange).toHaveBeenCalledWith(true, expect.anything());
  });

  it('is disabled when disabled prop set', () => {
    render(<Checkbox disabled aria-label="Disabled" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-disabled', 'true');
  });

  it('merges custom className', () => {
    render(<Checkbox className="custom-check" aria-label="Custom" />);
    expect(screen.getByRole('checkbox').className).toContain('custom-check');
  });
});
