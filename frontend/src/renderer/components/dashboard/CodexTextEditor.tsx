import { JSX, useEffect, useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { Loader2 } from 'lucide-react';

import type {
  CodexTextApplyResult,
  CodexTextPreviewResult,
} from '@shared/types/api';

interface CodexTextEditorProps {
  readonly title: string;
  readonly initialContent: string;
  readonly expectedRevision: string;
  readonly canAct: boolean;
  readonly onCancel: () => void;
  readonly onPreview: (
    content: string,
    expectedRevision: string
  ) => Promise<CodexTextPreviewResult>;
  readonly onApply: (
    content: string,
    expectedRevision: string
  ) => Promise<CodexTextApplyResult>;
  readonly onApplied: () => Promise<void> | void;
}

export const CodexTextEditor = ({
  title,
  initialContent,
  expectedRevision,
  canAct,
  onCancel,
  onPreview,
  onApply,
  onApplied,
}: Readonly<CodexTextEditorProps>): JSX.Element => {
  const [content, setContent] = useState(initialContent);
  const [preview, setPreview] = useState<CodexTextPreviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [working, setWorking] = useState(false);

  useEffect(() => {
    setContent(initialContent);
    setPreview(null);
    setError(null);
  }, [initialContent, expectedRevision]);

  const dirty = content !== initialContent;

  const handlePreview = async (): Promise<void> => {
    setWorking(true);
    setError(null);
    try {
      setPreview(await onPreview(content, expectedRevision));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  const handleApply = async (): Promise<void> => {
    if (!preview || preview.status !== 'ready') return;
    setWorking(true);
    setError(null);
    try {
      const result = await onApply(content, expectedRevision);
      if (result.status === 'conflict') {
        setPreview(result);
        return;
      }
      await onApplied();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setWorking(false);
    }
  };

  return (
    <div className="flex flex-col">
      <div className="border-border/50 flex items-center justify-between gap-2 border-b px-4 py-3">
        <div className="flex items-center gap-2">
          <p className="text-foreground text-sm font-medium">{title}</p>
          {dirty && (
            <span className="rounded-sm bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-500">
              Unsaved changes
            </span>
          )}
        </div>
        <Button type="button" variant="outline" size="sm" disabled={working} onClick={onCancel}>
          Cancel
        </Button>
      </div>

      {error && (
        <div className="border-border/50 bg-destructive/10 text-destructive border-b px-4 py-2 text-xs">
          {error}
        </div>
      )}

      {!canAct && (
        <div className="border-border/50 bg-card/50 text-muted-foreground border-b px-4 py-2 text-xs">
          Codex edits are available only on the local machine.
        </div>
      )}

      <div className="flex flex-col gap-2 px-4 py-3">
        <p className="text-muted-foreground text-xs">
          This is untrusted local text. Preview the complete bounded diff before applying it. A
          recovery copy is created before a successful write.
        </p>
        <textarea
          value={content}
          onChange={(event) => {
            setContent(event.target.value);
            setPreview(null);
          }}
          disabled={!canAct || working}
          spellCheck={false}
          className="border-border/50 bg-card/50 text-foreground min-h-[320px] w-full rounded-md border p-3 font-mono text-xs leading-relaxed"
          aria-label={title}
        />
      </div>

      {preview && <CodexPreview result={preview} />}

      <div className="border-border/50 flex items-center justify-end gap-2 border-t px-4 py-3">
        <Button
          type="button"
          variant="outline"
          disabled={!dirty || working || !canAct}
          onClick={() => void handlePreview()}
        >
          {working && <Loader2 className="size-3.5 animate-spin" />}
          Preview changes
        </Button>
        <Button
          type="button"
          disabled={preview?.status !== 'ready' || working || !canAct}
          onClick={() => void handleApply()}
        >
          {working && <Loader2 className="size-3.5 animate-spin" />}
          Apply preview
        </Button>
      </div>
    </div>
  );
};

const CodexPreview = ({
  result,
}: Readonly<{ result: CodexTextPreviewResult }>): JSX.Element => {
  if (result.status === 'conflict') {
    return (
      <div className="border-border/50 bg-destructive/10 text-destructive mx-4 mb-3 rounded-md border px-3 py-2 text-xs">
        <p className="font-medium">The file changed on disk.</p>
        <p className="mt-1">Reload it before trying to preview or apply these edits again.</p>
        <p className="mt-1 font-mono text-[10px]">Expected {result.data.expectedRevision}</p>
        <p className="font-mono text-[10px]">Actual {result.data.actualRevision}</p>
      </div>
    );
  }

  const data = result.data;
  return (
    <div className="border-border/50 bg-card/50 mx-4 mb-3 rounded-md border">
      <div className="border-border/50 flex items-center justify-between gap-2 border-b px-3 py-2">
        <p className="text-foreground text-xs font-medium">Preview</p>
        <span className="text-muted-foreground text-[10px]">
          {data.diff.length} changed line{data.diff.length === 1 ? '' : 's'}
        </span>
      </div>
      {data.warnings.length > 0 && (
        <ul className="border-border/50 space-y-1 border-b px-3 py-2">
          {data.warnings.map((warning, index) => (
            <li key={`${warning}-${index}`} className="text-muted-foreground text-xs">
              {warning}
            </li>
          ))}
        </ul>
      )}
      <pre className="max-h-72 overflow-auto px-3 py-2 font-mono text-[10px] leading-relaxed">
        {data.diff.length === 0
          ? 'No content changes.'
          : data.diff.map((line, index) => (
              <span
                key={`${line.kind}-${index}`}
                className={line.kind === 'add' ? 'text-emerald-400' : 'text-red-400'}
              >
                {line.kind === 'add' ? '+ ' : '- '}
                {line.text}
                {'\n'}
              </span>
            ))}
      </pre>
    </div>
  );
};
