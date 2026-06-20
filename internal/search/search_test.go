// Tests port nl_query.rs and content_search.rs #[test]s verbatim.
package search

import (
	"math"
	"testing"
)

const nowMS = 1_000_000_000_000.0 // matches nl_query.rs::NOW

func approxEq(a, b float64) bool {
	return math.Abs(a-b) < 0.5
}

// ---------------------------------------------------------------------------
// NL query tests — nl_query.rs::tests
// ---------------------------------------------------------------------------

// last_week_sets_date_min
func TestLastWeekSetsDateMin(t *testing.T) {
	f := ParseNLQuery("show me last 1 week", nowMS)
	if f.DateMin == nil {
		t.Fatal("DateMin should be set")
	}
	if !approxEq(*f.DateMin, nowMS-7.0*msPerDay) {
		t.Errorf("unexpected DateMin: %v", *f.DateMin)
	}
}

// last_n_days_handles_plural_and_singular
func TestLastNDaysHandlesPluralAndSingular(t *testing.T) {
	f1 := ParseNLQuery("last 3 days", nowMS)
	if f1.DateMin == nil || !approxEq(*f1.DateMin, nowMS-3.0*msPerDay) {
		t.Errorf("3 days: %v", f1.DateMin)
	}
	f2 := ParseNLQuery("last 1 day", nowMS)
	if f2.DateMin == nil || !approxEq(*f2.DateMin, nowMS-msPerDay) {
		t.Errorf("1 day: %v", f2.DateMin)
	}
}

// last_months_uses_30_day_approximation
func TestLastMonthsUses30DayApproximation(t *testing.T) {
	f := ParseNLQuery("last 2 months", nowMS)
	if f.DateMin == nil || !approxEq(*f.DateMin, nowMS-60.0*msPerDay) {
		t.Errorf("2 months: %v", f.DateMin)
	}
}

// using_tool_sets_agent_name
func TestUsingToolSetsAgentName(t *testing.T) {
	f := ParseNLQuery("sessions using Bash", nowMS)
	if f.AgentName == nil || *f.AgentName != "Bash" {
		t.Errorf("expected Bash, got %v", f.AgentName)
	}
}

// over_dollar_sets_min_cost
func TestOverDollarSetsMinCost(t *testing.T) {
	f := ParseNLQuery("over $0.5 in cost", nowMS)
	if f.MinCost == nil || !approxEq(*f.MinCost, 0.5) {
		t.Errorf("expected 0.5, got %v", f.MinCost)
	}
}

// with_errors_flags_has_errors
func TestWithErrorsFlagsHasErrors(t *testing.T) {
	f := ParseNLQuery("sessions with errors yesterday", nowMS)
	if !f.HasErrors {
		t.Error("expected HasErrors=true")
	}
}

// containing_quoted_text_extracts_value
func TestContainingQuotedTextExtractsValue(t *testing.T) {
	f := ParseNLQuery(`containing "timeout error"`, nowMS)
	if f.TextQuery == nil || *f.TextQuery != "timeout error" {
		t.Errorf("expected 'timeout error', got %v", f.TextQuery)
	}
}

// containing_unquoted_word
func TestContainingUnquotedWord(t *testing.T) {
	f := ParseNLQuery("containing TODO others", nowMS)
	if f.TextQuery == nil || *f.TextQuery != "TODO" {
		t.Errorf("expected 'TODO', got %v", f.TextQuery)
	}
}

// by_author_sets_author
func TestByAuthorSetsAuthor(t *testing.T) {
	f := ParseNLQuery("by alice", nowMS)
	if f.Author == nil || *f.Author != "alice" {
		t.Errorf("expected alice, got %v", f.Author)
	}
}

// unsupported_phrase_returns_default
func TestUnsupportedPhraseReturnsDefault(t *testing.T) {
	f := ParseNLQuery("hello world", nowMS)
	if f.DateMin != nil || f.AgentName != nil || f.MinCost != nil ||
		f.HasErrors || f.TextQuery != nil || f.Author != nil {
		t.Errorf("expected default filter, got %+v", f)
	}
}

