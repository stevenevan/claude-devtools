/// SSH config parser — reads ~/.ssh/config and resolves host aliases.
///
/// Supports: Host blocks, HostName, Port, User, IdentityFile, Include (with glob).

use std::collections::HashMap;
use std::path::Path;

use super::types::SshConfigHostEntry;

// =============================================================================
// Parsed SSH Config
// =============================================================================

struct HostBlock {
    patterns: Vec<String>,
    directives: HashMap<String, Vec<String>>,
}

struct ParsedConfig {
    blocks: Vec<HostBlock>,
}

impl ParsedConfig {
    /// Compute resolved values for a host alias by merging matching blocks.
    /// Later blocks override earlier ones (first match wins for each directive).
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

    /// List all non-wildcard host aliases.
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

/// Simple glob match: `*` matches any sequence, `?` matches one char.
fn host_matches(pattern: &str, hostname: &str) -> bool {
    if pattern == "*" {
        return true;
    }
    let re_str = format!(
        "^{}$",
        regex::escape(pattern)
            .replace(r"\*", ".*")
            .replace(r"\?", ".")
    );
    regex::Regex::new(&re_str)
        .map(|re| re.is_match(hostname))
        .unwrap_or(false)
}

// =============================================================================
// Parsing
// =============================================================================

fn parse_ssh_config(content: &str) -> ParsedConfig {
    let mut blocks: Vec<HostBlock> = Vec::new();
    let mut current_directives: HashMap<String, Vec<String>> = HashMap::new();
    let mut current_patterns: Vec<String> = Vec::new();
    let mut in_host_block = false;

    // Global block collects directives before any Host line
    let mut global_directives: HashMap<String, Vec<String>> = HashMap::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.is_empty() || trimmed.starts_with('#') {
            continue;
        }

        // Split into keyword and value
        let (keyword, value) = match trimmed.split_once(|c: char| c == ' ' || c == '\t' || c == '=')
        {
            Some((k, v)) => (k.trim(), v.trim().to_string()),
            None => continue,
        };

        let key_lower = keyword.to_lowercase();

        if key_lower == "host" {
            // Save previous block
            if in_host_block && !current_patterns.is_empty() {
                blocks.push(HostBlock {
                    patterns: std::mem::take(&mut current_patterns),
                    directives: std::mem::take(&mut current_directives),
                });
            } else if !in_host_block {
                global_directives = std::mem::take(&mut current_directives);
            }

            current_patterns = value
                .split_whitespace()
                .map(|s| s.to_string())
                .collect();
            current_directives = HashMap::new();
            in_host_block = true;
        } else if key_lower == "match" {
            // Match blocks: save current block, start a new unnamed one
            if in_host_block && !current_patterns.is_empty() {
                blocks.push(HostBlock {
                    patterns: std::mem::take(&mut current_patterns),
                    directives: std::mem::take(&mut current_directives),
                });
            }
            // Skip Match blocks (complex, rarely needed for basic SSH)
            current_patterns = Vec::new();
            current_directives = HashMap::new();
            in_host_block = true;
        } else {
            // Accumulate directive
            current_directives
                .entry(key_lower)
                .or_default()
                .push(value);
        }
    }

    // Save last block
    if in_host_block && !current_patterns.is_empty() {
        blocks.push(HostBlock {
            patterns: current_patterns,
            directives: current_directives,
        });
    } else if !in_host_block {
        global_directives = current_directives;
    }

    // Append global directives as a `Host *` block at the end (lowest priority)
    if !global_directives.is_empty() {
        blocks.push(HostBlock {
            patterns: vec!["*".to_string()],
            directives: global_directives,
        });
    }

    ParsedConfig { blocks }
}

