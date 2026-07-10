import { JSX, useEffect, useRef, useState } from 'react';
import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { formatBytes } from '@renderer/utils/formatters';
import { AlertTriangle, RefreshCw } from 'lucide-react';

import { JsonDiffView } from './JsonDiffView';

import type {
  ClaudeJSONBackup,
  ClaudeJSONCensus,
  ClaudeJSONKey,
  ClaudeJSONProject,
} from '@shared/types/api';

const TRIAGE_BADGE: Record<string, string> = {
  live: 'bg-emerald-500/15 text-emerald-500',
  stale: 'bg-destructive/10 text-destructive',
  unverifiable: 'bg-amber-500/15 text-amber-500',
};

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function isClaudeJsonPath(path?: string): boolean {
  return !!path && path.split('/').pop() === '.claude.json';
}

// Read-only Week 20 inspector for ~/.claude.json: key census, project stale
// triage, flags, and masked-vs-masked backup diffs. Every value that reaches
// here is server-side masked; this panel writes and deletes nothing.
export const ClaudeJsonPanel = (): JSX.Element => {
  const [census, setCensus] = useState<ClaudeJSONCensus | null>(null);
  const [backups, setBackups] = useState<ClaudeJSONBackup[]>([]);
  const [liveMasked, setLiveMasked] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [stale, setStale] = useState(false);

  const [revealed, setRevealed] = useState<Record<string, string>>({});
  const [backupContents, setBackupContents] = useState<Record<string, string>>({});
  const loadedBackups = useRef<Set<string>>(new Set());
  const [diffLeft, setDiffLeft] = useState('live');
  const [diffRight, setDiffRight] = useState('');

  const load = async (): Promise<void> => {
    setLoading(true);
    setError(null);
    try {
      const [nextCensus, nextBackups, nextLive] = await Promise.all([
        api.readClaudeJSON(),
        api.listClaudeJSONBackups(),
        api.readClaudeJSONMasked(),
      ]);
      setCensus(nextCensus);
      setBackups(nextBackups);
      setLiveMasked(nextLive);
      setRevealed({});
      setBackupContents({});
      loadedBackups.current = new Set();
      setDiffLeft('live');
      setDiffRight(nextBackups[0]?.name ?? '');
      setStale(false);
    } catch (err) {
      setError(errText(err));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    // Recompute only on mount or explicit refresh — the CLI rewrites this file
    // constantly, so a config-file-change only marks the panel stale.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(
    () =>
      api.maintenance.onConfigFileChange((path) => {
        if (isClaudeJsonPath(path)) setStale(true);
      }),
    []
  );

  useEffect(() => {
    for (const name of [diffLeft, diffRight]) {
      if (!name || name === 'live' || loadedBackups.current.has(name)) continue;
      loadedBackups.current.add(name);
      api
        .readClaudeJSONBackup(name)
        .then((text) => setBackupContents((prev) => ({ ...prev, [name]: text })))
        .catch((err) => setBackupContents((prev) => ({ ...prev, [name]: `// ${errText(err)}` })));
    }
  }, [diffLeft, diffRight]);

  const toggleReveal = async (name: string): Promise<void> => {
    if (revealed[name] !== undefined) {
      setRevealed((prev) => {
        const next = { ...prev };
        delete next[name];
        return next;
      });
      return;
    }
    try {
      const value = await api.revealClaudeJSONValue(name);
      setRevealed((prev) => ({ ...prev, [name]: value }));
    } catch (err) {
      setRevealed((prev) => ({ ...prev, [name]: `(${errText(err)})` }));
    }
  };

  const leftText = diffLeft === 'live' ? liveMasked : (backupContents[diffLeft] ?? '');
  const rightText = diffRight ? (backupContents[diffRight] ?? '') : '';

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-start justify-between gap-2 border-b px-4 py-3">
        <div>
          <p className="text-foreground text-sm font-medium">~/.claude.json Inspector</p>
          <p className="text-muted-foreground mt-0.5 text-xs">
            Read-only X-ray of the CLI&apos;s state file. Credential-shaped values are masked;
            reveal is explicit and never surfaces raw tokens. Nothing here writes or deletes.
          </p>
        </div>
        <Button variant="outline" size="sm" disabled={loading} onClick={() => void load()}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      {stale && (
        <div className="border-border/50 bg-amber-500/10 flex items-center gap-2 border-b px-4 py-2 text-xs text-amber-500">
          <AlertTriangle className="size-3.5 shrink-0" />
          The CLI changed ~/.claude.json on disk. Refresh to recompute the census.
        </div>
      )}
      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {loading && <p className="text-muted-foreground px-4 py-3 text-xs">Loading…</p>}

      {!loading && census && (
        <>
          <p className="text-muted-foreground border-border/50 border-b px-4 py-2 text-xs">
            <span className="text-foreground font-mono">{census.path}</span> — {formatBytes(census.bytes)},{' '}
            {census.topLevel.length + census.flags.length} top-level keys, {census.projects.length} project
            entries
          </p>

          <ProjectSection projects={census.projects} />
          <KeySection
            title="Top-level keys"
            keys={census.topLevel}
            revealed={revealed}
            onToggleReveal={(name) => void toggleReveal(name)}
          />
          <KeySection
            title="Flags (hasSeen* / cached*)"
            keys={census.flags}
            revealed={revealed}
            onToggleReveal={(name) => void toggleReveal(name)}
          />

          <BackupsSection
            backups={backups}
            diffLeft={diffLeft}
            diffRight={diffRight}
            onSelectLeft={setDiffLeft}
            onSelectRight={setDiffRight}
            leftText={leftText}
            rightText={rightText}
          />
        </>
      )}
    </div>
  );
};

