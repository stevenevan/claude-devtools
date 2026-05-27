import React from 'react';

import { KEYWORDS } from './keywords';

/**
 * Very basic tokenization for syntax highlighting.
 * This is a simple approach without a full parser.
 */
export function highlightLine(line: string, language: string): React.ReactNode[] {
  const keywords = KEYWORDS[language] || new Set();

  // If no highlighting support, return plain text as single-element array
  if (keywords.size === 0 && !['json', 'css', 'html', 'bash', 'markdown'].includes(language)) {
    return [line];
  }

  const segments: React.ReactNode[] = [];
  let currentPos = 0;
  const lineLength = line.length;

  while (currentPos < lineLength) {
    const remaining = line.slice(currentPos);

    // Check for string (double quote)
    if (remaining.startsWith('"')) {
      const endQuote = remaining.indexOf('"', 1);
      if (endQuote !== -1) {
        const str = remaining.slice(0, endQuote + 1);
        segments.push(
          React.createElement('span', { key: currentPos, style: { color: 'rgb(74 222 128)' } }, str)
        );
        currentPos += str.length;
        continue;
      }
    }

    // Check for string (single quote)
    if (remaining.startsWith("'")) {
      const endQuote = remaining.indexOf("'", 1);
      if (endQuote !== -1) {
        const str = remaining.slice(0, endQuote + 1);
        segments.push(
          React.createElement('span', { key: currentPos, style: { color: 'rgb(74 222 128)' } }, str)
        );
        currentPos += str.length;
        continue;
      }
    }

    // Check for template literal (backtick)
    if (remaining.startsWith('`')) {
      const endQuote = remaining.indexOf('`', 1);
      if (endQuote !== -1) {
        const str = remaining.slice(0, endQuote + 1);
        segments.push(
          React.createElement('span', { key: currentPos, style: { color: 'rgb(74 222 128)' } }, str)
        );
        currentPos += str.length;
        continue;
      }
    }

    // Check for comment (// style)
    if (remaining.startsWith('//')) {
      segments.push(
        React.createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(113 113 122)', fontStyle: 'italic' } },
          remaining
        )
      );
      break;
    }

    // Check for comment (# style for Python/Shell/R/Ruby/PHP)
    if (
      (language === 'python' ||
        language === 'bash' ||
        language === 'r' ||
        language === 'ruby' ||
        language === 'php') &&
      remaining.startsWith('#')
    ) {
      segments.push(
        React.createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(113 113 122)', fontStyle: 'italic' } },
          remaining
        )
      );
      break;
    }

    // Check for comment (-- style for SQL)
    if (language === 'sql' && remaining.startsWith('--')) {
      segments.push(
        React.createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(113 113 122)', fontStyle: 'italic' } },
          remaining
        )
      );
      break;
    }

    // Check for numbers
    const numberMatch = /^(\d+\.?\d*)/.exec(remaining);
    if (numberMatch && (currentPos === 0 || /\W/.test(line[currentPos - 1]))) {
      segments.push(
        React.createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(251 146 60)' } },
          numberMatch[1]
        )
      );
      currentPos += numberMatch[1].length;
      continue;
    }

    // Check for keywords and identifiers
    const wordMatch = /^([a-zA-Z_$][a-zA-Z0-9_$]*)/.exec(remaining);
    if (wordMatch) {
      const word = wordMatch[1];
      // SQL keywords are case-insensitive
      if (keywords.has(word) || (language === 'sql' && keywords.has(word.toUpperCase()))) {
        segments.push(
          React.createElement(
            'span',
            { key: currentPos, style: { color: 'rgb(192 132 252)', fontWeight: 500 } },
            word
          )
        );
      } else if ((word[0]?.toUpperCase() ?? '') === word[0] && word.length > 1) {
        // Likely a type/class name
        segments.push(
          React.createElement(
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

    // Check for operators and punctuation
    const opMatch = /^([=<>!+\-*/%&|^~?:;,.{}()[\]])/.exec(remaining);
    if (opMatch) {
      segments.push(
        React.createElement(
          'span',
          { key: currentPos, style: { color: 'rgb(161 161 170)' } },
          opMatch[1]
        )
      );
      currentPos += 1;
      continue;
    }

    // Default: just add the character
    segments.push(remaining[0]);
    currentPos += 1;
  }

  return segments;
}
