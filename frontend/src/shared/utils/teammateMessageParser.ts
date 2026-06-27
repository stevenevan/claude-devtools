

export interface ParsedTeammateContent {
  teammateId: string;
  color: string;
  summary: string;
  content: string;
}

const TEAMMATE_BLOCK_RE =
  /<teammate-message\s+teammate_id="([^"]+)"([^>]*)>([\s\S]*?)<\/teammate-message>/g;

const COLOR_RE = /color="([^"]*)"/;
const SUMMARY_RE = /summary="([^"]*)"/;

export function parseAllTeammateMessages(rawContent: string): ParsedTeammateContent[] {
  const results: ParsedTeammateContent[] = [];
  const regex = new RegExp(TEAMMATE_BLOCK_RE.source, TEAMMATE_BLOCK_RE.flags);

  let match: RegExpExecArray | null;
  while ((match = regex.exec(rawContent)) !== null) {
    const teammateId = match[1];
    const attrs = match[2];
    const content = match[3].trim();

    const colorMatch = COLOR_RE.exec(attrs);
    const summaryMatch = SUMMARY_RE.exec(attrs);

    results.push({
      teammateId,
      color: colorMatch?.[1] ?? '',
      summary: summaryMatch?.[1] ?? '',
      content,
    });
  }

  return results;
}
