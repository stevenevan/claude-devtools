// error_detector.go.
// Orchestrates trigger matching across a session's parsed messages.
package notifications

import (
	"claude-devtools/internal/config"
	"claude-devtools/internal/domain"
)

// matchesRepositoryScope checks whether a project ID is covered by the trigger's
// repositoryIds scope. Nil/empty scope means "all repositories".
// Mirrors error_detector.rs::matches_repository_scope.
func matchesRepositoryScope(projectID string, repositoryIDs *[]string) bool {
	if repositoryIDs == nil || len(*repositoryIDs) == 0 {
		return true
	}
	for _, id := range *repositoryIDs {
		if id == projectID {
			return true
		}
	}
	return false
}

// checkTrigger routes one trigger against one message to the appropriate checker.
// Mirrors error_detector.rs::check_trigger.
func checkTrigger(
	msg *domain.ParsedMessage,
	trigger *config.NotificationTrigger,
	toolUseMap map[string]ToolUseInfo,
	toolResultMap map[string]ToolResultInfo,
	sessionID, projectID, filePath string,
	lineNumber uint32,
) []DetectedError {
	if !matchesRepositoryScope(projectID, trigger.RepositoryIDs) {
		return nil
	}

	if trigger.Mode == "token_threshold" {
		return CheckTokenThresholdTrigger(msg, trigger, toolResultMap, sessionID, projectID, filePath, lineNumber)
	}

	if trigger.ContentType == "tool_result" {
		if e := CheckToolResultTrigger(msg, trigger, toolUseMap, sessionID, projectID, filePath, lineNumber); e != nil {
			return []DetectedError{*e}
		}
		return nil
	}

	if trigger.ContentType == "tool_use" {
		if e := CheckToolUseTrigger(msg, trigger, sessionID, projectID, filePath, lineNumber); e != nil {
			return []DetectedError{*e}
		}
		return nil
	}

	return nil
}

// DetectErrors runs all triggers against every message in the session.
// Mirrors error_detector.rs::detect_errors.
func DetectErrors(
	messages []domain.ParsedMessage,
	sessionID, projectID, filePath string,
	triggers []config.NotificationTrigger,
) []DetectedError {
	if len(triggers) == 0 {
		return []DetectedError{}
	}

	toolUseMap := BuildToolUseMap(messages)
	toolResultMap := BuildToolResultMap(messages)
	var errors []DetectedError

	for i := range messages {
		lineNumber := uint32(i + 1)
		for j := range triggers {
			errs := checkTrigger(&messages[i], &triggers[j], toolUseMap, toolResultMap, sessionID, projectID, filePath, lineNumber)
			errors = append(errors, errs...)
		}
	}

	if errors == nil {
		return []DetectedError{}
	}
	return errors
}

// DetectErrorsWithTrigger runs a single trigger against a session's messages.
// Mirrors error_detector.rs::detect_errors_with_trigger.
func DetectErrorsWithTrigger(
	messages []domain.ParsedMessage,
	trigger *config.NotificationTrigger,
	sessionID, projectID, filePath string,
) []DetectedError {
	return DetectErrors(messages, sessionID, projectID, filePath, []config.NotificationTrigger{*trigger})
}
