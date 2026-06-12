// Cross-platform: renderer has no Node `path` module; handles both `/` and `\`.

const SEP_RE = /[\\/]/;

export function getBaseName(filePath: string): string {
  const parts = filePath.split(SEP_RE);
  return parts[parts.length - 1] || '';
}

export function getFirstSegment(filePath: string): string {
  const parts = filePath.split(SEP_RE).filter(Boolean);
  return parts[0] ?? '';
}

export function splitPathSegments(filePath: string): string[] {
  return filePath.split(SEP_RE).filter(Boolean);
}

export function hasPathSeparator(filePath: string): boolean {
  return SEP_RE.test(filePath);
}

export function isRelativePath(filePath: string): boolean {
  return /^\.\.?[\\/]/.test(filePath);
}
