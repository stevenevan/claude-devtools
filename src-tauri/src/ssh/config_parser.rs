//! SSH config parser — reads `~/.ssh/config`, expands `Include`, resolves host
//! aliases. PURE (no russh, no network). Reconciled against the Go oracle
//! `internal/ssh/config_parser.go` (line-by-line state machine, first-match-wins
//! per directive, global directives appended as a lowest-priority `Host *`).

use std::collections::HashMap;
use std::path::Path;

use super::types::ConfigHostEntry;

struct HostBlock {
    patterns: Vec<String>,
    directives: HashMap<String, Vec<String>>,
}

struct ParsedConfig {
    blocks: Vec<HostBlock>,
}

impl ParsedConfig {
    /// Merge all blocks matching `alias` (first-match-wins per directive).
    fn compute(&self, alias: &str) -> HashMap<String, Vec<String>> {
        let mut result: HashMap<String, Vec<String>> = HashMap::new();
        for block in &self.blocks {
            if block.patterns.iter().any(|p| host_matches(p, alias)) {
                for (key, values) in &block.directives {
                    result.entry(key.clone()).or_insert_with(|| values.clone());
                }
            }
        }
        result
    }

    /// All non-wildcard host aliases across all blocks.
    fn host_aliases(&self) -> Vec<String> {
        let mut aliases = Vec::new();
        for block in &self.blocks {
            for pattern in &block.patterns {
                if !pattern.contains('*') && !pattern.contains('?') {
                    aliases.push(pattern.clone());
                }
            }
        }
        aliases
    }
}

/// Simple SSH glob match: `*` = any sequence, `?` = one char.
fn host_matches(pattern: &str, hostname: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let re_str = format!(
        "^{}$",
        regex::escape(pattern).replace(r"\*", ".*").replace(r"\?", ".")
    );
    regex::Regex::new(&re_str)
        .map(|re| re.is_match(hostname))
        .unwrap_or(false)
}

fn parse_ssh_config(content: &str) -> ParsedConfig {
    let mut blocks: Vec<HostBlock> = Vec::new();
    let mut current_directives: HashMap<String, Vec<String>> = HashMap::new();
    let mut current_patterns: Vec<String> = Vec::new();
    let mut in_host_block = false;
    let mut global_directives: HashMap<String, Vec<String>> = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        let (keyword, value) =
            match trimmed.split_once(|c: char| c == ' ' || c == '\t' || c == '=') {
                Some((k, v)) => (k.trim(), v.trim().to_string()),
                None => continue,
            };
        let key_lower = keyword.to_lowercase();

        if key_lower == "host" {
            if in_host_block && !current_patterns.is_empty() {
                blocks.push(HostBlock {
                    patterns: std::mem::take(&mut current_patterns),
                    directives: std::mem::take(&mut current_directives),
                });
            } else if !in_host_block {
                global_directives = std::mem::take(&mut current_directives);
            }
            current_patterns = value.split_whitespace().map(|s| s.to_string()).collect();
            current_directives = HashMap::new();
            in_host_block = true;
        } else if key_lower == "match" {
            // Save current, then skip Match blocks (complex, rarely needed).
            if in_host_block && !current_patterns.is_empty() {
                blocks.push(HostBlock {
                    patterns: std::mem::take(&mut current_patterns),
                    directives: std::mem::take(&mut current_directives),
                });
            }
            current_patterns = Vec::new();
            current_directives = HashMap::new();
            in_host_block = true;
        } else {
            current_directives.entry(key_lower).or_default().push(value);
        }
    }

    if in_host_block && !current_patterns.is_empty() {
        blocks.push(HostBlock {
            patterns: current_patterns,
            directives: current_directives,
        });
    } else if !in_host_block {
        global_directives = current_directives;
    }

    if !global_directives.is_empty() {
        blocks.push(HostBlock {
            patterns: vec!["*".to_string()],
            directives: global_directives,
        });
    }

    ParsedConfig { blocks }
}

fn expand_includes(content: &str, home: &Path) -> String {
    let mut result = Vec::new();
    for line in content.lines() {
        let trimmed = line.trim();
        if let Some(rest) = trimmed
            .strip_prefix("Include ")
            .or_else(|| trimmed.strip_prefix("include "))
        {
            let pattern = rest.trim().replace('~', &home.to_string_lossy());
            if pattern.contains('*') || pattern.contains('?') {
                for entry in glob_expand(&pattern) {
                    if let Ok(included) = std::fs::read_to_string(&entry) {
                        result.push(included);
                    }
                }
            } else if let Ok(included) = std::fs::read_to_string(&pattern) {
                result.push(included);
            }
        } else {
            result.push(line.to_string());
        }
    }
    result.join("\n")
}

/// Single-directory glob for `Include` patterns (the common SSH form
/// `dir/<glob>`). Matches `*`/`?` in the final path component only, sorted
/// lexicographically like Go's `filepath.Glob`. A globbed directory component
/// (rare in SSH Include) is not expanded — the `glob` crate is not a dependency.
fn glob_expand(pattern: &str) -> Vec<std::path::PathBuf> {
    let (dir, file_pat) = match pattern.rfind('/') {
        Some(idx) => (&pattern[..idx], &pattern[idx + 1..]),
        None => (".", pattern),
    };
    if dir.contains('*') || dir.contains('?') {
        return Vec::new();
    }
    let mut matches = Vec::new();
    if let Ok(entries) = std::fs::read_dir(dir) {
        for entry in entries.flatten() {
            let name = entry.file_name();
            if host_matches(file_pat, &name.to_string_lossy()) {
                matches.push(entry.path());
            }
        }
    }
    matches.sort();
    matches
}

