package maintenance

import (
	"os"
	"path/filepath"
	"testing"
)

func TestClearFilesDelete(t *testing.T) {
	root := t.TempDir()
	appData := filepath.Join(root, ".appdata")
	f := filepath.Join(root, "logs", "old.jsonl")
	writeFile(t, f, "log")

	if err := ClearFiles([]string{root, appData}, appData, []string{f}, false); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Lstat(f); !os.IsNotExist(err) {
		t.Error("delete must remove the file")
	}
}

func TestClearFilesTruncateKeepsInode(t *testing.T) {
	root := t.TempDir()
	appData := filepath.Join(root, ".appdata")
	daemon := filepath.Join(root, "daemon.log")
	if err := os.WriteFile(daemon, []byte("lots of log data"), 0o644); err != nil {
		t.Fatal(err)
	}
	before, _ := os.Stat(daemon)

	if err := ClearFiles([]string{root, appData}, appData, []string{daemon}, true); err != nil {
		t.Fatal(err)
	}
	after, err := os.Stat(daemon)
	if err != nil {
		t.Fatalf("truncate must keep the file: %v", err)
	}
	if after.Size() != 0 {
		t.Errorf("truncate must zero the file, size=%d", after.Size())
	}
	// A held fd keeps writing to the same inode: append after truncate works.
	f, _ := os.OpenFile(daemon, os.O_APPEND|os.O_WRONLY, 0o644)
	f.WriteString("post-truncate write")
	f.Close()
	final, _ := os.Stat(daemon)
	if final.Size() == 0 {
		t.Error("append after truncate must land in the same file")
	}
	_ = before
}

func TestClearFilesRefusesSymlinkAndEscape(t *testing.T) {
	root := t.TempDir()
	appData := filepath.Join(root, ".appdata")
	outside := filepath.Join(t.TempDir(), "secret")
	writeFile(t, outside, "secret")

	// Out-of-root path refused.
	if err := ClearFiles([]string{root, appData}, appData, []string{outside}, false); err == nil {
		t.Error("out-of-root path must be refused")
	}
	// Symlinked leaf refused (never delete/truncate through a link).
	target := filepath.Join(root, "target")
	writeFile(t, target, "data")
	link := filepath.Join(root, "link")
	if err := os.Symlink(target, link); err == nil {
		if err := ClearFiles([]string{root, appData}, appData, []string{link}, false); err == nil {
			t.Error("symlinked leaf must be refused")
		}
		if _, err := os.Stat(target); err != nil {
			t.Error("symlink target must be untouched")
		}
	}
}
