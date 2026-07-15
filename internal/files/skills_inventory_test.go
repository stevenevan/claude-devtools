// External test package (files_test): the delete/remove->restore round-trips
// import internal/maintenance, which itself imports internal/files, so an
// internal (package files) test would form an import cycle. Everything here
// exercises only the exported skills-writer API + maintenance.TrashItems/
// RestoreTrash — the program's canonical symlink-safety assertion on real ground.
package files_test

import (
	"os"
	"path/filepath"
	"testing"

	"claude-devtools/internal/files"
	"claude-devtools/internal/maintenance"
)

const alphaSkillMd = "---\n" +
	"name: alpha\n" +
	"description: The alpha skill for testing\n" +
	"---\n" +
	"\n" +
	"# Alpha\n" +
	"\n" +
	"The alpha skill body.\n"

func mkdir(t *testing.T, dir string) {
	t.Helper()
	if err := os.MkdirAll(dir, 0o755); err != nil {
		t.Fatalf("mkdir %q: %v", dir, err)
	}
}

func write(t *testing.T, path, content string) {
	t.Helper()
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("write %q: %v", path, err)
	}
}

func link(t *testing.T, target, linkPath string) {
	t.Helper()
	if err := os.Symlink(target, linkPath); err != nil {
		t.Fatalf("symlink %q -> %q: %v", linkPath, target, err)
	}
}

// skillsFixture is one built temp tree plus the out-of-root facts the symlink
// assertions pin against.
type skillsFixture struct {
	root        string // the EffectivePath-style claude root
	realrepo    string // out-of-root dir gamma points at (must survive a link trash)
	gammaTarget string // the raw symlink text of gamma (relative, out-of-root)
	betaTarget  string // the raw symlink text of beta (== shared, in-root)
}

// buildSkillsFixture lays down: a REAL skill dir alpha (SKILL.md + references/),
// a real utility dir shared (no SKILL.md), an IN-ROOT symlink beta -> shared, an
// OUT-OF-ROOT symlink gamma -> ../../realrepo (a real dir with a sentinel,
// created as a sibling of root under a shared base), and a .DS_Store dotfile
// that must be skipped. beta points at shared (not alpha) so HasReferences stays
// true for alpha only.
//
// gamma is RELATIVE, mirroring the live `slidev -> ../../.agents/skills/slidev`:
// its target escapes root when resolved from skills/, but once the link is moved
// into a trash receipt the relative target dangles inside the receipt — so the
// trash engine's restore source-confine (files.Confine, which follows symlinks)
// sees it as non-existent and passes it through unchanged, letting the link
// round-trip. An ABSOLUTE out-of-root target would instead resolve to the still-
// existing repo and be rejected as escaping the receipt dir.
func buildSkillsFixture(t *testing.T) skillsFixture {
	t.Helper()
	base := t.TempDir()
	root := filepath.Join(base, "claude")
	skills := filepath.Join(root, "skills")

	alpha := filepath.Join(skills, "alpha")
	mkdir(t, filepath.Join(alpha, "references"))
	write(t, filepath.Join(alpha, "SKILL.md"), alphaSkillMd)
	write(t, filepath.Join(alpha, "references", "ref.md"), "reference body\n")

	shared := filepath.Join(skills, "shared")
	mkdir(t, shared)
	write(t, filepath.Join(shared, "helper.txt"), "helper\n")

	link(t, shared, filepath.Join(skills, "beta"))

	realrepo := filepath.Join(base, "realrepo")
	mkdir(t, realrepo)
	write(t, filepath.Join(realrepo, "sentinel.txt"), "do not touch\n")
	gammaTarget := filepath.Join("..", "..", "realrepo") // from root/skills/ -> base/realrepo
	link(t, gammaTarget, filepath.Join(skills, "gamma"))

	write(t, filepath.Join(skills, ".DS_Store"), "junk\n")

	return skillsFixture{root: root, realrepo: realrepo, gammaTarget: gammaTarget, betaTarget: shared}
}

