// Strategy: strip project root → replace home with ~ → middle-truncate if still too long.
// resolveAbsolutePath() reverses this for clipboard copy.
export function shortenDisplayPath(fullPath: string, projectRoot?: string, maxLength = 40): string {
  let p = fullPath;

  // 1. Make relative to project root
  if (projectRoot) {
    const root = projectRoot.replace(/[/\\]$/, '');
    if (p.startsWith(root + '/') || p.startsWith(root + '\\')) {
      p = p.slice(root.length + 1);
    }
  }

  // 2. Replace home directory with ~
  p = p
    .replace(/^\/Users\/[^/]+/, '~')
    .replace(/^\/home\/[^/]+/, '~')
    .replace(/^[A-Z]:\\Users\\[^\\]+/, '~');

  // 3. If short enough, return as-is
  if (p.length <= maxLength) return p;

  // 4. Middle-truncate: keep first meaningful segments + … + last 2 segments
  const sep = p.includes('\\') ? '\\' : '/';
  const segments = p.split(sep);

  // Skip leading empty segment from absolute paths, or "~"
  let startIdx = 0;
  if (segments[0] === '' || segments[0] === '~') startIdx = 1;

  if (segments.length - startIdx <= 3) return p;

  const head = segments.slice(0, startIdx + 1).join(sep);
  const tail = segments.slice(-2).join(sep);

  return `${head}${sep}\u2026${sep}${tail}`;
}

function inferHomeDir(projectRoot: string): string | null {
  const match =
    /^(\/Users\/[^/]+)/.exec(projectRoot) ??
    /^(\/home\/[^/]+)/.exec(projectRoot) ??
    /^([A-Z]:\\Users\\[^\\]+)/.exec(projectRoot);
  return match?.[1] ?? null;
}

export function resolveAbsolutePath(filePath: string, projectRoot?: string): string {
  let p = filePath;

  if (p.startsWith('~/') && projectRoot) {
    const homeDir = inferHomeDir(projectRoot);
    if (homeDir) {
      p = homeDir + p.slice(1);
    }
  }

  if (projectRoot && !p.startsWith('/') && !p.startsWith('~') && !/^[A-Z]:[/\\]/.test(p)) {
    p = projectRoot.replace(/[/\\]$/, '') + '/' + p;
  }

  return p;
}
