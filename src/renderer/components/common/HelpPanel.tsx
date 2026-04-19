import { useState } from 'react';

import { Button } from '@renderer/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@renderer/components/ui/dialog';
import { cn } from '@renderer/lib/utils';

interface HelpPanelProps {
  open: boolean;
  onClose: () => void;
}

type Tab = 'getting-started' | 'features' | 'shortcuts' | 'faq';

const TABS: { id: Tab; label: string }[] = [
  { id: 'getting-started', label: 'Getting Started' },
  { id: 'features', label: 'Features' },
  { id: 'shortcuts', label: 'Shortcuts' },
  { id: 'faq', label: 'FAQ' },
];

const isMac = navigator.platform.includes('Mac');
const mod = isMac ? '⌘' : 'Ctrl';

const SHORTCUT_SECTIONS = [
  {
    title: 'Navigation',
    items: [
      { keys: `${mod}+K`, description: 'Open command palette' },
      { keys: `${mod}+Shift+F`, description: 'Advanced search' },
      { keys: `${mod}+,`, description: 'Open settings' },
      { keys: `${mod}+\\`, description: 'Toggle sidebar' },
      { keys: 'J / K', description: 'Next / previous AI turn' },
    ],
  },
  {
    title: 'Tabs',
    items: [
      { keys: 'Ctrl+Tab', description: 'Next tab' },
      { keys: 'Ctrl+Shift+Tab', description: 'Previous tab' },
      { keys: `${mod}+W`, description: 'Close tab' },
      { keys: `${mod}+Shift+W`, description: 'Close all tabs' },
    ],
  },
  {
    title: 'Session',
    items: [
      { keys: `${mod}+R`, description: 'Refresh session' },
      { keys: `${mod}+F`, description: 'Find in session' },
      { keys: `${mod}+G`, description: 'Next search match' },
      { keys: `${mod}+Shift+G`, description: 'Previous search match' },
    ],
  },
];

const FEATURES = [
  {
    title: 'Session viewer',
    body: 'Reads every JSONL in ~/.claude/projects and reconstructs the turn-by-turn trace with tool calls, subagents, and context injection breakdowns.',
  },
  {
    title: 'Bookmarks, tags, annotations',
    body: 'Save any AI turn as a bookmark, attach free-form colored annotations, and tag whole sessions from the sidebar.',
  },
  {
    title: 'Analytics dashboard',
    body: 'Cost trend, tool usage, error hotspots, and top sessions aggregated across projects. Supports 1/7/30/90-day ranges.',
  },
  {
    title: 'Search',
    body: 'Command palette (' +
      mod +
      '+K) performs in-session search; toggle Global to search across every project.',
  },
  {
    title: 'Side-by-side comparison',
    body: 'Open two sessions in the comparison view to walk through divergence points turn-by-turn.',
  },
];

const FAQ = [
  {
    q: 'Where does data come from?',
    a: 'Local JSONL session files under ~/.claude/projects/. Nothing is sent off your machine.',
  },
  {
    q: 'How do I change the Claude data root?',
    a: 'Settings → General → Local Claude Root, then pick a folder. On Windows the WSL helper auto-discovers distributions.',
  },
  {
    q: 'Why are some sessions missing?',
    a: 'Sessions that contain only noise entries (system reminders, command stdout, etc.) are filtered out by default.',
  },
  {
    q: 'Can I run this in a browser?',
    a: 'Settings → Browser Access → Enable server mode starts an embedded HTTP server on localhost:3456 for iframe/browser use.',
  },
];

export const HelpPanel = ({ open, onClose }: Readonly<HelpPanelProps>): React.JSX.Element => {
  const [activeTab, setActiveTab] = useState<Tab>('getting-started');

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-h-[80vh] max-w-3xl overflow-hidden p-0">
        <DialogHeader className="border-border border-b px-5 py-4">
          <DialogTitle>Help & Reference</DialogTitle>
          <DialogDescription>Quick answers, feature tour, and shortcuts.</DialogDescription>
        </DialogHeader>

        <div className="flex h-full max-h-[calc(80vh-4rem)] min-h-[360px]">
          <nav className="border-border bg-sidebar flex w-44 shrink-0 flex-col gap-0.5 border-r p-2">
            {TABS.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={cn(
                  'text-muted-foreground hover:text-foreground hover:bg-surface-raised rounded-sm px-2 py-1.5 text-left text-xs transition-colors',
                  activeTab === tab.id && 'bg-surface-raised text-foreground'
                )}
              >
                {tab.label}
              </button>
            ))}
          </nav>

          <div className="flex-1 overflow-y-auto p-5 text-sm">
            {activeTab === 'getting-started' && (
              <div className="space-y-3">
                <h3 className="text-foreground text-base font-semibold">Getting Started</h3>
                <ol className="text-muted-foreground list-decimal space-y-2 pl-4 text-xs">
                  <li>
                    Pick a project in the sidebar. Sessions listed are parsed from your local
                    ~/.claude/projects data.
                  </li>
                  <li>
                    Open a session — the chat history reconstructs user turns, AI responses,
                    subagents, and tool executions.
                  </li>
                  <li>
                    Use the Activity Bar on the left to switch between Projects, Analytics,
                    Agents, Skills, Plugins, and Annotations.
                  </li>
                  <li>
                    Press <kbd className="border-border rounded-sm border px-1">{mod}+K</kbd> to
                    search conversations at any time.
                  </li>
                </ol>
              </div>
            )}

            {activeTab === 'features' && (
              <div className="space-y-4">
                <h3 className="text-foreground text-base font-semibold">Features</h3>
                <ul className="flex flex-col gap-3">
                  {FEATURES.map((f) => (
                    <li key={f.title} className="border-border bg-card rounded-md border p-3">
                      <div className="text-foreground text-sm font-medium">{f.title}</div>
                      <p className="text-muted-foreground mt-1 text-xs">{f.body}</p>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {activeTab === 'shortcuts' && (
              <div className="space-y-4">
                <h3 className="text-foreground text-base font-semibold">Keyboard Shortcuts</h3>
                {SHORTCUT_SECTIONS.map((section) => (
                  <div key={section.title}>
                    <div className="text-muted-foreground mb-1 text-xs font-medium tracking-wider uppercase">
                      {section.title}
                    </div>
                    <div className="flex flex-col">
                      {section.items.map((item) => (
                        <div
                          key={`${section.title}-${item.keys}`}
                          className="border-border/60 flex items-center justify-between border-b py-1.5 text-xs last:border-b-0"
                        >
                          <span className="text-muted-foreground">{item.description}</span>
                          <kbd className="border-border bg-background font-mono rounded-sm border px-1.5 py-0.5 text-[11px]">
                            {item.keys}
                          </kbd>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}

            {activeTab === 'faq' && (
              <div className="space-y-3">
                <h3 className="text-foreground text-base font-semibold">FAQ</h3>
                <dl className="flex flex-col gap-3">
                  {FAQ.map((entry) => (
                    <div key={entry.q} className="border-border bg-card rounded-md border p-3">
                      <dt className="text-foreground text-xs font-medium">{entry.q}</dt>
                      <dd className="text-muted-foreground mt-1 text-xs">{entry.a}</dd>
                    </div>
                  ))}
                </dl>
              </div>
            )}
          </div>
        </div>

        <div className="border-border flex items-center justify-end border-t px-5 py-3">
          <Button variant="secondary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