func findEntry(t *testing.T, entries []files.SkillInventoryEntry, name string) files.SkillInventoryEntry {
	t.Helper()
	for _, e := range entries {
		if e.Name == name {
			return e
		}
	}
	t.Fatalf("entry %q not found in inventory %+v", name, entries)
	return files.SkillInventoryEntry{}
}

func TestSkillsInventoryClassifiesEntries(t *testing.T) {
	fx := buildSkillsFixture(t)

	entries, err := files.SkillsInventory(fx.root)
	if err != nil {
		t.Fatalf("SkillsInventory: %v", err)
	}
	if len(entries) != 4 {
		t.Fatalf("want 4 entries (alpha, beta, gamma, shared), got %d: %+v", len(entries), entries)
	}
	for _, e := range entries {
		if e.Name == ".DS_Store" {
			t.Fatal("dotfile .DS_Store must be skipped")
		}
	}

	alpha := findEntry(t, entries, "alpha")
	if alpha.IsSymlink {
		t.Error("alpha is a real dir, IsSymlink must be false")
	}
	if !alpha.HasSkillMd {
		t.Error("alpha has a SKILL.md, HasSkillMd must be true")
	}
	if !alpha.HasReferences {
		t.Error("alpha has references/, HasReferences must be true")
	}
	if alpha.Description != "The alpha skill for testing" {
		t.Errorf("alpha description = %q, want frontmatter value", alpha.Description)
	}

	beta := findEntry(t, entries, "beta")
	if !beta.IsSymlink {
		t.Error("beta is a symlink, IsSymlink must be true")
	}
	if beta.SymlinkTarget != fx.betaTarget {
		t.Errorf("beta SymlinkTarget = %q, want %q", beta.SymlinkTarget, fx.betaTarget)
	}
	if beta.HasReferences {
		t.Error("beta resolves to shared (no references) — HasReferences must stay true for alpha only")
	}

	gamma := findEntry(t, entries, "gamma")
	if !gamma.IsSymlink {
		t.Error("gamma is a symlink, IsSymlink must be true")
	}
	if gamma.SymlinkTarget != fx.gammaTarget {
		t.Errorf("gamma SymlinkTarget = %q, want %q", gamma.SymlinkTarget, fx.gammaTarget)
	}

	shared := findEntry(t, entries, "shared")
	if shared.IsSymlink {
		t.Error("shared is a real dir, IsSymlink must be false")
	}
	if shared.HasSkillMd {
		t.Error("shared has no SKILL.md, HasSkillMd must be false")
	}
}

func TestWriteSkillDocRefusesSymlinkAndMissingSkillMd(t *testing.T) {
	fx := buildSkillsFixture(t)

	if err := files.WriteSkillDoc(fx.root, "gamma", []byte("nope\n")); err == nil {
		t.Error("WriteSkillDoc through a symlinked skill must be refused")
	}
	// The out-of-root target must be wholly untouched by the refused write.
	if _, err := os.Stat(filepath.Join(fx.realrepo, "sentinel.txt")); err != nil {
		t.Errorf("refused symlink write must not touch the out-of-root target: %v", err)
	}

	if err := files.WriteSkillDoc(fx.root, "shared", []byte("nope\n")); err == nil {
		t.Error("WriteSkillDoc into a dir with no SKILL.md must be refused")
	}
	if _, err := os.Stat(filepath.Join(fx.root, "skills", "shared", "SKILL.md")); !os.IsNotExist(err) {
		t.Errorf("no SKILL.md may be fabricated in a non-skill dir, stat err = %v", err)
	}
}

