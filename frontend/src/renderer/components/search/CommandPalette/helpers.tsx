import React from 'react';

export function highlightMatch(context: string, matchedText: string): React.JSX.Element {
  const lowerContext = context.toLowerCase();
  const lowerMatch = matchedText.toLowerCase();
  const matchIndex = lowerContext.indexOf(lowerMatch);
  if (matchIndex === -1) return <span>{context}</span>;

  return (
    <>
      <span>{context.slice(0, matchIndex)}</span>
      <mark className="text-foreground rounded bg-yellow-400/20 px-0.5">
        {context.slice(matchIndex, matchIndex + matchedText.length)}
      </mark>
      <span>{context.slice(matchIndex + matchedText.length)}</span>
    </>
  );
}
