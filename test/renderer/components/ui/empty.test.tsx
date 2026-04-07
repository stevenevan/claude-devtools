import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from '@renderer/components/ui/empty';

describe('Empty', () => {
  it('renders children', () => {
    render(<Empty>No data</Empty>);
    expect(screen.getByText('No data')).toBeInTheDocument();
  });

  it('has data-slot attribute', () => {
    const { container } = render(<Empty>Empty</Empty>);
    expect(container.querySelector('[data-slot="empty"]')).toBeInTheDocument();
  });
});

describe('EmptyHeader', () => {
  it('renders with data-slot', () => {
    const { container } = render(<EmptyHeader>Header</EmptyHeader>);
    expect(container.querySelector('[data-slot="empty-header"]')).toBeInTheDocument();
  });
});

describe('EmptyTitle', () => {
  it('renders title text', () => {
    render(<EmptyTitle>No results found</EmptyTitle>);
    expect(screen.getByText('No results found')).toBeInTheDocument();
  });

  it('has data-slot attribute', () => {
    const { container } = render(<EmptyTitle>Title</EmptyTitle>);
    expect(container.querySelector('[data-slot="empty-title"]')).toBeInTheDocument();
  });
});

describe('EmptyDescription', () => {
  it('renders description text', () => {
    render(<EmptyDescription>Try adjusting your search</EmptyDescription>);
    expect(screen.getByText('Try adjusting your search')).toBeInTheDocument();
  });

  it('has data-slot attribute', () => {
    const { container } = render(<EmptyDescription>Desc</EmptyDescription>);
    expect(container.querySelector('[data-slot="empty-description"]')).toBeInTheDocument();
  });
});

describe('EmptyMedia', () => {
  it('renders with default variant', () => {
    const { container } = render(<EmptyMedia>Icon</EmptyMedia>);
    const el = container.querySelector('[data-slot="empty-icon"]')!;
    expect(el).toBeInTheDocument();
    expect(el).toHaveAttribute('data-variant', 'default');
  });

  it('renders with icon variant', () => {
    const { container } = render(<EmptyMedia variant="icon">Icon</EmptyMedia>);
    const el = container.querySelector('[data-slot="empty-icon"]')!;
    expect(el).toHaveAttribute('data-variant', 'icon');
    expect(el.className).toContain('rounded-md');
  });
});

describe('EmptyContent', () => {
  it('renders content children', () => {
    const { container } = render(<EmptyContent>Content here</EmptyContent>);
    expect(container.querySelector('[data-slot="empty-content"]')).toBeInTheDocument();
    expect(screen.getByText('Content here')).toBeInTheDocument();
  });
});

describe('Empty composition', () => {
  it('composes all subcomponents together', () => {
    render(
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">Icon</EmptyMedia>
          <EmptyTitle>No sessions</EmptyTitle>
          <EmptyDescription>Start a Claude Code session to see it here</EmptyDescription>
        </EmptyHeader>
        <EmptyContent>Extra info</EmptyContent>
      </Empty>
    );
    expect(screen.getByText('No sessions')).toBeInTheDocument();
    expect(screen.getByText('Start a Claude Code session to see it here')).toBeInTheDocument();
    expect(screen.getByText('Extra info')).toBeInTheDocument();
  });
});