func TestWriteSkillDocRoundTripsAlpha(t *testing.T) {
	fx := buildSkillsFixture(t)
	skillMd := filepath.Join(fx.root, "skills", "alpha", "SKILL.md")

	newContent := "---\nname: alpha\ndescription: edited\n---\n\n# Edited\n\nnew body.\n"
	if err := files.WriteSkillDoc(fx.root, "alpha", []byte(newContent)); err != nil {
		t.Fatalf("WriteSkillDoc: %v", err)
	}

	got, err := os.ReadFile(skillMd)
	if err != nil {
		t.Fatalf("read SKILL.md: %v", err)
	}
	if string(got) != newContent {
		t.Errorf("SKILL.md not written byte-faithfully.\n got: %q\nwant: %q", got, newContent)
	}

	bak, err := os.ReadFile(skillMd + ".bak")
	if err != nil {
		t.Fatalf("read .bak: %v", err)
	}
	if string(bak) != alphaSkillMd {
		t.Errorf(".bak = %q, want original %q", bak, alphaSkillMd)
	}
}

func TestRemoveGammaLinkPreservesOutOfRootTarget(t *testing.T) {
	fx := buildSkillsFixture(t)
	appData := t.TempDir()
	roots := []string{fx.root}

	dest, err := files.ResolveSkillLinkPath(fx.root, "gamma")
	if err != nil {
		t.Fatalf("ResolveSkillLinkPath: %v", err)
	}

	receipt, err := maintenance.TrashItems(roots, appData, []string{dest})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}

	// The LINK entry is gone...
	if _, err := os.Lstat(dest); !os.IsNotExist(err) {
		t.Fatalf("gamma link should be gone after trash, lstat err = %v", err)
	}
	// ...but the canonical assertion: the out-of-root target is untouched.
	if info, err := os.Stat(fx.realrepo); err != nil || !info.IsDir() {
		t.Fatalf("out-of-root realrepo must survive a link trash: err=%v", err)
	}
	sentinel, err := os.ReadFile(filepath.Join(fx.realrepo, "sentinel.txt"))
	if err != nil || string(sentinel) != "do not touch\n" {
		t.Fatalf("out-of-root sentinel must be intact: content=%q err=%v", sentinel, err)
	}

	if err := maintenance.RestoreTrash(roots, appData, receipt.ID); err != nil {
		t.Fatalf("RestoreTrash: %v", err)
	}
	lst, err := os.Lstat(dest)
	if err != nil {
		t.Fatalf("lstat restored gamma: %v", err)
	}
	if lst.Mode()&os.ModeSymlink == 0 {
		t.Error("restored gamma must be a symlink again, not a copied dir")
	}
	target, err := os.Readlink(dest)
	if err != nil {
		t.Fatalf("readlink restored gamma: %v", err)
	}
	if target != fx.gammaTarget {
		t.Errorf("restored gamma target = %q, want %q", target, fx.gammaTarget)
	}
}

func TestDeleteAlphaRoundTripsReferences(t *testing.T) {
	fx := buildSkillsFixture(t)
	appData := t.TempDir()
	roots := []string{fx.root}
	refFile := filepath.Join(fx.root, "skills", "alpha", "references", "ref.md")

	dest, err := files.ResolveSkillDirPath(fx.root, "alpha")
	if err != nil {
		t.Fatalf("ResolveSkillDirPath: %v", err)
	}

	receipt, err := maintenance.TrashItems(roots, appData, []string{dest})
	if err != nil {
		t.Fatalf("TrashItems: %v", err)
	}
	if _, err := os.Lstat(dest); !os.IsNotExist(err) {
		t.Fatalf("alpha dir should be gone after trash, lstat err = %v", err)
	}

	if err := maintenance.RestoreTrash(roots, appData, receipt.ID); err != nil {
		t.Fatalf("RestoreTrash: %v", err)
	}
	got, err := os.ReadFile(refFile)
	if err != nil {
		t.Fatalf("read restored references file: %v", err)
	}
	if string(got) != "reference body\n" {
		t.Errorf("restored references file not byte-identical: %q", got)
	}
}
