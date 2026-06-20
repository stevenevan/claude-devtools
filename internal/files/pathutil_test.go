// Tests port path_util.rs #[test]s verbatim (security cases).
package files

import (
	"strings"
	"testing"
)

const (
	validSession = "0123abcd-4567-89ef-abcd-0123456789ab"
	validProject = "-Users-name-project"
)

var validUUIDs = []string{
	"00000000-0000-0000-0000-000000000000",
	"ffffffff-ffff-ffff-ffff-ffffffffffff",
	"0123abcd-4567-89ef-abcd-0123456789ab",
	"ABCDEF01-2345-6789-abcd-ef0123456789",
	"deadbeef-cafe-babe-feed-c0ffee123456",
	"11111111-2222-3333-4444-555555555555",
	"aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee",
	"12345678-90ab-cdef-1234-567890abcdef",
	"fedcba98-7654-3210-fedc-ba9876543210",
	"abcdef01-2345-6789-abcd-ef0123456789",
}

var invalidSessionIDs = []string{
	"",
	"ABCD",
	"../../../etc/passwd",
	"abc\x00def",
	"abc\x1b[31m",
	"gggggggg-gggg-gggg-gggg-gggggggggggg",
	"0123abcd-4567-89ef-abcd-0123456789a",   // too short
	"0123abcd45678-9ef-abcd-0123456789ab",   // malformed
	"0123abcd-4567-89ef-abcd-0123456789abc", // too long
}

// valid_uuids_all_accepted
func TestValidUUIDsAllAccepted(t *testing.T) {
	for _, id := range validUUIDs {
		if err := ValidateSessionIDPair(validProject, id); err != nil {
			t.Errorf("expected accept for %q, got %v", id, err)
		}
	}
}

// invalid_session_ids_all_rejected
func TestInvalidSessionIDsAllRejected(t *testing.T) {
	for _, id := range invalidSessionIDs {
		err := ValidateSessionIDPair(validProject, id)
		if err == nil {
			t.Errorf("expected reject for %q", id)
		}
		if err != nil && !strings.Contains(err.Error(), ErrInvalidSessionID) {
			t.Errorf("wrong error for %q: %v", id, err)
		}
	}
}

// validate_pair_rejects_bad_session
func TestValidatePairRejectsBadSession(t *testing.T) {
	err := ValidateSessionIDPair(validProject, "../../../etc/passwd")
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSessionID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSessionID, err)
	}
}

// validate_pair_rejects_null_byte_session
func TestValidatePairRejectsNullByteSession(t *testing.T) {
	payload := "abc\x00def-4567-89ef-abcd-0123456789ab"
	err := ValidateSessionIDPair(validProject, payload)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSessionID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSessionID, err)
	}
}

// validate_pair_rejects_control_char_session
func TestValidatePairRejectsControlCharSession(t *testing.T) {
	payload := "abc\x1b[31m-4567-89ef-abcd-0123456789ab"
	err := ValidateSessionIDPair(validProject, payload)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSessionID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSessionID, err)
	}
}

// validate_pair_rejects_short_session
func TestValidatePairRejectsShortSession(t *testing.T) {
	err := ValidateSessionIDPair(validProject, "ABCD")
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSessionID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSessionID, err)
	}
}

// validate_pair_rejects_empty_session
func TestValidatePairRejectsEmptySession(t *testing.T) {
	err := ValidateSessionIDPair(validProject, "")
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSessionID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSessionID, err)
	}
}

// validate_pair_rejects_no_leading_dash_project
func TestValidatePairRejectsNoLeadingDashProject(t *testing.T) {
	err := ValidateSessionIDPair("../escape", validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidProjectID) {
		t.Fatalf("expected %q, got %v", ErrInvalidProjectID, err)
	}
}

// validate_pair_rejects_short_composite_hash
func TestValidatePairRejectsShortCompositeHash(t *testing.T) {
	err := ValidateSessionIDPair("-Users-name-project::SHORT", validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidProjectID) {
		t.Fatalf("expected %q, got %v", ErrInvalidProjectID, err)
	}
}

// validate_pair_rejects_composite_traversal_hash
func TestValidatePairRejectsCompositeTraversalHash(t *testing.T) {
	err := ValidateSessionIDPair("-Users-name-project::../../etc", validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidProjectID) {
		t.Fatalf("expected %q, got %v", ErrInvalidProjectID, err)
	}
}

// validate_pair_rejects_null_byte_in_project
func TestValidatePairRejectsNullByteInProject(t *testing.T) {
	payload := "-Users-name-project\x00"
	err := ValidateSessionIDPair(payload, validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidProjectID) {
		t.Fatalf("expected %q, got %v", ErrInvalidProjectID, err)
	}
}

// validate_pair_rejects_dotdot_with_null_byte
func TestValidatePairRejectsDotDotWithNullByte(t *testing.T) {
	payload := "-..\x00"
	err := ValidateSessionIDPair(payload, validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidProjectID) {
		t.Fatalf("expected %q, got %v", ErrInvalidProjectID, err)
	}
}

// validate_pair_rejects_oversize_project
func TestValidatePairRejectsOversizeProject(t *testing.T) {
	payload := "-foo" + strings.Repeat("a", 1024)
	err := ValidateSessionIDPair(payload, validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidProjectID) {
		t.Fatalf("expected %q, got %v", ErrInvalidProjectID, err)
	}
}

// validate_pair_accepts_valid_composite
func TestValidatePairAcceptsValidComposite(t *testing.T) {
	if err := ValidateSessionIDPair("-Users-name-project::abcdef01", validSession); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// validate_pair_accepts_dotdot_dirname
func TestValidatePairAcceptsDotDotDirname(t *testing.T) {
	if err := ValidateSessionIDPair("-..", validSession); err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
}

// resolve_subagent_rejects_traversal_subagent_id
func TestResolveSubagentRejectsTraversalSubagentID(t *testing.T) {
	_, err := ResolveSubagentPath("/tmp/claude/projects", validProject, validSession, "../../../etc/passwd")
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSubagentID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSubagentID, err)
	}
}

// resolve_subagent_rejects_traversal_parent
func TestResolveSubagentRejectsTraversalParent(t *testing.T) {
	_, err := ResolveSubagentPath("/tmp/claude/projects", validProject, "../../../etc/passwd", validSession)
	if err == nil || !strings.Contains(err.Error(), ErrInvalidSessionID) {
		t.Fatalf("expected %q, got %v", ErrInvalidSessionID, err)
	}
}
