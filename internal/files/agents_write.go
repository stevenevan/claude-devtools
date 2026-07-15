// agents_write.go is the Week 26 write path for global agent definitions
// under <root>/agents/*.md — a SECURITY-CRITICAL surface that steers what a
// Claude Code agent can do. It mirrors text_write.go's spine: a dedicated
// mutex, read-fresh-under-lock, confine-PARENT-to-root, .bak backup, and
// atomic temp+rename. root is always the caller's EffectivePath, threaded in
// from the service layer — NEVER claudeDir(), so a custom-root user's writes
// land in the same tree the manager reads and trashes.
//
// The frontmatter is patched at the LINE level, never YAML-reserialized:
// parseFrontmatter (pathutil.go) is a naive line splitter, so a full
// round-trip would lose quoting/order/comments and a block-scalar value would
// be corrupted. Only touched keys are rewritten; every other frontmatter line
// and the whole body are preserved byte-for-byte.
package files

import (
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"sync"
)

// agentsWriteMu is the single mutex for the whole agent-file family — one
// lock, not a per-path map — mirroring instructionWriteMu: read-fresh-under-
// lock kills the lost-update race and MaintenanceService's s.mu already
// serializes at the service layer.
var agentsWriteMu sync.Mutex

// KnownAgentModels is the set of agent model aliases/IDs seen in the wild
// (live ~/.claude/agents/*.md carry bare opus/sonnet/haiku; the repo's
// CLAUDE.md names the full IDs). Used by Go validation and tests only — the
// frontend <select> carries its own TS copy, since a Go var isn't reachable
// through the generated bindings. An unknown model is a warning, never a hard
// block: new models appear over time.
var KnownAgentModels = []string{
	"opus",
	"sonnet",
	"haiku",
	"inherit",
	"claude-opus-4-8",
	"claude-sonnet-5",
	"claude-haiku-4-5",
}

// AgentPatch is a typed, sparse frontmatter+body patch. A nil pointer leaves
// that field untouched (pointers so "" clears a value distinctly from "leave
// alone"). Body, when non-nil, replaces everything after the closing --- fence
// wholesale; when nil the body bytes are preserved verbatim. The agent
// filename is immutable after create — a frontmatter name change never renames
// the file.
type AgentPatch struct {
	Name        *string `json:"name"`
	Description *string `json:"description"`
	Tools       *string `json:"tools"`
	Model       *string `json:"model"`
	Body        *string `json:"body"`
}

// agentsDir returns <root>/agents. root is the caller's EffectivePath.
func agentsDir(root string) string {
	return filepath.Join(root, "agents")
}

// validateAgentFileBase rejects any fileBase that isn't a single, filename-
// safe segment (no separators, no . / .., not absolute, already lexically
// clean) before any filesystem call. fileBase carries no ".md" extension.
func validateAgentFileBase(fileBase string) error {
	if fileBase == "" || fileBase == "." || fileBase == ".." ||
		strings.ContainsRune(fileBase, '/') || strings.ContainsRune(fileBase, filepath.Separator) ||
		filepath.IsAbs(fileBase) || filepath.Clean(fileBase) != fileBase {
		return fmt.Errorf("files: invalid agent file name %q", fileBase)
	}
	return nil
}

// ResolveAgentPath validates fileBase and resolves it to an absolute path
// confined within root, following the ResolveInstructionPath idiom:
// canonicalize root, create <root>/agents if missing, then EvalSymlinks +
// Confine the PARENT (agents dir) — never the leaf, which may not exist yet
// (Confine returns a non-existent candidate unchanged, so confining the leaf
// gives no containment). Returns <canonAgentsDir>/<fileBase>.md.
func ResolveAgentPath(root, fileBase string) (string, error) {
	if err := validateAgentFileBase(fileBase); err != nil {
		return "", err
	}

	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", fmt.Errorf("files: agents root %q: %w", root, err)
	}

	dir := agentsDir(canonRoot)
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("files: create agents directory: %w", err)
	}

	parentCanon, err := filepath.EvalSymlinks(dir)
	if err != nil {
		return "", fmt.Errorf("files: agents directory: %w", err)
	}
	if _, err := Confine(parentCanon, canonRoot); err != nil {
		return "", err
	}

	return filepath.Join(parentCanon, fileBase+".md"), nil
}

