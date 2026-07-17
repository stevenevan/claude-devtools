use std::collections::{HashMap, HashSet};

use super::analyzer::{
    CmdStat, Suggestion, LIST_ALLOW, MAX_SAMPLES, MIN_EVIDENCE_COUNT, MIN_SESSION_COUNT,
};

/// The boundaries that let a suffix become a NEW command. A prefix (:*) rule is
/// never derived from a command containing any of these — Bash(git status:*)
/// from "git status; curl evil" would authorize the injected tail.
const SHELL_METACHARS: &[&str] = &[";", "&&", "||", "|", "`", "$(", "\n", ">", "<"];

/// CLIs whose first token alone is too coarse to scope a rule (git, npm, …) — a
/// prefix for these uses the first TWO tokens so a Bash(git status:*) rule never
/// widens to Bash(git:*).
fn is_multi_word_command(cmd: &str) -> bool {
    matches!(cmd, "git" | "npm" | "bun" | "go" | "cargo" | "docker")
}

/// Reports whether cmd contains any shell combinator/redirect that could smuggle
/// a second command past a prefix rule.
fn has_shell_metachar(cmd: &str) -> bool {
    SHELL_METACHARS.iter().any(|m| cmd.contains(m))
}

/// Returns the narrowest single-level prefix for cmd: the first token, or the
/// first two tokens when the first is a known multi-word CLI. "" for blank.
fn bash_prefix(cmd: &str) -> String {
    let fields: Vec<&str> = cmd.split_whitespace().collect();
    if fields.is_empty() {
        return String::new();
    }
    if fields.len() >= 2 && is_multi_word_command(fields[0]) {
        return format!("{} {}", fields[0], fields[1]);
    }
    fields[0].to_string()
}

/// HARD-rejects rules too broad to ever suggest: a bare wildcard, or any
/// Tool(...) whose inner pattern is empty or only "*" (Bash(*), Tool(*)).
pub(super) fn forbid_rule_shape(rule: &str) -> bool {
    let r = rule.trim();
    if r.is_empty() || r == "*" {
        return true;
    }
    if let Some(open) = r.find('(') {
        if r.ends_with(')') {
            let inner = r[open + 1..r.len() - 1].trim();
            if inner.is_empty() || inner == "*" {
                return true;
            }
        }
    }
    false
}

/// Accumulates the safe (metachar-free) commands sharing one prefix, so a
/// varying group can become a single Bash(prefix:*) rule.
#[derive(Default)]
struct PrefixGroup {
    distinct: HashSet<String>,
    count: u32,
    sessions: HashSet<String>,
    samples: Vec<String>,
}

/// Groups metachar-free commands by their narrowest prefix. Commands with a
/// shell metacharacter are excluded (they may only ever be exact suggestions).
fn build_prefix_groups(bash_commands: &HashMap<String, CmdStat>) -> HashMap<String, PrefixGroup> {
    let mut groups: HashMap<String, PrefixGroup> = HashMap::new();
    for (cmd, st) in bash_commands.iter() {
        if has_shell_metachar(cmd) {
            continue;
        }
        let prefix = bash_prefix(cmd);
        if prefix.is_empty() {
            continue;
        }
        let g = groups.entry(prefix).or_default();
        g.distinct.insert(cmd.clone());
        g.count += st.count;
        for s in &st.sessions {
            g.sessions.insert(s.clone());
        }
        for sample in &st.samples {
            if g.samples.len() < MAX_SAMPLES && !g.samples.contains(sample) {
                g.samples.push(sample.clone());
            }
        }
    }
    groups
}

