// memory.go is the Week 28 read + integrity model for Claude Code's own
// per-project memory dirs (<root>/projects/<encoded>/memory/) and agent memory
// (<root>/agent-memory/<name>/) — a SECURITY-CRITICAL surface because MEMORY.md
// is re-loaded into EVERY future session's context, so a mis-resolved dir would
// corrupt the wrong project's recall index. Two guards make that impossible:
// every dir is addressed by a kind-prefixed ID ("project:<encoded>" /
// "agent:<name>"), NEVER a client path — killing cross-project write injection
// at the type level; and ResolveMemoryDir resolves by DETERMINISTIC split +
// validate + confine-PARENT (mirroring ResolveSessionPath), never a scan.
//
// root is always the caller's EffectivePath, threaded from the service layer —
// NEVER claudeDir(), mirroring agents_write.go/skills_inventory.go, so a custom-
// root user's reads, integrity fixes, and deletes all land in the same tree.
//
// This file is read-only (os.Stat/os.ReadFile only); writes live in memory_write.go.
package files

import (
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"

	"claude-devtools/internal/discovery"
)

// MemoryDir is one addressable memory directory. ID is a kind-prefixed,
// server-derived token ("project:<encoded>" / "agent:<name>") that writes take
// instead of a path; Label is the human-decoded name; Path is absolute.
type MemoryDir struct {
	ID    string `json:"id"`
	Label string `json:"label"`
	Path  string `json:"path"`
	Kind  string `json:"kind"` // "project" | "agent"
}

// MemoryFile is one fact file on disk with its parsed frontmatter. FileName is
// the leaf on disk; Name/Description/Type come from the YAML-like frontmatter
// (Type ∈ user|feedback|project|reference).
type MemoryFile struct {
	FileName    string `json:"fileName"`
	Name        string `json:"name"`
	Description string `json:"description"`
	Type        string `json:"type"`
}

// MemoryIndexFix is a byte-exact MEMORY.md edit an integrity finding proposes.
// Op ∈ "add"|"remove"; Line is the exact index line to append (add) or remove
// (verbatim, so removal matches byte-for-byte). Present only on the two
// auto-applicable finding kinds; nil for informational ones.
type MemoryIndexFix struct {
	Op   string `json:"op"`
	Line string `json:"line"`
}

// MemoryFinding is one integrity issue. Kind ∈ orphan-file|dangling-index|
// dangling-link|duplicate-slug. Fix is non-nil only for orphan-file (add) and
// dangling-index (remove); dangling-link and duplicate-slug are informational.
type MemoryFinding struct {
	Kind   string          `json:"kind"`
	File   string          `json:"file"`
	Detail string          `json:"detail"`
	Fix    *MemoryIndexFix `json:"fix"`
}

// MemoryReport is the full integrity result for one memory dir.
type MemoryReport struct {
	Dir      MemoryDir       `json:"dir"`
	Files    []MemoryFile    `json:"files"`
	Findings []MemoryFinding `json:"findings"`
}

var (
	// memoryLinkRe matches a markdown link on one MEMORY.md index line; group 1
	// is the referenced fact-file target.
	memoryLinkRe = regexp.MustCompile(`\[[^\]]*\]\(([^)]+)\)`)
	// wikiLinkRe matches a [[name]] cross-reference inside a fact-file body.
	wikiLinkRe = regexp.MustCompile(`\[\[([^\]]+)\]\]`)
)

// validateMemorySegment rejects any agent name that isn't a single, filename-
// safe segment (no separators, no . / .., not absolute, already lexically
// clean) — the shape of validateAgentFileBase/validateSkillName.
func validateMemorySegment(name string) error {
	if name == "" || name == "." || name == ".." ||
		strings.ContainsRune(name, '/') || strings.ContainsRune(name, filepath.Separator) ||
		filepath.IsAbs(name) || filepath.Clean(name) != name {
		return fmt.Errorf("files: invalid memory agent name %q", name)
	}
	return nil
}

// memoryDirTarget splits a kind-prefixed dirID into its (parentDir, leaf) on
// disk plus a partial MemoryDir, validating the encoded segment WITHOUT any
// filesystem call. project:<encoded> → <root>/projects/<encoded> + "memory";
// agent:<name> → <root>/agent-memory + <name>. An unknown prefix is rejected.
func memoryDirTarget(root, dirID string) (parentDir, leaf string, dir MemoryDir, err error) {
	kind, rest, ok := strings.Cut(dirID, ":")
	if !ok {
		return "", "", MemoryDir{}, fmt.Errorf("files: invalid memory dir id %q", dirID)
	}
	switch kind {
	case "project":
		if !discovery.IsValidProjectID(rest) {
			return "", "", MemoryDir{}, fmt.Errorf("files: invalid memory project id %q", rest)
		}
		label := discovery.DecodePath(rest)
		if label == "" {
			label = rest
		}
		return filepath.Join(root, "projects", rest), "memory",
			MemoryDir{ID: dirID, Label: label, Kind: "project"}, nil
	case "agent":
		if err := validateMemorySegment(rest); err != nil {
			return "", "", MemoryDir{}, err
		}
		return filepath.Join(root, "agent-memory"), rest,
			MemoryDir{ID: dirID, Label: rest, Kind: "agent"}, nil
	default:
		return "", "", MemoryDir{}, fmt.Errorf("files: unknown memory dir kind %q", kind)
	}
}

