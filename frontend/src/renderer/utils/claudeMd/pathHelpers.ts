import type { ClaudeMdSource } from '../../types/claudeMd';

export function generateInjectionId(path: string): string {
  let hash = 0;
  for (let i = 0; i < path.length; i++) {
    const char = path.charCodeAt(i);
    hash = (hash << 5) - hash + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  const positiveHash = Math.abs(hash).toString(16);
  return `cmd-${positiveHash}`;
}

export function getDisplayName(path: string, _source: ClaudeMdSource): string {
  return path;
}

export function isAbsolutePath(path: string): boolean {
  return path.startsWith('/') || path.startsWith('\\\\') || /^[a-zA-Z]:[\\/]/.test(path);
}

export function joinPaths(base: string, relative: string): string {
  if (isAbsolutePath(relative)) {
    return relative;
  }

  const cleanBase = trimTrailingSeparator(base);

  let cleanRelative = relative;
  if (cleanRelative.startsWith('@')) {
    cleanRelative = cleanRelative.slice(1);
  }

  if (cleanRelative.startsWith('./')) {
    cleanRelative = cleanRelative.slice(2);
  }

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

export function getDirectory(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\'));
  if (lastSep === -1) return '';
  return filePath.slice(0, lastSep);
}

export function getParentDirectory(dirPath: string): string | null {
  const lastSep = Math.max(dirPath.lastIndexOf('/'), dirPath.lastIndexOf('\\'));
  if (lastSep <= 0) return null; // At root or invalid
  return dirPath.slice(0, lastSep);
}

export function isAtOrAbove(dirPath: string, stopPath: string): boolean {
  const normDir = normalizeForComparison(dirPath).replace(/\/$/, '');
  const normStop = normalizeForComparison(stopPath).replace(/\/$/, '');

  // dirPath is at or above stopPath if stopPath starts with dirPath
  return normStop === normDir || normStop.startsWith(normDir + '/');
}
