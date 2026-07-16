// Package error_hotspots.
// Backs the get_error_hotspots and get_error_clusters commands.
package error_hotspots

const errorPrefixLen = 100

// RepeatedToolError mirrors the Rust RepeatedToolError struct.
type RepeatedToolError struct {
	ToolName    string   `json:"toolName"`
	ErrorPrefix string   `json:"errorPrefix"`
	Occurrences uint32   `json:"occurrences"`
	SessionCount uint32  `json:"sessionCount"`
	SessionIDs  []string `json:"sessionIds"`
	LastSeenMs  float64  `json:"lastSeenMs"`
}

// ErrorHotspotsResponse mirrors the Rust ErrorHotspotsResponse struct.
type ErrorHotspotsResponse struct {
	RepeatedErrors  []RepeatedToolError `json:"repeatedErrors"`
	ScannedSessions uint32              `json:"scannedSessions"`
}

// ErrorClusterMember mirrors the Rust ErrorClusterMember struct.
type ErrorClusterMember struct {
	SessionID   string  `json:"sessionId"`
	ToolName    string  `json:"toolName"`
	ErrorPrefix string  `json:"errorPrefix"`
	TimestampMs float64 `json:"timestampMs"`
}

// ErrorCluster mirrors the Rust ErrorCluster struct.
type ErrorCluster struct {
	ID              string               `json:"id"`
	Representative  string               `json:"representative"`
	PrimaryTool     string               `json:"primaryTool"`
	ToolNames       []string             `json:"toolNames"`
	OccurrenceCount uint32               `json:"occurrenceCount"`
	SessionCount    uint32               `json:"sessionCount"`
	LastSeenMs      float64              `json:"lastSeenMs"`
	Members         []ErrorClusterMember `json:"members"`
}

// ErrorClustersResponse mirrors the Rust ErrorClustersResponse struct.
type ErrorClustersResponse struct {
	Clusters        []ErrorCluster `json:"clusters"`
	ScannedSessions uint32         `json:"scannedSessions"`
}
