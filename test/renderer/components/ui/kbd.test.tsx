import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { Kbd, KbdGroup } from '@renderer/components/ui/kbd';

describe('Kbd', () => {
  it('renders keyboard shortcut text', () => {
    render(<Kbd>Ctrl</Kbd>);
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
  });

  it('renders as a kbd element', () => {
    render(<Kbd>K</Kbd>);
    expect(screen.getByText('K').tagName).toBe('KBD');
  });

  it('has data-slot attribute', () => {
    render(<Kbd>Enter</Kbd>);
    expect(screen.getByText('Enter')).toHaveAttribute('data-slot', 'kbd');
  });

  it('merges custom className', () => {
    render(<Kbd className="custom-kbd">Esc</Kbd>);
    expect(screen.getByText('Esc').className).toContain('custom-kbd');
  });
});

describe('KbdGroup', () => {
  it('renders multiple Kbd children', () => {
    render(
      <KbdGroup>
        <Kbd>Ctrl</Kbd>
        <Kbd>K</Kbd>
      </KbdGroup>
    );
    expect(screen.getByText('Ctrl')).toBeInTheDocument();
    expect(screen.getByText('K')).toBeInTheDocument();
  });

  it('has data-slot attribute', () => {
    const { container } = render(
      <KbdGroup>
        <Kbd>A</Kbd>
      </KbdGroup>
    );
    expect(container.querySelector('[data-slot="kbd-group"]')).toBeInTheDocument();
  });
});