fn resolve_entry(computed: &HashMap<String, Vec<String>>, alias: &str) -> ConfigHostEntry {
    let host_name = computed
        .get("hostname")
        .and_then(|v| v.first())
        .filter(|h| h.as_str() != alias)
        .cloned();

    let user = computed.get("user").and_then(|v| v.first()).cloned();

    // parse::<u16> rejects non-numeric / >65535 (matches Go's manual accumulate +
    // `n <= 65535`); the `!= 22` filter drops the default port.
    let port = computed
        .get("port")
        .and_then(|v| v.first())
        .and_then(|p| p.parse::<u16>().ok())
        .filter(|&p| p != 22);

    let has_identity_file = computed
        .get("identityfile")
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    ConfigHostEntry {
        alias: alias.to_string(),
        host_name,
        user,
        port,
        has_identity_file,
    }
}

/// Testable core of `get_config_hosts` — no HOME/filesystem coupling.
fn config_hosts_from(content: &str, home: &Path) -> Vec<ConfigHostEntry> {
    let expanded = expand_includes(content, home);
    let config = parse_ssh_config(&expanded);
    let mut entries = Vec::new();
    for alias in config.host_aliases() {
        entries.push(resolve_entry(&config.compute(&alias), &alias));
    }
    entries
}

/// Testable core of `resolve_host` — no HOME/filesystem coupling.
fn resolve_host_from(content: &str, home: &Path, alias: &str) -> Option<ConfigHostEntry> {
    let expanded = expand_includes(content, home);
    let config = parse_ssh_config(&expanded);

    let computed = config.compute(alias);
    if computed.is_empty() {
        return None;
    }

    let entry = resolve_entry(&computed, alias);

    // Nothing resolved beyond the alias → require an explicit block for it.
    if entry.host_name.is_none()
        && entry.user.is_none()
        && entry.port.is_none()
        && !entry.has_identity_file
    {
        let has_explicit = config
            .blocks
            .iter()
            .any(|b| b.patterns.iter().any(|p| p == alias));
        if !has_explicit {
            return None;
        }
    }

    Some(entry)
}

/// Mirrors Go `GetConfigHosts` — reads `~/.ssh/config`, returns all non-wildcard hosts.
pub fn get_config_hosts() -> Vec<ConfigHostEntry> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let content = match std::fs::read_to_string(home.join(".ssh").join("config")) {
        Ok(c) => c,
        Err(_) => return vec![],
    };
    config_hosts_from(&content, &home)
}

/// Mirrors Go `ResolveHost` — resolves a single alias from `~/.ssh/config`.
pub fn resolve_host(alias: &str) -> Option<ConfigHostEntry> {
    let home = dirs::home_dir()?;
    let content = std::fs::read_to_string(home.join(".ssh").join("config")).ok()?;
    resolve_host_from(&content, &home, alias)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn fake_home() -> PathBuf {
        std::env::temp_dir()
    }

    // GOLDEN: fixture ~/.ssh/config-shaped string → assert the resolved
    // ConfigHostEntry[]. Mirrors Go TestParseSimpleConfig.
    #[test]
    fn golden_config_hosts_from_fixture() {
        let fixture = r#"
Host myserver
    HostName 192.168.1.100
    User admin
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host devbox
    HostName dev.example.com
    User developer
"#;
        let entries = config_hosts_from(fixture, &fake_home());
        let aliases: Vec<&str> = entries.iter().map(|e| e.alias.as_str()).collect();
        assert_eq!(aliases, vec!["myserver", "devbox"]);

        let ms = entries.iter().find(|e| e.alias == "myserver").unwrap();
        assert_eq!(ms.host_name.as_deref(), Some("192.168.1.100"));
        assert_eq!(ms.user.as_deref(), Some("admin"));
        assert_eq!(ms.port, Some(2222));
        assert!(ms.has_identity_file);

        let db = entries.iter().find(|e| e.alias == "devbox").unwrap();
        assert_eq!(db.host_name.as_deref(), Some("dev.example.com"));
        assert_eq!(db.user.as_deref(), Some("developer"));
        assert_eq!(db.port, None);
        assert!(!db.has_identity_file);
    }

    #[test]
    fn wildcard_host_excluded_but_inherited() {
        let fixture = r#"
Host *
    ServerAliveInterval 60

Host myserver
    HostName 10.0.0.1
"#;
        let entries = config_hosts_from(fixture, &fake_home());
        let aliases: Vec<&str> = entries.iter().map(|e| e.alias.as_str()).collect();
        assert_eq!(aliases, vec!["myserver"]);
    }

    #[test]
    fn host_matches_globs() {
        assert!(host_matches("*", "anything"));
        assert!(host_matches("myserver", "myserver"));
        assert!(!host_matches("myserver", "other"));
        assert!(host_matches("dev-*", "dev-box"));
        assert!(!host_matches("dev-*", "prod-box"));
    }

    #[test]
    fn default_port_filtered() {
        let fixture = "Host myserver\n    HostName 10.0.0.1\n    Port 22\n";
        let entries = config_hosts_from(fixture, &fake_home());
        let ms = entries.iter().find(|e| e.alias == "myserver").unwrap();
        assert_eq!(ms.port, None);
    }

    #[test]
    fn resolve_host_requires_explicit_block() {
        let fixture = "Host myserver\n    HostName 10.0.0.1\n    User admin\n";
        assert!(resolve_host_from(fixture, &fake_home(), "myserver").is_some());
        // An undefined alias with no matching block resolves to None.
        assert!(resolve_host_from(fixture, &fake_home(), "unknown").is_none());
    }
}
