import { ReactNode, Children, isValidElement, cloneElement } from 'react';

// eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
function highlightTextNode(text: string, validatedPaths: Record<string, boolean>): ReactNode {
  const pathPattern = /@[^\s,)}\]]+/g;
  const parts: ReactNode[] = [];
  let lastIndex = 0;
  let match;

  pathPattern.lastIndex = 0;
  while ((match = pathPattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }

    const fullMatch = match[0];
    const isValid = validatedPaths[fullMatch] === true;

    if (isValid) {
      parts.push(
        <span
          key={match.index}
          className="border-border bg-muted text-foreground rounded border px-1.5 py-0.5 font-mono text-[0.8125em]"
        >
          {fullMatch}
        </span>
      );
    } else {
      parts.push(fullMatch);
    }

    lastIndex = match.index + fullMatch.length;
  }

  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }

  if (parts.length === 0) return text;
  if (parts.length === 1) return parts[0];
  return parts;
}

// eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
export function highlightPaths(
  children: ReactNode,
  validatedPaths: Record<string, boolean>
): ReactNode {
  // eslint-disable-next-line sonarjs/function-return-type -- React child manipulation inherently returns mixed node types
  return Children.map(children, (child): ReactNode => {
    if (typeof child === 'string') {
      return highlightTextNode(child, validatedPaths);
    }

    if (isValidElement<{ children?: ReactNode }>(child) && child.props.children) {
      return cloneElement(
        child,
        undefined,
        highlightPaths(child.props.children, validatedPaths)
      );
    }

    return child;
  });
}
