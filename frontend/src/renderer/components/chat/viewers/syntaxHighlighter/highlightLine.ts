import { ReactNode, createElement } from 'react';

import { KEYWORDS } from './keywords';

export function highlightLine(line: string, language: string): ReactNode[] {
  const keywords = KEYWORDS[language] || new Set();

  if (keywords.size === 0 && !['json', 'css', 'html', 'bash', 'markdown'].includes(language)) {
    return [line];
  }

  const segments: ReactNode[] = [];
  let currentPos = 0;
  const lineLength = line.length;

  while (currentPos < lineLength) {
    const remaining = line.slice(currentPos);

    if (remaining.startsWith('"')) {
      const endQuote = remaining.indexOf('"', 1);
      if (endQuote !== -1) {
        const str = remaining.slice(0, endQuote + 1);
        segments.push(
          createElement('span', { key: currentPos, style: { color: 'rgb(74 222 128)' } }, str)
        );
        currentPos += str.length;
        continue;
      }
    }

    if (remaining.startsWith("'")) {
      const endQuote = remaining.indexOf("'", 1);
      if (endQuote !== -1) {
        const str = remaining.slice(0, endQuote + 1);
        segments.push(
          createElement('span', { key: currentPos, style: { color: 'rgb(74 222 128)' } }, str)
        );
        currentPos += str.length;
        continue;
      }
    }

    if (remaining.startsWith('`')) {
      const endQuote = remaining.indexOf('`', 1);
      if (endQuote !== -1) {
        const str = remaining.slice(0, endQuote + 1);
        segments.push(
          createElement('span', { key: currentPos, style: { color: 'rgb(74 222 128)' } }, str)
        );
        currentPos += str.length;
        continue;
      }
    }

    if (remaining.startsWith('//')) {
      segments.push(
        createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(113 113 122)', fontStyle: 'italic' } },
          remaining
        )
      );
      break;
    }

    if (
      (language === 'python' ||
        language === 'bash' ||
        language === 'r' ||
        language === 'ruby' ||
        language === 'php') &&
      remaining.startsWith('#')
    ) {
      segments.push(
        createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(113 113 122)', fontStyle: 'italic' } },
          remaining
        )
      );
      break;
    }

    if (language === 'sql' && remaining.startsWith('--')) {
      segments.push(
        createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(113 113 122)', fontStyle: 'italic' } },
          remaining
        )
      );
      break;
    }

    const numberMatch = /^(\d+\.?\d*)/.exec(remaining);
    if (numberMatch && (currentPos === 0 || /\W/.test(line[currentPos - 1]))) {
      segments.push(
        createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(251 146 60)' } },
          numberMatch[1]
        )
      );
      currentPos += numberMatch[1].length;
      continue;
    }

    const wordMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(remaining);
    if (wordMatch) {
      const word = wordMatch[1];
      if (keywords.has(word) || (language === 'sql' && keywords.has(word.toUpperCase()))) {
        segments.push(
          createElement(
            'span',
            { key: currentPos, style: { color: 'rgb(192 132 252)', fontWeight: 500 } },
            word
          )
        );
      } else if ((word[0]?.toUpperCase() ?? '') === word[0] && word.length > 1) {
        segments.push(
          createElement(
            'span',
            { key: currentPos, style: { color: 'rgb(250 204 21)' } },
            word
          )
        );
      } else {
        segments.push(word);
      }
      currentPos += word.length;
      continue;
    }

    const opMatch = /^([=<>!+\-*/%&|^~?:;,.{}()[\]])/.exec(remaining);
    if (opMatch) {
      segments.push(
        createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(161 161 170)' } },
          opMatch[1]
        )
      );
      currentPos += 1;
      continue;
    }

    segments.push(remaining[0]);
    currentPos += 1;
  }

  return segments;
}
