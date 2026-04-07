import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

const mockCopy = vi.fn();
vi.mock('@renderer/hooks/mantine', () => ({
  useClipboard: () => ({ copy: mockCopy, copied: false }),
}));

import { CopyButton } from '@renderer/components/common/CopyButton';

describe('CopyButton', () => {
  it('renders inline mode with a button', () => {
    render(<CopyButton text="hello" inline />);
    expect(screen.getByRole('button', { name: 'Copy to clipboard' })).toBeInTheDocument();
  });

  it('calls copy with text on inline click', async () => {
    const user = userEvent.setup();
    render(<CopyButton text="copy this" inline />);
    await user.click(screen.getByRole('button', { name: 'Copy to clipboard' }));
    expect(mockCopy).toHaveBeenCalledWith('copy this');
  });

  it('renders overlay mode by default', () => {
    const { container } = render(<CopyButton text="text" />);
    expect(container.querySelector('.absolute')).toBeInTheDocument();
  });

  it('calls copy on overlay button click', async () => {
    const user = userEvent.setup();
    mockCopy.mockClear();
    const { container } = render(<CopyButton text="overlay text" />);
    const btn = container.querySelector('button')!;
    await user.click(btn);
    expect(mockCopy).toHaveBeenCalledWith('overlay text');
  });
});
