package config

import (
	"strings"
	"testing"
)

func TestDefaultTriggersCount(t *testing.T) {
	triggers := DefaultTriggers()
	if len(triggers) != 3 {
		t.Fatalf("expected 3 default triggers, got %d", len(triggers))
	}
}

func TestMergeAddsMissingBuiltins(t *testing.T) {
	loaded := []NotificationTrigger{} // nothing loaded
	defaults := DefaultTriggers()
	merged := MergeTriggers(loaded, defaults)
	if len(merged) != 3 {
		t.Fatalf("expected 3 merged triggers, got %d", len(merged))
	}
}

func TestMergePreservesUserTriggers(t *testing.T) {
	loaded := DefaultTriggers()
	loaded = append(loaded, NotificationTrigger{
		ID:          "user-custom",
		Name:        "Custom",
		Enabled:     true,
		ContentType: "text",
		Mode:        "content_match",
	})
	defaults := DefaultTriggers()
	merged := MergeTriggers(loaded, defaults)
	if len(merged) != 4 {
		t.Fatalf("expected 4 triggers, got %d", len(merged))
	}
	found := false
	for _, m := range merged {
		if m.ID == "user-custom" {
			found = true
		}
	}
	if !found {
		t.Fatal("user-custom trigger was lost after merge")
	}
}

func TestMergeRemovesDeprecatedBuiltins(t *testing.T) {
	isBuiltin := true
	loaded := []NotificationTrigger{
		{
			ID:          "builtin-deprecated",
			Name:        "Old",
			Enabled:     false,
			ContentType: "text",
			Mode:        "error_status",
			IsBuiltin:   &isBuiltin,
		},
	}
	defaults := DefaultTriggers()
	merged := MergeTriggers(loaded, defaults)
	for _, m := range merged {
		if m.ID == "builtin-deprecated" {
			t.Fatal("deprecated builtin should have been removed")
		}
	}
	if len(merged) != 3 {
		t.Fatalf("expected 3 triggers (defaults only), got %d", len(merged))
	}
}

func TestValidateTriggerValid(t *testing.T) {
	defaults := DefaultTriggers()
	errs := ValidateTrigger(&defaults[0])
	if len(errs) != 0 {
		t.Fatalf("expected valid trigger, got errors: %v", errs)
	}
}

func TestValidateTriggerMissingID(t *testing.T) {
	defaults := DefaultTriggers()
	trigger := defaults[0]
	trigger.ID = ""
	errs := ValidateTrigger(&trigger)
	if len(errs) == 0 {
		t.Fatal("expected errors for empty ID")
	}
	if !strings.Contains(errs[0], "ID") {
		t.Fatalf("expected ID error, got: %s", errs[0])
	}
}

func TestValidateRegexPatternValid(t *testing.T) {
	if err := ValidateRegexPattern(`\.env`); err != "" {
		t.Fatalf("expected valid pattern, got: %s", err)
	}
}

func TestValidateRegexPatternInvalid(t *testing.T) {
	if err := ValidateRegexPattern(`(unclosed`); err == "" {
		t.Fatal("expected error for invalid regex")
	}
}

func TestValidateRegexPatternTooLong(t *testing.T) {
	long := strings.Repeat("a", 101)
	if err := ValidateRegexPattern(long); err == "" {
		t.Fatal("expected error for overlong pattern")
	}
}

func TestInferMode(t *testing.T) {
	b := true
	t1 := NotificationTrigger{RequireError: &b}
	if InferMode(&t1) != "error_status" {
		t.Fatalf("expected error_status, got %s", InferMode(&t1))
	}

	pattern := "test"
	t2 := NotificationTrigger{MatchPattern: &pattern}
	if InferMode(&t2) != "content_match" {
		t.Fatalf("expected content_match, got %s", InferMode(&t2))
	}

	threshold := 100.0
	t3 := NotificationTrigger{TokenThreshold: &threshold}
	if InferMode(&t3) != "token_threshold" {
		t.Fatalf("expected token_threshold, got %s", InferMode(&t3))
	}
}
