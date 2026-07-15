// Config backup / export-import DTOs (Week 24). A Manifest describes one stored
// whole-profile backup; ImportPreview is the fail-closed review a caller must
// approve one category at a time before ApplyImport. createdMs is plain epoch-ms
// (a number, never a Date — do not reviveDates it).

// FileEntry is one captured file: root-relative path, byte size, and SHA-256
// (hex) of the captured bytes.
export interface FileEntry {
  relPath: string;
  size: number;
  sha256: string;
}

// SkillLink records a symlinked skill by name + raw link target only — never its
// out-of-root content.
export interface SkillLink {
  name: string;
  target: string;
}

export interface Manifest {
  id: string;
  label: string;
  createdMs: number;
  secretsIncluded: boolean;
  files: FileEntry[];
  skillLinks: SkillLink[];
}

// ImportPreview enumerates EVERY hook command string (full text) and EVERY
// permission rule the imported settings.json carries, the confirmable category
// ids, whether the archive shipped secrets, and the resolved archive path.
// archivePath === "" means the user cancelled the native OpenFile dialog.
export interface ImportPreview {
  hookCommands: string[];
  permissionRules: string[];
  categories: string[];
  secretsIncluded: boolean;
  archivePath: string;
}