// ResolveMemoryDir resolves a kind-prefixed dirID to an absolute memory dir path
// confined within root, by DETERMINISTIC split (memoryDirTarget) + confine of
// the PARENT — NEVER a directory scan (mirroring ResolveSessionPath). The parent
// (<root>/projects/<encoded> or <root>/agent-memory) must exist and resolve
// inside canonRoot; a bogus/absent dir is rejected here, so no scan is needed
// for containment.
func ResolveMemoryDir(root, dirID string) (string, MemoryDir, error) {
	parentDir, leaf, dir, err := memoryDirTarget(root, dirID)
	if err != nil {
		return "", MemoryDir{}, err
	}

	canonRoot, err := filepath.EvalSymlinks(root)
	if err != nil {
		return "", MemoryDir{}, fmt.Errorf("files: memory root %q: %w", root, err)
	}
	parentCanon, err := filepath.EvalSymlinks(parentDir)
	if err != nil {
		return "", MemoryDir{}, fmt.Errorf("files: memory dir parent %q: %w", parentDir, err)
	}
	if _, err := Confine(parentCanon, canonRoot); err != nil {
		return "", MemoryDir{}, err
	}

	memDir := filepath.Join(parentCanon, leaf)
	dir.Path = memDir
	return memDir, dir, nil
}

// ListMemoryDirs enumerates <root>/projects/*/memory (only where the memory
// subdir exists) plus <root>/agent-memory/*, skipping dotfile names and
// non-directories (Architect A5). Each row carries a kind-prefixed ID + decoded
// Label. Returns an empty (non-nil) slice when neither root exists.
func ListMemoryDirs(root string) ([]MemoryDir, error) {
	out := []MemoryDir{}

	projectsDir := filepath.Join(root, "projects")
	if entries, err := os.ReadDir(projectsDir); err == nil {
		for _, e := range entries {
			name := e.Name()
			if len(name) == 0 || name[0] == '.' || !e.IsDir() {
				continue
			}
			memDir := filepath.Join(projectsDir, name, "memory")
			if !isDir(memDir) {
				continue
			}
			label := discovery.DecodePath(name)
			if label == "" {
				label = name
			}
			out = append(out, MemoryDir{ID: "project:" + name, Label: label, Path: memDir, Kind: "project"})
		}
	}

	agentDir := filepath.Join(root, "agent-memory")
	if entries, err := os.ReadDir(agentDir); err == nil {
		for _, e := range entries {
			name := e.Name()
			if len(name) == 0 || name[0] == '.' || !e.IsDir() {
				continue
			}
			out = append(out, MemoryDir{ID: "agent:" + name, Label: name, Path: filepath.Join(agentDir, name), Kind: "agent"})
		}
	}

	sort.Slice(out, func(i, j int) bool { return out[i].Label < out[j].Label })
	return out, nil
}

// MemoryIntegrity resolves the dir, parses MEMORY.md (may be absent → empty
// index) and every fact file, and reports the four finding kinds. No filesystem
// writes.
func MemoryIntegrity(root, dirID string) (MemoryReport, error) {
	memDir, dir, err := ResolveMemoryDir(root, dirID)
	if err != nil {
		return MemoryReport{}, err
	}

	indexData, err := os.ReadFile(filepath.Join(memDir, "MEMORY.md"))
	if err != nil && !os.IsNotExist(err) {
		return MemoryReport{}, fmt.Errorf("files: read memory index: %w", err)
	}
	entries := indexEntries(string(indexData))

	facts, err := readFactFiles(memDir)
	if err != nil {
		return MemoryReport{}, err
	}

	report := MemoryReport{Dir: dir, Files: make([]MemoryFile, 0, len(facts)), Findings: []MemoryFinding{}}
	for _, f := range facts {
		report.Files = append(report.Files, f.file)
	}
	report.Findings = append(report.Findings, orphanFindings(facts, entries)...)
	report.Findings = append(report.Findings, danglingIndexFindings(memDir, entries)...)
	report.Findings = append(report.Findings, danglingLinkFindings(facts)...)
	report.Findings = append(report.Findings, duplicateSlugFindings(facts)...)
	return report, nil
}

// indexEntry is one MEMORY.md link line: target is the captured fact-file name,
// line is the verbatim source line (no trailing newline) so a remove fix matches
// byte-for-byte.
type indexEntry struct {
	target string
	line   string
}

// indexEntries extracts one entry per markdown-link line in MEMORY.md.
func indexEntries(content string) []indexEntry {
	var out []indexEntry
	for _, line := range splitLines(content) {
		m := memoryLinkRe.FindStringSubmatch(line)
		if m == nil {
			continue
		}
		out = append(out, indexEntry{target: m[1], line: line})
	}
	return out
}

