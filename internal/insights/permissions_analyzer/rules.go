package permissions_analyzer

import "strings"

// multiWordCommands are CLIs whose first token alone is too coarse to scope a
// rule (git, npm, …) — a prefix for these uses the first TWO tokens so a
// Bash(git status:*) rule never widens to Bash(git:*).
var multiWordCommands = map[string]bool{
	"git":    true,
	"npm":    true,
	"bun":    true,
	"go":     true,
	"cargo":  true,
	"docker": true,
}

// shellMetachars are the boundaries that let a suffix become a NEW command. A
// prefix (:*) rule is never derived from a command containing any of these —
// Bash(git status:*) from "git status; curl evil" would authorize the injected
// tail (Security F6).
var shellMetachars = []string{";", "&&", "||", "|", "`", "$(", "\n", ">", "<"}

// hasShellMetachar reports whether cmd contains any shell combinator/redirect
// that could smuggle a second command past a prefix rule.
func hasShellMetachar(cmd string) bool {
	for _, m := range shellMetachars {
		if strings.Contains(cmd, m) {
			return true
		}
	}
	return false
}

// bashPrefix returns the narrowest single-level prefix for cmd: the first token,
// or the first two tokens when the first is a known multi-word CLI. Returns ""
// for a blank command.
func bashPrefix(cmd string) string {
	fields := strings.Fields(cmd)
	if len(fields) == 0 {
		return ""
	}
	if len(fields) >= 2 && multiWordCommands[fields[0]] {
		return fields[0] + " " + fields[1]
	}
	return fields[0]
}

// forbidRuleShape HARD-rejects rules too broad to ever suggest: a bare wildcard,
// or any Tool(...) whose inner pattern is empty or only "*" (Bash(*), Tool(*)).
// A forbidden shape is filtered before return — unrepresentable in the output.
func forbidRuleShape(rule string) bool {
	r := strings.TrimSpace(rule)
	if r == "" || r == "*" {
		return true
	}
	open := strings.IndexByte(r, '(')
	if open >= 0 && strings.HasSuffix(r, ")") {
		inner := strings.TrimSpace(r[open+1 : len(r)-1])
		if inner == "" || inner == "*" {
			return true
		}
	}
	return false
}

// prefixGroup accumulates the safe (metachar-free) commands sharing one prefix,
// so a varying group can become a single Bash(prefix:*) rule.
type prefixGroup struct {
	distinct map[string]struct{}
	count    int
	sessions map[string]struct{}
	samples  []string
}

// deriveBashSuggestions turns aggregated Bash commands into narrowest-match
// rules: a Bash(prefix:*) rule when metachar-free commands VARY under a prefix
// and clear the recurrence gate, otherwise a Bash(<exact command>) rule for each
// recurring command not already covered by a prefix rule. Existing grants and
// forbidden shapes are dropped.
func deriveBashSuggestions(bashCommands map[string]*cmdStat, existing map[string]bool) []Suggestion {
	groups := buildPrefixGroups(bashCommands)

	consumed := map[string]bool{}
	var out []Suggestion

	for prefix, g := range groups {
		if len(g.distinct) < 2 {
			continue // no variation → exact rules handle it
		}
		if g.count < minEvidenceCount || len(g.sessions) < minSessionCount {
			continue
		}
		// A varying, recurring prefix covers its commands: never re-suggest them
		// as exact rules, even when the prefix rule itself is dropped below.
		for cmd := range g.distinct {
			consumed[cmd] = true
		}
		rule := "Bash(" + prefix + ":*)"
		if forbidRuleShape(rule) || existing[rule] {
			continue
		}
		out = append(out, statSuggestion(rule, g.count, g.sessions, g.samples))
	}

	for cmd, st := range bashCommands {
		if consumed[cmd] {
			continue
		}
		if st.count < minEvidenceCount || len(st.sessions) < minSessionCount {
			continue
		}
		rule := "Bash(" + cmd + ")"
		if forbidRuleShape(rule) || existing[rule] {
			continue
		}
		out = append(out, statSuggestion(rule, st.count, st.sessions, st.samples))
	}
	return out
}

// buildPrefixGroups groups metachar-free commands by their narrowest prefix.
// Commands with a shell metacharacter are excluded (they may only ever be exact
// suggestions, never a prefix rule).
func buildPrefixGroups(bashCommands map[string]*cmdStat) map[string]*prefixGroup {
	groups := map[string]*prefixGroup{}
	for cmd, st := range bashCommands {
		if hasShellMetachar(cmd) {
			continue
		}
		prefix := bashPrefix(cmd)
		if prefix == "" {
			continue
		}
		g := groups[prefix]
		if g == nil {
			g = &prefixGroup{distinct: map[string]struct{}{}, sessions: map[string]struct{}{}}
			groups[prefix] = g
		}
		g.distinct[cmd] = struct{}{}
		g.count += st.count
		for s := range st.sessions {
			g.sessions[s] = struct{}{}
		}
		for _, sample := range st.samples {
			if len(g.samples) < maxSamples && !contains(g.samples, sample) {
				g.samples = append(g.samples, sample)
			}
		}
	}
	return groups
}

// deriveNonBashSuggestions emits a bare <Tool> exact rule for each non-Bash tool
// that clears the recurrence gate. A bare-tool wildcard (Tool(*)) is never
// produced — forbidRuleShape guards it. Existing grants are skipped.
func deriveNonBashSuggestions(nonBashTools map[string]*cmdStat, existing map[string]bool) []Suggestion {
	var out []Suggestion
	for tool, st := range nonBashTools {
		if st.count < minEvidenceCount || len(st.sessions) < minSessionCount {
			continue
		}
		if forbidRuleShape(tool) || existing[tool] {
			continue
		}
		out = append(out, statSuggestion(tool, st.count, st.sessions, st.samples))
	}
	return out
}

// statSuggestion builds an allow-list Suggestion from aggregated evidence.
func statSuggestion(rule string, count int, sessions map[string]struct{}, samples []string) Suggestion {
	return Suggestion{
		Rule:          rule,
		List:          listAllow,
		EvidenceCount: count,
		SessionCount:  len(sessions),
		Samples:       samples,
	}
}

// contains reports whether s is already in xs.
func contains(xs []string, s string) bool {
	for _, x := range xs {
		if x == s {
			return true
		}
	}
	return false
}

// truncateSample caps a display sample to maxSampleLen runes.
func truncateSample(s string) string {
	r := []rune(s)
	if len(r) <= maxSampleLen {
		return s
	}
	return string(r[:maxSampleLen])
}
