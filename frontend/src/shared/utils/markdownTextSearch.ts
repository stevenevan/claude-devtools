

import { toHast } from 'mdast-util-to-hast';
import remarkGfm from 'remark-gfm';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import type { Nodes as HastNodes } from 'hast';
import type { Root as MdastRoot } from 'mdast';

// ---------------------------------------------------------------------------
// Parser singleton
// ---------------------------------------------------------------------------

// eslint-disable-next-line @typescript-eslint/explicit-function-return-type -- inferred type used by MarkdownParser alias
function createParser() {
  return unified().use(remarkParse).use(remarkGfm);
}

type MarkdownParser = ReturnType<typeof createParser>;

let _parser: MarkdownParser | null = null;

function getParser(): MarkdownParser {
  if (!_parser) {
    _parser = createParser();
  }
  return _parser;
}

function parseMarkdown(text: string): MdastRoot {
  return getParser().parse(text);
}

// ---------------------------------------------------------------------------
// Segment cache (parse once, search many times per query keystroke)
// ---------------------------------------------------------------------------

const MAX_CACHE_SIZE = 1000;
const segmentCache = new Map<string, string[]>();

function getCachedSegments(markdown: string): string[] {
  const cached = segmentCache.get(markdown);
  if (cached) return cached;

  const segments = collectTextSegments(markdown);

  // Evict oldest entries when cache is full
  if (segmentCache.size >= MAX_CACHE_SIZE) {
    const firstKey = segmentCache.keys().next().value;
    if (firstKey !== undefined) segmentCache.delete(firstKey);
  }
  segmentCache.set(markdown, segments);
  return segments;
}

// ---------------------------------------------------------------------------
// HAST → text segments
// ---------------------------------------------------------------------------

const HL_TAGS = new Set([
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'code',
  'blockquote',
  'li',
  'th',
  'td',
]);

export function collectTextSegments(markdown: string): string[] {
  const mdast = parseMarkdown(markdown);
  const hast = toHast(mdast);
  if (!hast) return [];

  const segments: string[] = [];
  walkHast(hast, segments, false);
  return segments;
}

function walkHast(node: HastNodes, segments: string[], inHlElement: boolean): void {
  // Raw HTML nodes (e.g. <context>...</context>) are dropped by ReactMarkdown
  // without rehype-raw, so we must skip them to keep match counts aligned.
  if (node.type === 'raw') return;

  if (node.type === 'text') {
    if (inHlElement && node.value) {
      segments.push(node.value);
    }
    return;
  }

  if (node.type === 'element' || node.type === 'root') {
    const isHl = node.type === 'element' && HL_TAGS.has(node.tagName);
    for (const child of node.children) {
      walkHast(child as HastNodes, segments, inHlElement || isHl);
    }
  }
  // skip comments, doctypes
}

// ---------------------------------------------------------------------------
// Search functions
// ---------------------------------------------------------------------------

export interface MarkdownSearchMatch {
  matchIndexInItem: number;
}

export function findMarkdownSearchMatches(markdown: string, query: string): MarkdownSearchMatch[] {
  if (!query || !markdown) return [];

  // Fast pre-filter: skip expensive markdown parsing if query doesn't appear in raw text
  if (!markdown.toLowerCase().includes(query.toLowerCase())) return [];

  const segments = getCachedSegments(markdown);
  const lowerQuery = query.toLowerCase();
  const matches: MarkdownSearchMatch[] = [];
  let matchIndex = 0;

  for (const segment of segments) {
    const lowerSegment = segment.toLowerCase();
    let pos = 0;
    while ((pos = lowerSegment.indexOf(lowerQuery, pos)) !== -1) {
      matches.push({ matchIndexInItem: matchIndex });
      matchIndex++;
      pos += lowerQuery.length;
    }
  }

  return matches;
}

export function countMarkdownSearchMatches(markdown: string, query: string): number {
  if (!query || !markdown) return 0;

  // Fast pre-filter: skip expensive markdown parsing if query doesn't appear in raw text
  if (!markdown.toLowerCase().includes(query.toLowerCase())) return 0;

  const segments = getCachedSegments(markdown);
  const lowerQuery = query.toLowerCase();
  let count = 0;

  for (const segment of segments) {
    const lowerSegment = segment.toLowerCase();
    let pos = 0;
    while ((pos = lowerSegment.indexOf(lowerQuery, pos)) !== -1) {
      count++;
      pos += lowerQuery.length;
    }
  }

  return count;
}

export function extractMarkdownPlainText(markdown: string): string {
  if (!markdown) return '';
  const segments = getCachedSegments(markdown);
  return segments.join(' ');
}
