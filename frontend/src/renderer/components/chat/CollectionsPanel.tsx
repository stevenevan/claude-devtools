import { useRef, useState } from 'react';

import { api } from '@renderer/api';
import { Button } from '@renderer/components/ui/button';
import { useStore } from '@renderer/store';
import { Download, Upload } from 'lucide-react';

import type { AnnotationImportReport } from '@shared/types/api';

function summarizeReport(report: AnnotationImportReport): string {
  return [
    `${report.annotationsAdded} added`,
    `${report.annotationsUpdated} updated`,
    `${report.annotationsSkipped} skipped`,
    `· ${report.bookmarksAdded} bookmarks added`,
  ].join(' · ');
}

export const CollectionsPanel = (): React.JSX.Element => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const refreshAfterImport = async (): Promise<void> => {
    const fetchAnnotations = useStore.getState().fetchAnnotations;
    await fetchAnnotations();
  };

  const handleExport = async (): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const json = await api.config.exportAnnotations([]);
      const blob = new Blob([json], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `claude-annotations-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
      setStatus('Exported successfully.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Export failed');
    } finally {
      setBusy(false);
    }
  };

  const handleImportFile = async (file: File): Promise<void> => {
    setBusy(true);
    setStatus(null);
    try {
      const text = await file.text();
      const report = await api.config.importAnnotations(text);
      await refreshAfterImport();
      setStatus(`Imported: ${summarizeReport(report)}`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Import failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="border-border bg-surface-raised flex flex-col gap-2 rounded-md border p-3">
      <div className="text-text-secondary text-xs font-medium">Collections</div>
      <p className="text-text-muted text-[11px]">
        Export all annotations + bookmarks to a portable JSON file, or import a previously exported
        bundle. Conflict resolution: newer-timestamp wins.
      </p>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleExport()}
          disabled={busy}
          className="gap-1 text-[11px]"
        >
          <Download className="size-3" />
          Export
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => fileInputRef.current?.click()}
          disabled={busy}
          className="gap-1 text-[11px]"
        >
          <Upload className="size-3" />
          Import
        </Button>
        <input
          ref={fileInputRef}
          type="file"
          accept="application/json,.json"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) void handleImportFile(file);
            if (fileInputRef.current) fileInputRef.current.value = '';
          }}
          className="hidden"
        />
      </div>
      {status && <div className="text-text-muted text-[10px]">{status}</div>}
    </div>
  );
};