// ReadManagedAgents reads <root>/agents/*.md into GlobalAgent rows — the
// ReadGlobalAgents body, but root-threaded so the manager lists exactly what
// it writes for a custom-root user. Returns an empty (non-nil) slice when the
// agents dir is missing.
func ReadManagedAgents(root string) ([]GlobalAgent, error) {
	dir := agentsDir(root)

	var out []GlobalAgent
	entries, err := os.ReadDir(dir)
	if err != nil {
		return []GlobalAgent{}, nil
	}
	for _, e := range entries {
		if e.IsDir() || filepath.Ext(e.Name()) != ".md" {
			continue
		}
		p := filepath.Join(dir, e.Name())
		content, err := os.ReadFile(p)
		if err != nil {
			continue
		}
		fm := parseFrontmatter(string(content))
		name := fm["name"]
		if name == "" {
			name = e.Name()[:len(e.Name())-3]
		}
		out = append(out, GlobalAgent{
			Name:        name,
			Description: fm["description"],
			Tools:       fm["tools"],
			Model:       fm["model"],
			FilePath:    p,
			Content:     string(content),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// PatchAgentFrontmatter applies a sparse typed patch to an existing agent
// file. It locks agentsWriteMu, resolves+confines the path, reads fresh, and
// splits the file at the frontmatter fence parseFrontmatter uses. Each
// non-nil frontmatter field replaces its key's line in place (or appends it
// inside the block if absent), REFUSING first if the key's existing value is a
// block scalar / multi-line — a naive line-replace there would orphan the
// continuation lines. Untouched frontmatter lines and the body are preserved
// byte-for-byte (unless Body is non-nil, which replaces the whole body). The
// result is validated to still re-parse a non-empty name, then written .bak-
// first via atomic temp+rename.
func PatchAgentFrontmatter(root, fileBase string, patch AgentPatch) error {
	agentsWriteMu.Lock()
	defer agentsWriteMu.Unlock()

	dest, err := ResolveAgentPath(root, fileBase)
	if err != nil {
		return err
	}

	current, err := os.ReadFile(dest)
	if err != nil {
		return fmt.Errorf("files: read agent %q: %w", fileBase, err)
	}

	open, block, closeAndAfter, ok := splitAgentFrontmatter(string(current))
	if !ok {
		return fmt.Errorf("files: agent %q has no frontmatter fence", fileBase)
	}

	lines := strings.Split(block, "\n")
	for _, field := range []struct {
		key string
		val *string
	}{
		{"name", patch.Name},
		{"description", patch.Description},
		{"tools", patch.Tools},
		{"model", patch.Model},
	} {
		if field.val == nil {
			continue
		}
		lines, err = applyFrontmatterField(lines, field.key, *field.val)
		if err != nil {
			return err
		}
	}
	newBlock := strings.Join(lines, "\n")

	fence, body := splitClosingFence(closeAndAfter)
	if patch.Body != nil {
		body = *patch.Body
	}

	next := []byte(open + newBlock + fence + body)
	if parseFrontmatter(string(next))["name"] == "" {
		return fmt.Errorf("files: patched agent %q has no name", fileBase)
	}

	if err := atomicWriteFile(dest+".bak", current); err != nil {
		return fmt.Errorf("files: write backup for agent %q: %w", fileBase, err)
	}
	if err := atomicWriteFile(dest, next); err != nil {
		return fmt.Errorf("files: write agent %q: %w", fileBase, err)
	}
	return nil
}

// CreateAgent writes a new <name>.md with a minimal name+description
// frontmatter template. name must be filename-safe and unique across the
// agents dir (read fresh); description must not contain a newline and is
// written double-quoted with embedded " and \ escaped, so a leading >/|/#
// can't break the template. The dest is resolved through the same MkdirAll +
// confine-parent idiom as ResolveAgentPath (a custom-root agents/ may be a
// symlink or not exist yet). No .bak — the file is new.
func CreateAgent(root, name, description string) error {
	agentsWriteMu.Lock()
	defer agentsWriteMu.Unlock()

	if err := validateAgentFileBase(name); err != nil {
		return err
	}
	if strings.ContainsAny(description, "\n\r") {
		return fmt.Errorf("files: agent description must not contain a newline")
	}

	existing, err := ReadManagedAgents(root)
	if err != nil {
		return err
	}
	target := name + ".md"
	for _, a := range existing {
		if filepath.Base(a.FilePath) == target {
			return fmt.Errorf("files: agent %q already exists", name)
		}
	}

	dest, err := ResolveAgentPath(root, name)
	if err != nil {
		return err
	}
	if _, err := os.Stat(dest); err == nil {
		return fmt.Errorf("files: agent %q already exists", name)
	} else if !os.IsNotExist(err) {
		return fmt.Errorf("files: stat agent %q: %w", name, err)
	}

	esc := strings.ReplaceAll(description, `\`, `\\`)
	esc = strings.ReplaceAll(esc, `"`, `\"`)
	tmpl := "---\nname: " + name + "\ndescription: \"" + esc + "\"\n---\n\n"

	if err := atomicWriteFile(dest, []byte(tmpl)); err != nil {
		return fmt.Errorf("files: write agent %q: %w", name, err)
	}
	return nil
}

// splitAgentFrontmatter splits content into (openFence, block, closeAndAfter)
// at the same boundary parseFrontmatter uses: leading whitespace + "---" is
// the open fence, block is everything up to (not including) the closing
// "\n---", and closeAndAfter begins with that "\n---". ok is false when no
// frontmatter fence is present. openFence+block+closeAndAfter == content.
func splitAgentFrontmatter(content string) (open, block, closeAndAfter string, ok bool) {
	lead := 0
	for lead < len(content) && isFrontmatterSpace(content[lead]) {
		lead++
	}
	if !strings.HasPrefix(content[lead:], "---") {
		return "", "", "", false
	}
	openEnd := lead + 3
	rest := content[openEnd:]
	end := strings.Index(rest, "\n---")
	if end < 0 {
		return "", "", "", false
	}
	blockEnd := openEnd + end
	return content[:openEnd], content[openEnd:blockEnd], content[blockEnd:], true
}

// splitClosingFence divides closeAndAfter (which begins with "\n---") into the
// fence portion — through the newline that ends the closing-fence line — and
// the body that follows. fence+body == closeAndAfter, so a nil-Body patch
// reassembles byte-for-byte.
func splitClosingFence(closeAndAfter string) (fence, body string) {
	const marker = "\n---"
	after := closeAndAfter[len(marker):]
	nl := strings.IndexByte(after, '\n')
	if nl < 0 {
		return closeAndAfter, ""
	}
	return closeAndAfter[:len(marker)+nl+1], after[nl+1:]
}

// applyFrontmatterField rewrites key's line to "key: value" in place (or
// appends it at the end of the block when absent), returning the updated
// lines. It refuses when the existing value is a block scalar or multi-line
// (isBlockScalarOrMultiline) rather than orphaning continuation lines.
func applyFrontmatterField(lines []string, key, value string) ([]string, error) {
	if strings.ContainsAny(value, "\n\r") {
		return nil, fmt.Errorf("files: refusing to patch %q: value must not contain a newline", key)
	}
	for i, line := range lines {
		k, ok := lineKey(line)
		if !ok || k != key {
			continue
		}
		if isBlockScalarOrMultiline(lines, i) {
			return nil, fmt.Errorf("files: refusing to patch %q: value is a block scalar or spans multiple lines", key)
		}
		lines[i] = key + ": " + value
		return lines, nil
	}
	return append(lines, key+": "+value), nil
}

// lineKey extracts the frontmatter key from a line the way parseFrontmatter
// does (trim, first colon). ok is false for a blank/keyless line.
func lineKey(line string) (string, bool) {
	trimmed := trimWhitespace(line)
	ci := strings.IndexByte(trimmed, ':')
	if ci < 0 {
		return "", false
	}
	key := trimWhitespace(trimmed[:ci])
	if key == "" {
		return "", false
	}
	return key, true
}

// isBlockScalarOrMultiline reports whether the key at lines[idx] carries a
// value the naive line-patcher must not touch: a YAML block-scalar indicator
// (> or |) OR an indented continuation on the next line. Patching such a key
// by line would silently drop its continuation lines.
func isBlockScalarOrMultiline(lines []string, idx int) bool {
	trimmed := trimWhitespace(lines[idx])
	if ci := strings.IndexByte(trimmed, ':'); ci >= 0 {
		val := trimWhitespace(trimmed[ci+1:])
		if strings.HasPrefix(val, ">") || strings.HasPrefix(val, "|") {
			return true
		}
	}
	if idx+1 < len(lines) {
		next := lines[idx+1]
		if len(next) > 0 && (next[0] == ' ' || next[0] == '\t') {
			return true
		}
	}
	return false
}

// isFrontmatterSpace matches the leading-whitespace set parseFrontmatter trims.
func isFrontmatterSpace(c byte) bool {
	return c == ' ' || c == '\t' || c == '\n' || c == '\r'
}