/// Turns aggregated Bash commands into narrowest-match rules: a Bash(prefix:*)
/// rule when metachar-free commands VARY under a prefix and clear the recurrence
/// gate, otherwise a Bash(<exact command>) rule for each recurring command not
/// already covered by a prefix rule. Existing grants and forbidden shapes drop.
pub(super) fn derive_bash_suggestions(
    bash_commands: &HashMap<String, CmdStat>,
    existing: &HashSet<String>,
) -> Vec<Suggestion> {
    let groups = build_prefix_groups(bash_commands);

    let mut consumed: HashSet<String> = HashSet::new();
    let mut out: Vec<Suggestion> = Vec::new();

    for (prefix, g) in groups.iter() {
        if g.distinct.len() < 2 {
            continue; // no variation → exact rules handle it
        }
        if g.count < MIN_EVIDENCE_COUNT || g.sessions.len() < MIN_SESSION_COUNT {
            continue;
        }
        // A varying, recurring prefix covers its commands: never re-suggest them
        // as exact rules, even when the prefix rule itself is dropped below.
        for cmd in &g.distinct {
            consumed.insert(cmd.clone());
        }
        let rule = format!("Bash({prefix}:*)");
        if forbid_rule_shape(&rule) || existing.contains(&rule) {
            continue;
        }
        out.push(stat_suggestion(rule, g.count, &g.sessions, g.samples.clone()));
    }

    for (cmd, st) in bash_commands.iter() {
        if consumed.contains(cmd) {
            continue;
        }
        if st.count < MIN_EVIDENCE_COUNT || st.sessions.len() < MIN_SESSION_COUNT {
            continue;
        }
        let rule = format!("Bash({cmd})");
        if forbid_rule_shape(&rule) || existing.contains(&rule) {
            continue;
        }
        out.push(stat_suggestion(rule, st.count, &st.sessions, st.samples.clone()));
    }
    out
}

/// Emits a bare <Tool> exact rule for each non-Bash tool that clears the
/// recurrence gate. A bare-tool wildcard (Tool(*)) is never produced.
pub(super) fn derive_non_bash_suggestions(
    non_bash_tools: &HashMap<String, CmdStat>,
    existing: &HashSet<String>,
) -> Vec<Suggestion> {
    let mut out: Vec<Suggestion> = Vec::new();
    for (tool, st) in non_bash_tools.iter() {
        if st.count < MIN_EVIDENCE_COUNT || st.sessions.len() < MIN_SESSION_COUNT {
            continue;
        }
        if forbid_rule_shape(tool) || existing.contains(tool) {
            continue;
        }
        out.push(stat_suggestion(
            tool.clone(),
            st.count,
            &st.sessions,
            st.samples.clone(),
        ));
    }
    out
}

/// Builds an allow-list Suggestion from aggregated evidence.
fn stat_suggestion(
    rule: String,
    count: u32,
    sessions: &HashSet<String>,
    samples: Vec<String>,
) -> Suggestion {
    Suggestion {
        rule,
        list: LIST_ALLOW.to_string(),
        evidence_count: count,
        session_count: sessions.len() as u32,
        samples,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn forbid_rule_shape_rejects_broad_and_allows_scoped() {
        for r in ["Bash(*)", "Read(*)", "*", "Bash()", "", "Tool( )", "( * )"] {
            assert!(forbid_rule_shape(r), "forbid_rule_shape({r:?}) should be true");
        }
        for r in [
            "Bash(git status:*)",
            "Bash(make build)",
            "Read",
            "WebFetch(domain:example.com)",
        ] {
            assert!(!forbid_rule_shape(r), "forbid_rule_shape({r:?}) should be false");
        }
    }

    #[test]
    fn bash_prefix_uses_two_tokens_for_multi_word_clis() {
        assert_eq!(bash_prefix("git status -s"), "git status");
        assert_eq!(bash_prefix("make build"), "make");
        assert_eq!(bash_prefix(""), "");
        assert_eq!(bash_prefix("git"), "git");
    }

    #[test]
    fn shell_metachar_detected() {
        assert!(has_shell_metachar("git status; curl evil"));
        assert!(has_shell_metachar("cat x | grep y"));
        assert!(!has_shell_metachar("git status -s"));
    }
}
