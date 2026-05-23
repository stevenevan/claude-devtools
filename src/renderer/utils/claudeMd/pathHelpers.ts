import type { ClaudeMdSource } from '../../types/claudeMd';

/**
 * Generate a unique ID for an injection based on its path.
 * Uses a simple hash-like approach for readability.
 */
export function generateInjectionId(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  // Convert to positive hex string
  const positiveHash = Math.abs(hash).toString(16);
  return `cmd-${positiveHash}`;
}

/**
 * Create a display name for a CLAUDE.md injection.
 * Returns the raw path for transparency.
 */
export function getDisplayName(path: string, _source: ClaudeMdSource): string {
  return path;
}

/**
 * Check if a path is absolute (starts with /).
 */
export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(path);
}

/**
 * Join paths, handling various path formats properly.
 * Handles:
 * - Absolute paths: /full/path/file.tsx (returned as-is)
 * - Relative paths with ./: ./apps/foo/bar.tsx (strips ./)
 * - Parent paths with ../: ../other/file.tsx (walks up directories)
 * - Plain paths: apps/foo/bar.tsx (joins with base)
 * - Paths with @ prefix: @apps/foo/bar.tsx (strips @ then joins)
 */
export function joinPaths(base: string, relative: string): string {
  if (isAbsolutePath(relative)) {
    return relative;
  }

  const cleanBase = trimTrailingSeparator(base);

  // Handle @ prefix (file mention marker) - strip it if present
  let cleanRelative = relative;
  if (cleanRelative.startsWith('@')) {
    cleanRelative = cleanRelative.slice(1);
  }

  // Handle ./ prefix (current directory)
  if (cleanRelative.startsWith('./')) {
    cleanRelative = cleanRelative.slice(2);
  }

  // Handle ../ prefixes (parent directory)
  const separator = cleanBase.includes('\\') ? '\\' : '/';
  const hasUnixRoot = cleanBase.startsWith('/');
  const hasUncRoot = cleanBase.startsWith('\\\\');
  const normalizedRelative = normalizeSeparators(cleanRelative, separator);
  const baseParts = splitPath(cleanBase);
  let remainingRelative = normalizedRelative;
  while (remainingRelative.startsWith(`..${separator}`)) {
    remainingRelative = remainingRelative.slice(3);
    if (baseParts.length > 1) {
      baseParts.pop();
    }
  }

  // Join the normalized paths
  let normalizedBase = baseParts.join(separator);
  if (hasUnixRoot && !normalizedBase.startsWith('/')) {
    normalizedBase = `/${normalizedBase}`;
  }
  if (hasUncRoot && !normalizedBase.startsWith('\\\\')) {
    normalizedBase = `\\\\${normalizedBase}`;
  }
  return remainingRelative ? `${normalizedBase}${separator}${remainingRelative}` : normalizedBase;
}

function trimTrailingSeparator(input: string): string {
  let end = input.length;
  while (end > 0) {
    const char = input[end - 1];
    if (char !== '/' && char !== '\\') {
      break;
    }
    end--;
  }
  return input.slice(0, end);
}

function normalizeSeparators(input: string, separator: '/' | '\\'): string {
  let output = '';
  let prevWasSeparator = false;

  for (const char of input) {
    const isSeparator = char === '/' || char === '\\';
    if (isSeparator) {
      if (!prevWasSeparator) {
        output += separator;
      }
      prevWasSeparator = true;
    } else {
      output += char;
      prevWasSeparator = false;
    }
  }

  return output;
}

function splitPath(input: string): string[] {
  const parts: string[] = [];
  let current = '';

  for (const char of input) {
    if (char === '/' || char === '\\') {
      if (current.length > 0) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current.length > 0) {
    parts.push(current);
  }

  return parts;
}

export function normalizeForComparison(input: string): string {
  return input.replace(/\\/g, '/');
}

/**
 * Get the directory containing a file.
 */
export function getDirectory(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSep === -1) return '';
  return filePath.slice(0, lastSep);
}

/**
 * Get the parent directory of a path.
 */
export function getParentDirectory(dirPath: string): string | null {
  const lastSep = Math.max(dirPath.lastIndexOf('/'), dirPath.lastIndexOf('\\'));
  if (lastSep <= 0) return null; // At root or invalid
  return dirPath.slice(0, lastSep);
}

/**
 * Check if dirPath is at or above stopPath in the directory tree.
 */
export function isAtOrAbove(dirPath: string, stopPath: string): boolean {
  const normDir = normalizeForComparison(dirPath).replace(/\/$/, '');
  const normStop = normalizeForComparison(stopPath).replace(/\/$/, '');

  // dirPath is at or above stopPath if stopPath starts with dirPath
  return normStop === normDir || normStop.startsWith(normDir + '/');
}
