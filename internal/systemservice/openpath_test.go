package systemservice

import (
	"runtime"
	"testing"
)

// TestOpenPathCmd_ArgsContainTarget verifies the target is passed as the last
// argument regardless of the host OS.
func TestOpenPathCmd_ArgsContainTarget(t *testing.T) {
	const target = "/Users/test/Documents"
	cmd := openPathCmd(target)
	if len(cmd.Args) == 0 {
		t.Fatal("expected at least one arg")
	}
	last := cmd.Args[len(cmd.Args)-1]
	if last != target {
		t.Errorf("last arg = %q; want %q", last, target)
	}
}

// TestOpenPathCmd_BinaryName verifies the correct OS binary is selected.
func TestOpenPathCmd_BinaryName(t *testing.T) {
	cmd := openPathCmd("/tmp/x")
	var wantBin string
	switch runtime.GOOS {
	case "darwin":
		wantBin = "open"
	case "windows":
		wantBin = "explorer"
	default:
		wantBin = "xdg-open"
	}
	// cmd.Args[0] is the name as passed to exec.Command, before LookPath resolution.
	if cmd.Args[0] != wantBin {
		t.Errorf("binary = %q; want %q", cmd.Args[0], wantBin)
	}
}
