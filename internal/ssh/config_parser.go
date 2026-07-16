// Package ssh — config_parser.go.
// Reads ~/.ssh/config, expands Include directives, and resolves host aliases.
// PURE: no I/O beyond reading files; fully unit-testable.
package ssh

import (
	"os"
	"path/filepath"
	"regexp"
	"strings"
)

// hostBlock mirrors HostBlock in the Rust source.
type hostBlock struct {
	patterns   []string
	directives map[string][]string // key is lowercased keyword
}

// parsedConfig mirrors ParsedConfig.
type parsedConfig struct {
	blocks []hostBlock
}

// compute merges all blocks matching alias (first-match-wins per directive).
func (pc *parsedConfig) compute(alias string) map[string][]string {
	result := map[string][]string{}
	for _, b := range pc.blocks {
		for _, p := range b.patterns {
			if hostMatches(p, alias) {
				for k, v := range b.directives {
					if _, exists := result[k]; !exists {
						result[k] = v
					}
				}
				break
			}
		}
	}
	return result
}

// hostAliases returns all non-wildcard pattern strings across all blocks.
func (pc *parsedConfig) hostAliases() []string {
	var out []string
	for _, b := range pc.blocks {
		for _, p := range b.patterns {
			if !strings.ContainsAny(p, "*?") {
				out = append(out, p)
			}
		}
	}
	return out
}

// hostMatches implements simple SSH glob matching (* = any sequence, ? = one char).
func hostMatches(pattern, hostname string) bool {
	if pattern == "*" {
		return true
	}
	// Build regex: escape everything, then un-escape our globs.
	reStr := "^" + strings.NewReplacer(
		`\*`, `.*`,
		`\?`, `.`,
	).Replace(regexp.QuoteMeta(pattern)) + "$"
	re, err := regexp.Compile(reStr)
	if err != nil {
		return false
	}
	return re.MatchString(hostname)
}

// parseSSHConfig mirrors parse_ssh_config — line-by-line state machine.
func parseSSHConfig(content string) parsedConfig {
	var blocks []hostBlock
	var currentPatterns []string
	currentDirectives := map[string][]string{}
	inHostBlock := false
	var globalDirectives map[string][]string

	saveBlock := func() {
		if inHostBlock && len(currentPatterns) > 0 {
			blocks = append(blocks, hostBlock{
				patterns:   currentPatterns,
				directives: currentDirectives,
			})
		} else if !inHostBlock {
			globalDirectives = currentDirectives
		}
	}

	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}

		// Split on first space, tab, or =.
		idx := strings.IndexAny(trimmed, " \t=")
		if idx < 0 {
			continue
		}
		keyword := strings.TrimSpace(trimmed[:idx])
		value := strings.TrimSpace(trimmed[idx+1:])
		keyLower := strings.ToLower(keyword)

		switch keyLower {
		case "host":
			saveBlock()
			currentPatterns = strings.Fields(value)
			currentDirectives = map[string][]string{}
			inHostBlock = true
		case "match":
			// Save current, skip Match blocks (complex, rarely needed).
			saveBlock()
			currentPatterns = nil
			currentDirectives = map[string][]string{}
			inHostBlock = true
		default:
			currentDirectives[keyLower] = append(currentDirectives[keyLower], value)
		}
	}

	// Save last block.
	if inHostBlock && len(currentPatterns) > 0 {
		blocks = append(blocks, hostBlock{
			patterns:   currentPatterns,
			directives: currentDirectives,
		})
	} else if !inHostBlock {
		globalDirectives = currentDirectives
	}

	// Append global directives as Host * at lowest priority (same as Rust).
	if len(globalDirectives) > 0 {
		blocks = append(blocks, hostBlock{
			patterns:   []string{"*"},
			directives: globalDirectives,
		})
	}

	return parsedConfig{blocks: blocks}
}

// expandIncludes mirrors expand_includes — replaces Include lines with file content.
func expandIncludes(content, home string) string {
	var parts []string
	for _, line := range strings.Split(content, "\n") {
		trimmed := strings.TrimSpace(line)
		rest := ""
		if strings.HasPrefix(trimmed, "Include ") {
			rest = strings.TrimSpace(trimmed[len("Include "):])
		} else if strings.HasPrefix(trimmed, "include ") {
			rest = strings.TrimSpace(trimmed[len("include "):])
		}
		if rest == "" {
			parts = append(parts, line)
			continue
		}
		pattern := strings.ReplaceAll(rest, "~", home)
		if strings.ContainsAny(pattern, "*?") {
			matches, err := filepath.Glob(pattern)
			if err == nil {
				for _, m := range matches {
					if data, err := os.ReadFile(m); err == nil {
						parts = append(parts, string(data))
					}
				}
			}
		} else {
			if data, err := os.ReadFile(pattern); err == nil {
				parts = append(parts, string(data))
			}
		}
	}
	return strings.Join(parts, "\n")
}

// resolveEntry mirrors resolve_entry — builds a ConfigHostEntry from computed directives.
func resolveEntry(computed map[string][]string, alias string) ConfigHostEntry {
	firstVal := func(key string) *string {
		if v, ok := computed[key]; ok && len(v) > 0 {
			s := v[0]
			return &s
		}
		return nil
	}

	hn := firstVal("hostname")
	if hn != nil && *hn == alias {
		hn = nil
	}

	var port *uint16
	if ps := firstVal("port"); ps != nil {
		n := 0
		for _, c := range *ps {
			if c < '0' || c > '9' {
				n = -1
				break
			}
			n = n*10 + int(c-'0')
		}
		if n >= 0 && n != 22 && n <= 65535 {
			u := uint16(n)
			port = &u
		}
	}

	hasIdentityFile := false
	if v, ok := computed["identityfile"]; ok && len(v) > 0 {
		hasIdentityFile = true
	}

	return ConfigHostEntry{
		Alias:           alias,
		HostName:        hn,
		User:            firstVal("user"),
		Port:            port,
		HasIdentityFile: hasIdentityFile,
	}
}

// GetConfigHosts mirrors config_parser::get_config_hosts.
func GetConfigHosts() []ConfigHostEntry {
	home, err := os.UserHomeDir()
	if err != nil {
		return []ConfigHostEntry{}
	}
	data, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return []ConfigHostEntry{}
	}

	expanded := expandIncludes(string(data), home)
	cfg := parseSSHConfig(expanded)

	var entries []ConfigHostEntry
	for _, alias := range cfg.hostAliases() {
		computed := cfg.compute(alias)
		entries = append(entries, resolveEntry(computed, alias))
	}
	if entries == nil {
		return []ConfigHostEntry{}
	}
	return entries
}

// ResolveHost mirrors config_parser::resolve_host.
func ResolveHost(alias string) *ConfigHostEntry {
	home, err := os.UserHomeDir()
	if err != nil {
		return nil
	}
	data, err := os.ReadFile(filepath.Join(home, ".ssh", "config"))
	if err != nil {
		return nil
	}

	expanded := expandIncludes(string(data), home)
	cfg := parseSSHConfig(expanded)

	computed := cfg.compute(alias)
	if len(computed) == 0 {
		return nil
	}

	entry := resolveEntry(computed, alias)

	// If nothing resolved beyond the alias, verify an explicit block exists.
	if entry.HostName == nil && entry.User == nil && entry.Port == nil && !entry.HasIdentityFile {
		found := false
		for _, b := range cfg.blocks {
			for _, pat := range b.patterns {
				if pat == alias {
					found = true
					break
				}
			}
			if found {
				break
			}
		}
		if !found {
			return nil
		}
	}

	return &entry
}
