const NOISE_TAG_PATTERNS = [
  /<local-command-caveat>[\s\S]*?<\/local-command-caveat>/gi,
  /<system-reminder>[\s\S]*?<\/system-reminder>/gi,
];

function extractCommandOutput(content: string): string | null {
  const match = /<local-command-stdout>([\s\S]*?)<\/local-command-stdout>/i.exec(content);
  const matchStderr = /<local-command-stderr>([\s\S]*?)<\/local-command-stderr>/i.exec(content);
  if (match) {
    return match[1].trim();
  }
  if (matchStderr) {
    return matchStderr[1].trim();
  }
  return null;
}

function extractCommandDisplay(content: string): string | null {
  const commandNameMatch = /<command-name>\/([^<]+)<\/command-name>/.exec(content);
  const commandArgsMatch = /<command-args>([^<]*)<\/command-args>/.exec(content);

  if (commandNameMatch) {
    const commandName = `/${commandNameMatch[1].trim()}`;
    const args = commandArgsMatch?.[1]?.trim();
    return args ? `${commandName} ${args}` : commandName;
  }

  return null;
}

// Built-in commands start with <command-name>; skill commands start with <command-message>.
export function isCommandContent(content: string): boolean {
  return content.startsWith('<command-name>') || content.startsWith('<command-message>');
}

function isCommandOutputContent(content: string): boolean {
  return (
    content.startsWith('<local-command-stdout>') || content.startsWith('<local-command-stderr>')
  );
}

export function sanitizeDisplayContent(content: string): string {
  if (isCommandOutputContent(content)) {
    const commandOutput = extractCommandOutput(content);
    if (commandOutput) {
      return commandOutput;
    }
  }

  if (isCommandContent(content)) {
    const commandDisplay = extractCommandDisplay(content);
    if (commandDisplay) {
      return commandDisplay;
    }
  }

  let sanitized = content;
  for (const pattern of NOISE_TAG_PATTERNS) {
    sanitized = sanitized.replace(pattern, '');
  }

  sanitized = sanitized
    .replace(/<command-name>[\s\S]*?<\/command-name>/gi, '')
    .replace(/<command-message>[\s\S]*?<\/command-message>/gi, '')
    .replace(/<command-args>[\s\S]*?<\/command-args>/gi, '');

  return sanitized.trim();
}

export interface SlashInfo {
  name: string;
  message?: string;
  args?: string;
}

export function extractSlashInfo(content: string): SlashInfo | null {
  const nameMatch = /<command-name>\/([^<]+)<\/command-name>/.exec(content);
  if (!nameMatch) return null;

  const name = nameMatch[1].trim();

  const messageMatch = /<command-message>([^<]*)<\/command-message>/.exec(content);
  const argsMatch = /<command-args>([^<]*)<\/command-args>/.exec(content);

  return {
    name,
    message: messageMatch?.[1]?.trim() ?? undefined,
    args: argsMatch?.[1]?.trim() ?? undefined,
  };
}