// =============================================================================
// Include Expansion
// =============================================================================

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
                if let Ok(paths) = glob::glob(&pattern) {
                    for entry in paths.flatten() {
                        if let Ok(included) = std::fs::read_to_string(&entry) {
                            result.push(included);
                        }
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

// =============================================================================
// Public API
// =============================================================================

fn resolve_entry(computed: &HashMap<String, Vec<String>>, alias: &str) -> SshConfigHostEntry {
    let host_name = computed
        .get("hostname")
        .and_then(|v| v.first())
        .filter(|h| h.as_str() != alias)
        .cloned();

    let user = computed
        .get("user")
        .and_then(|v| v.first())
        .cloned();

    let port = computed
        .get("port")
        .and_then(|v| v.first())
        .and_then(|p| p.parse::<u16>().ok())
        .filter(|&p| p != 22);

    let has_identity_file = computed
        .get("identityfile")
        .map(|v| !v.is_empty())
        .unwrap_or(false);

    SshConfigHostEntry {
        alias: alias.to_string(),
        host_name,
        user,
        port,
        has_identity_file,
    }
}

/// Get all SSH config host entries (non-wildcard).
pub fn get_config_hosts() -> Vec<SshConfigHostEntry> {
    let home = match dirs::home_dir() {
        Some(h) => h,
        None => return vec![],
    };
    let config_path = home.join(".ssh").join("config");
    let content = match std::fs::read_to_string(&config_path) {
        Ok(c) => c,
        Err(_) => return vec![],
    };

    let expanded = expand_includes(&content, &home);
    let config = parse_ssh_config(&expanded);

    let mut entries = Vec::new();
    for alias in config.host_aliases() {
        let computed = config.compute(&alias);
        entries.push(resolve_entry(&computed, &alias));
    }
    entries
}

/// Resolve a host alias from SSH config.
pub fn resolve_host(alias: &str) -> Option<SshConfigHostEntry> {
    let home = dirs::home_dir()?;
    let config_path = home.join(".ssh").join("config");
    let content = std::fs::read_to_string(&config_path).ok()?;

    let expanded = expand_includes(&content, &home);
    let config = parse_ssh_config(&expanded);

    let computed = config.compute(alias);
    if computed.is_empty() {
        return None;
    }

    let entry = resolve_entry(&computed, alias);

    // If nothing was resolved beyond the alias, check if host was actually defined
    if entry.host_name.is_none() && entry.user.is_none() && entry.port.is_none() && !entry.has_identity_file {
        let has_explicit = config.blocks.iter().any(|b| {
            b.patterns.iter().any(|p| p == alias)
        });
        if !has_explicit {
            return None;
        }
    }

    Some(entry)
}

// =============================================================================
// Tests
// =============================================================================

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_parse_simple_config() {
        let config_str = r#"
Host myserver
    HostName 192.168.1.100
    User admin
    Port 2222
    IdentityFile ~/.ssh/id_ed25519

Host devbox
    HostName dev.example.com
    User developer
"#;
        let config = parse_ssh_config(config_str);
        assert_eq!(config.host_aliases(), vec!["myserver", "devbox"]);

        let computed = config.compute("myserver");
        assert_eq!(
            computed.get("hostname").and_then(|v| v.first()).map(|s| s.as_str()),
            Some("192.168.1.100")
        );
        assert_eq!(
            computed.get("user").and_then(|v| v.first()).map(|s| s.as_str()),
            Some("admin")
        );
        assert_eq!(
            computed.get("port").and_then(|v| v.first()).map(|s| s.as_str()),
            Some("2222")
        );
    }

    #[test]
    fn test_wildcard_host() {
        let config_str = r#"
Host *
    ServerAliveInterval 60

Host myserver
    HostName 10.0.0.1
"#;
        let config = parse_ssh_config(config_str);
        // Wildcard should not appear in aliases
        assert_eq!(config.host_aliases(), vec!["myserver"]);

        // But wildcard directives should be inherited
        let computed = config.compute("myserver");
        assert_eq!(
            computed.get("serveraliveinterval").and_then(|v| v.first()).map(|s| s.as_str()),
            Some("60")
        );
    }

    #[test]
    fn test_host_matches() {
        assert!(host_matches("*", "anything"));
        assert!(host_matches("myserver", "myserver"));
        assert!(!host_matches("myserver", "other"));
        assert!(host_matches("dev-*", "dev-box"));
        assert!(!host_matches("dev-*", "prod-box"));
    }

    #[test]
    fn test_resolve_entry() {
        let mut computed = HashMap::new();
        computed.insert("hostname".to_string(), vec!["10.0.0.1".to_string()]);
        computed.insert("user".to_string(), vec!["admin".to_string()]);
        computed.insert("port".to_string(), vec!["2222".to_string()]);
        computed.insert("identityfile".to_string(), vec!["~/.ssh/id_ed25519".to_string()]);

        let entry = resolve_entry(&computed, "myserver");
        assert_eq!(entry.alias, "myserver");
        assert_eq!(entry.host_name, Some("10.0.0.1".to_string()));
        assert_eq!(entry.user, Some("admin".to_string()));
        assert_eq!(entry.port, Some(2222));
        assert!(entry.has_identity_file);
    }

    #[test]
    fn test_resolve_entry_default_port() {
        let mut computed = HashMap::new();
        computed.insert("port".to_string(), vec!["22".to_string()]);

        let entry = resolve_entry(&computed, "myserver");
        // Port 22 should be filtered out (default)
        assert_eq!(entry.port, None);
    }
}
