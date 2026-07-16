// trigger_matcher.go.
// Regex pattern matching with a process-level LRU cache (500 entries).
// Also contains the rule DSL evaluator (evaluate_node, evaluate_rules).
package notifications

import (
	"encoding/json"
	"regexp"
	"sync"

	"github.com/hashicorp/golang-lru/v2"
)

// ── Regex cache ───────────────────────────────────────────────────────────────

const maxRegexCacheSize = 500

var (
	regexCacheMu sync.Mutex
	regexCache   *lru.Cache[string, *regexp.Regexp] // nil = not compiled
)

func init() {
	regexCache, _ = lru.New[string, *regexp.Regexp](maxRegexCacheSize)
}

// getCachedRegex returns a compiled case-insensitive regex, or nil for invalid patterns.
// Mirrors trigger_matcher::get_cached_regex.
func getCachedRegex(pattern string) *regexp.Regexp {
	regexCacheMu.Lock()
	defer regexCacheMu.Unlock()

	if re, ok := regexCache.Get(pattern); ok {
		return re
	}

	compiled, err := regexp.Compile("(?i)" + pattern)
	if err != nil {
		regexCache.Add(pattern, nil)
		return nil
	}
	regexCache.Add(pattern, compiled)
	return compiled
}

// MatchesPattern checks if content matches the regex pattern (case-insensitive).
// Mirrors trigger_matcher::matches_pattern.
func MatchesPattern(content, pattern string) bool {
	re := getCachedRegex(pattern)
	if re == nil {
		return false
	}
	return re.MatchString(content)
}

// MatchesIgnorePatterns checks if content matches any of the ignore patterns.
// Mirrors trigger_matcher::matches_ignore_patterns.
func MatchesIgnorePatterns(content string, ignorePatterns *[]string) bool {
	if ignorePatterns == nil || len(*ignorePatterns) == 0 {
		return false
	}
	for _, p := range *ignorePatterns {
		if re := getCachedRegex(p); re != nil && re.MatchString(content) {
			return true
		}
	}
	return false
}

// ExtractToolUseField extracts a named field from a tool_use input JSON object.
// Mirrors trigger_matcher::extract_tool_use_field.
func ExtractToolUseField(input json.RawMessage, matchField string) *string {
	var obj map[string]json.RawMessage
	if json.Unmarshal(input, &obj) != nil {
		return nil
	}
	raw, ok := obj[matchField]
	if !ok {
		return nil
	}
	// String value → return as-is; other types → stringify.
	var s string
	if json.Unmarshal(raw, &s) == nil {
		return &s
	}
	serialized := string(raw)
	return &serialized
}

// ── Rule DSL evaluation ───────────────────────────────────────────────────────

// EvaluatePredicate evaluates a single predicate against a context.
// Mirrors trigger_matcher::evaluate_predicate.
func EvaluatePredicate(p *RulePredicate, ctx *RuleEvalContext) bool {
	switch p.Kind {
	case "toolName":
		if ctx.ToolName == nil {
			return false
		}
		return *ctx.ToolName == p.Equals
	case "durationGt":
		if ctx.DurationMS == nil {
			return false
		}
		return *ctx.DurationMS > p.Ms
	case "error":
		if p.IsError == nil {
			return false
		}
		return ctx.IsError == *p.IsError
	case "costGt":
		if ctx.CostUSD == nil {
			return false
		}
		return *ctx.CostUSD > p.Usd
	case "regexMatch":
		if ctx.Message == nil {
			return false
		}
		return MatchesPattern(*ctx.Message, p.Pattern)
	}
	return false
}

// EvaluateNode recursively evaluates a rule node.
// Mirrors trigger_matcher::evaluate_node.
func EvaluateNode(node *RuleNode, ctx *RuleEvalContext) bool {
	switch node.Kind {
	case "all":
		for i := range node.Children {
			if !EvaluateNode(&node.Children[i], ctx) {
				return false
			}
		}
		return true
	case "any":
		for i := range node.Children {
			if EvaluateNode(&node.Children[i], ctx) {
				return true
			}
		}
		return false
	case "predicate":
		if node.Predicate == nil {
			return false
		}
		return EvaluatePredicate(node.Predicate, ctx)
	}
	return false
}

// EvaluateRules evaluates every enabled rule and returns the IDs of rules that fired.
// Mirrors trigger_matcher::evaluate_rules.
func EvaluateRules(rules []NotificationRule, ctx *RuleEvalContext) []string {
	fired := []string{}
	for i := range rules {
		r := &rules[i]
		if !r.Enabled {
			continue
		}
		if EvaluateNode(&r.Condition, ctx) {
			fired = append(fired, r.ID)
		}
	}
	return fired
}
