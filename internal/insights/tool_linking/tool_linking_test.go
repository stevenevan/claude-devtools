package tool_linking

import (
	"encoding/json"
	"testing"

	"claude-devtools/internal/domain"
)

func makeStep(id, stepType string, toolName *string) domain.SemanticStep {
	content := domain.SemanticStepContent{
		ToolName:  toolName,
		ToolInput: json.RawMessage(`{}`),
	}
	if stepType == "tool_result" {
		s := "result text"
		content.ToolResultContent = &s
		n := uint64(10)
		content.TokenCount = &n
	}
	return domain.SemanticStep{
		ID:         id,
		StepType:   stepType,
		StartTime:  "2026-01-01T00:00:00Z",
		DurationMs: 1000.0,
		Content:    content,
		Context:    "main",
	}
}

func strPtr(s string) *string { return &s }

func TestEmptyStepsReturnsEmpty(t *testing.T) {
	result := LinkToolCallsToResults(nil, nil)
	if len(result) != 0 {
		t.Errorf("expected empty map, got %d entries", len(result))
	}
}

func TestLinksCallToResult(t *testing.T) {
	steps := []domain.SemanticStep{
		makeStep("tc-1", "tool_call", strPtr("Read")),
		makeStep("tc-1", "tool_result", strPtr("Read")),
	}
	result := LinkToolCallsToResults(steps, nil)
	if len(result) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(result))
	}
	item := result["tc-1"]
	if item.Name != "Read" {
		t.Errorf("name: got %q want Read", item.Name)
	}
	if item.IsOrphaned {
		t.Error("should not be orphaned")
	}
	if item.Result == nil {
		t.Error("result should be set")
	}
}

func TestOrphanedCallWithoutResult(t *testing.T) {
	steps := []domain.SemanticStep{makeStep("tc-2", "tool_call", strPtr("Write"))}
	result := LinkToolCallsToResults(steps, nil)
	if len(result) != 1 {
		t.Fatalf("expected 1 entry, got %d", len(result))
	}
	item := result["tc-2"]
	if !item.IsOrphaned {
		t.Error("should be orphaned")
	}
	if item.Result != nil {
		t.Error("result should be nil")
	}
}

func TestMultipleCallsLinkedCorrectly(t *testing.T) {
	steps := []domain.SemanticStep{
		makeStep("a", "tool_call", strPtr("Read")),
		makeStep("b", "tool_call", strPtr("Write")),
		makeStep("a", "tool_result", strPtr("Read")),
		makeStep("b", "tool_result", strPtr("Write")),
	}
	result := LinkToolCallsToResults(steps, nil)
	if len(result) != 2 {
		t.Fatalf("expected 2 entries, got %d", len(result))
	}
	if result["a"].IsOrphaned {
		t.Error("a should not be orphaned")
	}
	if result["b"].IsOrphaned {
		t.Error("b should not be orphaned")
	}
}

func TestExtractsSkillInstructions(t *testing.T) {
	steps := []domain.SemanticStep{
		makeStep("skill-1", "tool_call", strPtr("Skill")),
		makeStep("skill-1", "tool_result", strPtr("Skill")),
	}
	sid := "skill-1"
	responses := []ParsedMessageInput{{
		MsgType:         "user",
		IsMeta:          true,
		SourceToolUseID: &sid,
		Content: json.RawMessage(`[{"type":"text","text":"Base directory for this skill: /Users/test/project"}]`),
	}}
	result := LinkToolCallsToResults(steps, responses)
	item := result["skill-1"]
	if item.SkillInstructions == nil {
		t.Error("skill_instructions should be set")
	}
	if item.SkillInstructionsTokenCount == nil {
		t.Error("skill_instructions_token_count should be set")
	}
}

func TestCallTokensComputedFromNameAndInput(t *testing.T) {
	steps := []domain.SemanticStep{makeStep("tc-3", "tool_call", strPtr("Read"))}
	result := LinkToolCallsToResults(steps, nil)
	item := result["tc-3"]
	if item.CallTokens == nil || *item.CallTokens == 0 {
		t.Error("call_tokens should be > 0")
	}
}

