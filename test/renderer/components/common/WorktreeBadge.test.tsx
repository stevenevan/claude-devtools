import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { WorktreeBadge } from '@renderer/components/common/WorktreeBadge';

describe('WorktreeBadge', () => {
  it('renders "Default" for isMain=true', () => {
    render(<WorktreeBadge source="git" isMain />);
    expect(screen.getByText('Default')).toBeInTheDocument();
  });

  it('renders label for vibe-kanban source', () => {
    render(<WorktreeBadge source="vibe-kanban" />);
    expect(screen.getByText('Vibe')).toBeInTheDocument();
  });

  it('renders label for conductor source', () => {
    render(<WorktreeBadge source="conductor" />);
    expect(screen.getByText('Conductor')).toBeInTheDocument();
  });

  it('renders label for auto-claude source', () => {
    render(<WorktreeBadge source="auto-claude" />);
    expect(screen.getByText('Auto')).toBeInTheDocument();
  });

  it('renders label for claude-desktop source', () => {
    render(<WorktreeBadge source="claude-desktop" />);
    expect(screen.getByText('Desktop')).toBeInTheDocument();
  });

  it('renders label for ccswitch source', () => {
    render(<WorktreeBadge source="ccswitch" />);
    expect(screen.getByText('ccswitch')).toBeInTheDocument();
  });

  it('returns null for git source (not isMain)', () => {
    const { container } = render(<WorktreeBadge source="git" />);
    expect(container.firstChild).toBeNull();
  });

  it('returns null for unknown source', () => {
    const { container } = render(<WorktreeBadge source="unknown" />);
    expect(container.firstChild).toBeNull();
  });

  it('shows title with source name', () => {
    render(<WorktreeBadge source="conductor" />);
    expect(screen.getByTitle('Created by Conductor')).toBeInTheDocument();
  });

  it('merges custom className', () => {
    render(<WorktreeBadge source="vibe-kanban" className="extra" />);
    expect(screen.getByText('Vibe').className).toContain('extra');
  });
});