// factFile is a parsed fact file plus its raw content (kept for [[link]] scan).
type factFile struct {
	file    MemoryFile
	content string
}

// readFactFiles reads the fact-file set — non-hidden *.md excluding MEMORY.md
// (the .md-ext filter already drops *.bak/*.tmp byproducts, Security S3) — and
// parses each frontmatter. Sorted by FileName for deterministic findings. A
// missing dir yields an empty (non-nil) slice.
func readFactFiles(memDir string) ([]factFile, error) {
	entries, err := os.ReadDir(memDir)
	if err != nil {
		return []factFile{}, nil
	}
	var out []factFile
	for _, e := range entries {
		name := e.Name()
		if len(name) == 0 || name[0] == '.' || e.IsDir() {
			continue
		}
		if name == "MEMORY.md" || filepath.Ext(name) != ".md" {
			continue
		}
		content, err := os.ReadFile(filepath.Join(memDir, name))
		if err != nil {
			continue
		}
		fm := parseFrontmatter(string(content))
		out = append(out, factFile{
			file: MemoryFile{
				FileName:    name,
				Name:        fm["name"],
				Description: fm["description"],
				Type:        fm["type"],
			},
			content: string(content),
		})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].file.FileName < out[j].file.FileName })
	return out, nil
}

// orphanFindings flags each fact file the index never references, proposing an
// "add" fix with the exact line to append.
func orphanFindings(facts []factFile, entries []indexEntry) []MemoryFinding {
	referenced := make(map[string]bool, len(entries))
	for _, e := range entries {
		referenced[e.target] = true
	}
	var out []MemoryFinding
	for _, f := range facts {
		if referenced[f.file.FileName] {
			continue
		}
		label := f.file.Description
		if label == "" {
			label = f.file.Name
		}
		if label == "" {
			label = strings.TrimSuffix(f.file.FileName, ".md")
		}
		line := "- [" + f.file.FileName + "](" + f.file.FileName + ") — " + label
		out = append(out, MemoryFinding{
			Kind:   "orphan-file",
			File:   f.file.FileName,
			Detail: "fact file is not referenced in MEMORY.md",
			Fix:    &MemoryIndexFix{Op: "add", Line: line},
		})
	}
	return out
}

// danglingIndexFindings flags each index entry whose target file is absent on
// disk, proposing a "remove" fix carrying the verbatim source line.
func danglingIndexFindings(memDir string, entries []indexEntry) []MemoryFinding {
	var out []MemoryFinding
	for _, e := range entries {
		if _, err := os.Stat(filepath.Join(memDir, e.target)); err == nil {
			continue
		}
		out = append(out, MemoryFinding{
			Kind:   "dangling-index",
			File:   e.target,
			Detail: "indexed file is missing on disk",
			Fix:    &MemoryIndexFix{Op: "remove", Line: e.line},
		})
	}
	return out
}

// danglingLinkFindings flags each [[name]] in a fact-file body that matches no
// fact file (by FileName-without-.md OR by frontmatter Name). Informational: the
// convention permits forward-links to unwritten memories, so Fix is nil.
func danglingLinkFindings(facts []factFile) []MemoryFinding {
	byBase := make(map[string]bool, len(facts))
	byName := make(map[string]bool, len(facts))
	for _, f := range facts {
		byBase[strings.TrimSuffix(f.file.FileName, ".md")] = true
		if f.file.Name != "" {
			byName[f.file.Name] = true
		}
	}
	var out []MemoryFinding
	for _, f := range facts {
		seen := map[string]bool{}
		for _, m := range wikiLinkRe.FindAllStringSubmatch(f.content, -1) {
			name := m[1]
			if byBase[name] || byName[name] || seen[name] {
				continue
			}
			seen[name] = true
			out = append(out, MemoryFinding{
				Kind:   "dangling-link",
				File:   f.file.FileName,
				Detail: "[[" + name + "]] references an unknown memory",
				Fix:    nil,
			})
		}
	}
	return out
}

// duplicateSlugFindings flags each frontmatter Name shared by 2+ fact files —
// one finding per duplicated slug. Manual merge, so Fix is nil.
func duplicateSlugFindings(facts []factFile) []MemoryFinding {
	bySlug := map[string][]string{}
	order := []string{}
	for _, f := range facts {
		name := f.file.Name
		if name == "" {
			continue
		}
		if _, ok := bySlug[name]; !ok {
			order = append(order, name)
		}
		bySlug[name] = append(bySlug[name], f.file.FileName)
	}
	var out []MemoryFinding
	for _, name := range order {
		files := bySlug[name]
		if len(files) < 2 {
			continue
		}
		out = append(out, MemoryFinding{
			Kind:   "duplicate-slug",
			File:   "",
			Detail: fmt.Sprintf("name %q is shared by %s", name, strings.Join(files, ", ")),
			Fix:    nil,
		})
	}
	return out
}
