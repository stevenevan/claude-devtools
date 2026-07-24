export interface CommandFields {
  description?: string;
  argumentHint?: string;
  allowedTools?: string;
  model?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  // True when allowed-tools was a multiline YAML list on disk (not a simple
  // inline scalar) — the raw lines stay in unknownLines and the field itself
  // is left unset so serialize doesn't clobber the list.
  allowedToolsIsComplex?: boolean;
}

export interface ParsedCommandFrontmatter {
  fields: CommandFields;
  unknownLines: string[];
  body: string;
  hasFrontmatter: boolean;
}

function unquote(value: string): string {
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"')
    ? value.slice(1, -1)
    : value;
}

// Mirrors AgentDetailEditor's quoteDescription escaping so a changed field
// round-trips through the naive line-level frontmatter writer. Values that
// contain a real newline can't be represented on a single "key: value" line,
// so the caller is expected to route those through raw mode instead.
function quoteFrontmatterValue(value: string): string {
  if (value.includes('\n')) {
    throw new Error('Value contains a newline — edit this field in raw mode.');
  }
  const needsQuoting =
    value === '' ||
    /^\s|\s$/.test(value) ||
    value.includes(': ') ||
    value.includes('"') ||
    /^(---|\[|\{|#|&|\*)/.test(value);
  if (!needsQuoting) return value;
  const escaped = value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
  return `"${escaped}"`;
}

// Line-scans a command .md's leading "---" fence the same way AgentDetail's
// parseAgentContent does. Only the 6 known keys are parsed into typed fields;
// every other line (unknown keys, comments, blanks) is preserved verbatim in
// unknownLines so serialize can put them back byte-identical.
export function parseCommandFrontmatter(raw: string): ParsedCommandFrontmatter {
  const fields: CommandFields = {};
  const unknownLines: string[] = [];

  let lead = 0;
  while (lead < raw.length && /\s/.test(raw[lead])) lead++;
  const afterLead = raw.slice(lead);
  if (!afterLead.startsWith('---')) {
    return { fields, unknownLines, body: raw, hasFrontmatter: false };
  }

  const rest = afterLead.slice(3);
  const end = rest.indexOf('\n---');
  if (end < 0) {
    return { fields, unknownLines, body: raw, hasFrontmatter: false };
  }

  const block = rest.slice(0, end);
  const closeAndAfter = rest.slice(end);
  const afterFence = closeAndAfter.slice('\n---'.length);
  const nl = afterFence.indexOf('\n');
  const body = nl < 0 ? '' : afterFence.slice(nl + 1);

  const lines = block.split('\n');
  // block always starts with the newline right after the opening fence, so
  // lines[0] is a split artifact, not real content.
  const startIdx = lines[0] === '' ? 1 : 0;

  for (let i = startIdx; i < lines.length; i++) {
    const rawLine = lines[i];
    const trimmed = rawLine.trim();
    const ci = trimmed.indexOf(':');
    if (ci < 0) {
      unknownLines.push(rawLine);
      continue;
    }
    const key = trimmed.slice(0, ci).trim();
    const val = trimmed.slice(ci + 1).trim();

    if (key === 'description') {
      fields.description = unquote(val);
    } else if (key === 'argument-hint') {
      fields.argumentHint = unquote(val);
    } else if (key === 'model') {
      fields.model = unquote(val);
    } else if (key === 'disable-model-invocation') {
      fields.disableModelInvocation = val === 'true';
    } else if (key === 'user-invocable') {
      fields.userInvocable = val === 'true';
    } else if (key === 'allowed-tools') {
      const isListStart = val === '' && i + 1 < lines.length && /^\s+-/.test(lines[i + 1]);
      if (isListStart) {
        fields.allowedToolsIsComplex = true;
        unknownLines.push(rawLine);
        let j = i + 1;
        while (j < lines.length && /^\s+-/.test(lines[j])) {
          unknownLines.push(lines[j]);
          j++;
        }
        i = j - 1;
      } else {
        fields.allowedTools = unquote(val);
      }
    } else {
      unknownLines.push(rawLine);
    }
  }

  return { fields, unknownLines, body, hasFrontmatter: true };
}

// Rebuilds the fence from typed fields + preserved unknown lines. Structured
// fields are emitted first, then the unknown lines byte-identical, never
// reordered or dropped. When there's nothing to emit (no fields set, no
// unknown lines — e.g. a file that had no frontmatter to begin with), no
// fence is written at all so a no-frontmatter file round-trips untouched.
export function serializeCommandFrontmatter(
  fields: CommandFields,
  unknownLines: string[],
  body: string
): string {
  const fieldLines: string[] = [];
  if (fields.description !== undefined) {
    fieldLines.push(`description: ${quoteFrontmatterValue(fields.description)}`);
  }
  if (fields.argumentHint !== undefined) {
    fieldLines.push(`argument-hint: ${quoteFrontmatterValue(fields.argumentHint)}`);
  }
  if (fields.allowedTools !== undefined) {
    fieldLines.push(`allowed-tools: ${quoteFrontmatterValue(fields.allowedTools)}`);
  }
  if (fields.model !== undefined) {
    fieldLines.push(`model: ${quoteFrontmatterValue(fields.model)}`);
  }
  if (fields.disableModelInvocation !== undefined) {
    fieldLines.push(`disable-model-invocation: ${fields.disableModelInvocation}`);
  }
  if (fields.userInvocable !== undefined) {
    fieldLines.push(`user-invocable: ${fields.userInvocable}`);
  }

  const contentLines = [...fieldLines, ...unknownLines];
  if (contentLines.length === 0) return body;
  return `---\n${contentLines.join('\n')}\n---\n${body}`;
}