func TestErrorResultDetected(t *testing.T) {
	steps := []domain.SemanticStep{
		makeStep("err-1", "tool_call", strPtr("Bash")),
		makeStep("err-1", "tool_result", strPtr("Bash")),
	}
	isErr := true
	steps[1].Content.IsError = &isErr
	result := LinkToolCallsToResults(steps, nil)
	item := result["err-1"]
	if item.Result == nil || !item.Result.IsError {
		t.Error("is_error should be true")
	}
}

func TestStrayToolResultWithoutMatchingCallIsIgnored(t *testing.T) {
	steps := []domain.SemanticStep{makeStep("stray-1", "tool_result", strPtr("Read"))}
	result := LinkToolCallsToResults(steps, nil)
	if len(result) != 0 {
		t.Errorf("stray tool_result must not create entry, got %d", len(result))
	}
}

func TestSkillCallWithoutInstructionsResponseHasNone(t *testing.T) {
	steps := []domain.SemanticStep{
		makeStep("skill-noinstr", "tool_call", strPtr("Skill")),
		makeStep("skill-noinstr", "tool_result", strPtr("Skill")),
	}
	sid := "skill-noinstr"
	responses := []ParsedMessageInput{{
		MsgType:         "user",
		IsMeta:          true,
		SourceToolUseID: &sid,
		Content:         json.RawMessage(`[{"type":"text","text":"Just a regular output, no skill instructions."}]`),
	}}
	result := LinkToolCallsToResults(steps, responses)
	item := result["skill-noinstr"]
	if item.SkillInstructions != nil {
		t.Errorf("skill_instructions should be nil, got %q", *item.SkillInstructions)
	}
	if item.SkillInstructionsTokenCount != nil {
		t.Error("skill_instructions_token_count should be nil")
	}
}

func TestErrorResultDefaultsToFalseWhenUnset(t *testing.T) {
	steps := []domain.SemanticStep{
		makeStep("ok-1", "tool_call", strPtr("Read")),
		makeStep("ok-1", "tool_result", strPtr("Read")),
	}
	// is_error left as nil (default from makeStep).
	result := LinkToolCallsToResults(steps, nil)
	item := result["ok-1"]
	if item.Result == nil {
		t.Fatal("result should be set")
	}
	if item.Result.IsError {
		t.Error("absent is_error must default to false")
	}
}

func TestSkillInstructionsTokenCountProportionalToLength(t *testing.T) {
	shortText := "Base directory for this skill: /a"
	longLines := ""
	for i := 0; i < 40; i++ {
		longLines += "padding-line-content-padding-line-content-padding-line-content\n"
	}
	longText := "Base directory for this skill: /b\n" + longLines

	steps := []domain.SemanticStep{
		makeStep("skill-short", "tool_call", strPtr("Skill")),
		makeStep("skill-short", "tool_result", strPtr("Skill")),
		makeStep("skill-long", "tool_call", strPtr("Skill")),
		makeStep("skill-long", "tool_result", strPtr("Skill")),
	}
	shortID, longID := "skill-short", "skill-long"
	responses := []ParsedMessageInput{
		{
			MsgType:         "user",
			IsMeta:          true,
			SourceToolUseID: &shortID,
			Content:         mustMarshalArray(shortText),
		},
		{
			MsgType:         "user",
			IsMeta:          true,
			SourceToolUseID: &longID,
			Content:         mustMarshalArray(longText),
		},
	}
	result := LinkToolCallsToResults(steps, responses)
	shortItem := result["skill-short"]
	longItem := result["skill-long"]
	if shortItem.SkillInstructionsTokenCount == nil || longItem.SkillInstructionsTokenCount == nil {
		t.Fatal("both token counts should be set")
	}
	if *longItem.SkillInstructionsTokenCount <= *shortItem.SkillInstructionsTokenCount {
		t.Errorf("long (%d) must produce more tokens than short (%d)",
			*longItem.SkillInstructionsTokenCount,
			*shortItem.SkillInstructionsTokenCount)
	}
}

func mustMarshalArray(text string) json.RawMessage {
	b, err := json.Marshal([]map[string]string{{"type": "text", "text": text}})
	if err != nil {
		panic(err)
	}
	return b
}