interface ProjectSectionProps {
  projects: ClaudeJSONProject[];
}

const ProjectSection = ({ projects }: Readonly<ProjectSectionProps>): JSX.Element => (
  <div className="border-border/50 border-b px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">Project entries</p>
    {projects.length === 0 ? (
      <p className="text-muted-foreground text-xs">No project entries.</p>
    ) : (
      <div className="flex flex-col gap-1">
        {projects.map((project) => (
          <div
            key={project.path}
            className="border-border/50 flex items-center justify-between gap-2 rounded-md border px-2 py-1.5"
          >
            <p className="text-foreground min-w-0 truncate font-mono text-xs" title={project.path}>
              {project.path}
            </p>
            <div className="flex shrink-0 items-center gap-2">
              <span className="text-muted-foreground text-[10px]">
                {project.keyCount} keys · {formatBytes(project.bytes)}
              </span>
              <span
                className={`rounded-sm px-1.5 py-px text-[10px] font-medium ${
                  TRIAGE_BADGE[project.triage] ?? 'bg-card/50 text-muted-foreground'
                }`}
              >
                {project.triage}
              </span>
            </div>
          </div>
        ))}
      </div>
    )}
  </div>
);

interface KeySectionProps {
  title: string;
  keys: ClaudeJSONKey[];
  revealed: Record<string, string>;
  onToggleReveal: (name: string) => void;
}

const KeySection = ({
  title,
  keys,
  revealed,
  onToggleReveal,
}: Readonly<KeySectionProps>): JSX.Element => (
  <div className="border-border/50 border-b px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">{title}</p>
    {keys.length === 0 ? (
      <p className="text-muted-foreground text-xs">None.</p>
    ) : (
      <div className="flex flex-col gap-1">
        {keys.map((key) => (
          <div key={key.name} className="border-border/50 rounded-md border px-2 py-1.5">
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2">
                <span className="text-foreground truncate font-mono text-xs">{key.name}</span>
                {key.secret && (
                  <span className="rounded-sm bg-amber-500/15 px-1 py-px text-[9px] font-medium text-amber-500">
                    secret
                  </span>
                )}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="text-muted-foreground text-[10px]">
                  {key.kind} · {formatBytes(key.bytes)}
                </span>
                <Button variant="outline" size="sm" onClick={() => onToggleReveal(key.name)}>
                  {revealed[key.name] !== undefined ? 'Hide' : 'Reveal'}
                </Button>
              </div>
            </div>
            {revealed[key.name] !== undefined && (
              <pre className="border-border/50 bg-card/50 text-muted-foreground mt-1.5 max-h-48 overflow-auto rounded-md border p-2 font-mono text-xs whitespace-pre-wrap">
                {revealed[key.name]}
              </pre>
            )}
          </div>
        ))}
      </div>
    )}
  </div>
);

interface BackupsSectionProps {
  backups: ClaudeJSONBackup[];
  diffLeft: string;
  diffRight: string;
  onSelectLeft: (name: string) => void;
  onSelectRight: (name: string) => void;
  leftText: string;
  rightText: string;
}

const BackupsSection = ({
  backups,
  diffLeft,
  diffRight,
  onSelectLeft,
  onSelectRight,
  leftText,
  rightText,
}: Readonly<BackupsSectionProps>): JSX.Element => (
  <div className="px-4 py-3">
    <p className="text-foreground mb-2 text-xs font-medium">Backups (CLI-generated, masked)</p>
    {backups.length === 0 ? (
      <p className="text-muted-foreground text-xs">No backups found in ~/.claude/backups.</p>
    ) : (
      <>
        <div className="mb-2 flex flex-col gap-1">
          {backups.map((backup) => (
            <div
              key={backup.name}
              className="border-border/50 flex items-center justify-between gap-2 rounded-md border px-2 py-1"
            >
              <span className="text-foreground truncate font-mono text-[11px]" title={backup.name}>
                {backup.name}
              </span>
              <span className="text-muted-foreground shrink-0 text-[10px]">
                {backup.modTime.toLocaleString()} · {formatBytes(backup.bytes)}
              </span>
            </div>
          ))}
        </div>

        <div className="mb-2 flex flex-wrap items-center gap-3">
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            Left
            <select
              value={diffLeft}
              onChange={(e) => onSelectLeft(e.target.value)}
              className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 text-xs"
            >
              <option value="live">Live (masked)</option>
              {backups.map((backup) => (
                <option key={backup.name} value={backup.name}>
                  {backup.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-muted-foreground flex items-center gap-1 text-xs">
            Right
            <select
              value={diffRight}
              onChange={(e) => onSelectRight(e.target.value)}
              className="border-border/50 bg-card/50 text-foreground rounded-sm border px-2 py-1 text-xs"
            >
              {backups.map((backup) => (
                <option key={backup.name} value={backup.name}>
                  {backup.name}
                </option>
              ))}
            </select>
          </label>
        </div>

        <JsonDiffView
          left={leftText || '{}'}
          right={rightText || '{}'}
          leftLabel={diffLeft === 'live' ? 'Live (masked)' : diffLeft}
          rightLabel={diffRight || 'backup'}
          redactSecrets
        />
      </>
    )}
  </div>
);
