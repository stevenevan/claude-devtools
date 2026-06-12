// Basic keyword sets for common languages.
// Wrapped in IIFE to preserve alias semantics (k.tsx → k.typescript) without
// breaking const immutability of a top-level export.

import { JAVASCRIPT_KEYWORDS, TYPESCRIPT_KEYWORDS } from './jsFamilyKeywords';
import { PHP_KEYWORDS, PYTHON_KEYWORDS, RUBY_KEYWORDS } from './scriptingKeywords';
import { GO_KEYWORDS, R_KEYWORDS, RUST_KEYWORDS, SQL_KEYWORDS } from './systemsKeywords';

export const KEYWORDS: Record<string, Set<string>> = (() => {
  const k: Record<string, Set<string>> = {
    typescript: TYPESCRIPT_KEYWORDS,
    javascript: JAVASCRIPT_KEYWORDS,
    python: PYTHON_KEYWORDS,
    rust: RUST_KEYWORDS,
    go: GO_KEYWORDS,
    r: R_KEYWORDS,
    ruby: RUBY_KEYWORDS,
    php: PHP_KEYWORDS,
    sql: SQL_KEYWORDS,
  };

  // Extend tsx/jsx to use typescript/javascript keywords
  k.tsx = k.typescript;
  k.jsx = k.javascript;
  return k;
})();