// combined_phrase_populates_multiple_fields
func TestCombinedPhrasePopulatesMultipleFields(t *testing.T) {
	f := ParseNLQuery(
		`last 7 days using Bash with errors containing "oom" by alice over $1`,
		nowMS,
	)
	if f.DateMin == nil || !approxEq(*f.DateMin, nowMS-7.0*msPerDay) {
		t.Errorf("DateMin: %v", f.DateMin)
	}
	if f.AgentName == nil || *f.AgentName != "Bash" {
		t.Errorf("AgentName: %v", f.AgentName)
	}
	if !f.HasErrors {
		t.Error("HasErrors should be true")
	}
	if f.TextQuery == nil || *f.TextQuery != "oom" {
		t.Errorf("TextQuery: %v", f.TextQuery)
	}
	if f.Author == nil || *f.Author != "alice" {
		t.Errorf("Author: %v", f.Author)
	}
	if f.MinCost == nil || !approxEq(*f.MinCost, 1.0) {
		t.Errorf("MinCost: %v", f.MinCost)
	}
}

// ---------------------------------------------------------------------------
// Content search tests — content_search.rs::tests
// ---------------------------------------------------------------------------

// test_plain_find_all
func TestPlainFindAll(t *testing.T) {
	hits := plainFindAll("hello world hello", "hello")
	if len(hits) != 2 {
		t.Fatalf("expected 2, got %d", len(hits))
	}
	if hits[0][0] != 0 || hits[0][1] != 5 {
		t.Errorf("first match: %v", hits[0])
	}
	if hits[1][0] != 12 || hits[1][1] != 5 {
		t.Errorf("second match: %v", hits[1])
	}
}

// test_plain_find_all_no_match
func TestPlainFindAllNoMatch(t *testing.T) {
	hits := plainFindAll("hello world", "xyz")
	if len(hits) != 0 {
		t.Errorf("expected empty, got %v", hits)
	}
}

// test_extract_snippet
func TestExtractSnippet(t *testing.T) {
	text := "The quick brown fox jumps over the lazy dog"
	snippet := extractSnippet(text, 10, 5)
	if !contains(snippet, "brown") {
		t.Errorf("snippet missing 'brown': %q", snippet)
	}
}

// test_matcher_case_insensitive
func TestMatcherCaseInsensitive(t *testing.T) {
	m, err := newMatcher("Hello", false, false)
	if err != nil {
		t.Fatal(err)
	}
	hits := m.findAll("hello HELLO Hello")
	if len(hits) != 3 {
		t.Errorf("expected 3, got %d", len(hits))
	}
}

// test_matcher_case_sensitive
func TestMatcherCaseSensitive(t *testing.T) {
	m, err := newMatcher("Hello", false, true)
	if err != nil {
		t.Fatal(err)
	}
	hits := m.findAll("hello HELLO Hello")
	if len(hits) != 1 {
		t.Errorf("expected 1, got %d", len(hits))
	}
}

// test_matcher_regex
func TestMatcherRegex(t *testing.T) {
	m, err := newMatcher(`fn\s+\w+`, true, false)
	if err != nil {
		t.Fatal(err)
	}
	hits := m.findAll("fn hello() { fn world() }")
	if len(hits) != 2 {
		t.Errorf("expected 2, got %d", len(hits))
	}
}

// test_matcher_invalid_regex
func TestMatcherInvalidRegex(t *testing.T) {
	_, err := newMatcher("[invalid", true, false)
	if err == nil {
		t.Error("expected error for invalid regex")
	}
}

func contains(s, sub string) bool {
	return len(s) >= len(sub) && func() bool {
		for i := 0; i <= len(s)-len(sub); i++ {
			if s[i:i+len(sub)] == sub {
				return true
			}
		}
		return false
	}()
}
