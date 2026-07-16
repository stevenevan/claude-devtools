// Package ssh.
// All fields carry explicit json tags matching serde rename_all="camelCase".
// Option<T> with skip_serializing_if="Option::is_none" → *T + omitempty.
// Option<T> without skip → *T (no omitempty).
package ssh

// ConnectionConfig mirrors SshConnectionConfig.
type ConnectionConfig struct {
	Host           string  `json:"host"`
	Port           uint16  `json:"port"`
	Username       string  `json:"username"`
	AuthMethod     string  `json:"authMethod"`
	Password       *string `json:"password,omitempty"`
	PrivateKeyPath *string `json:"privateKeyPath,omitempty"`
}

// ConnectionStatus mirrors SshConnectionStatus.
// retry_attempt/max_retries have skip_serializing_if → omitempty.
// host/error/remote_projects_path have no skip → no omitempty.
type ConnectionStatus struct {
	State              string  `json:"state"`
	Host               *string `json:"host"`
	Error              *string `json:"error"`
	RemoteProjectsPath *string `json:"remoteProjectsPath"`
	RetryAttempt       *uint32 `json:"retryAttempt,omitempty"`
	MaxRetries         *uint32 `json:"maxRetries,omitempty"`
}

// Disconnected returns the zero-state ConnectionStatus (mirrors SshConnectionStatus::disconnected).
func Disconnected() ConnectionStatus {
	return ConnectionStatus{State: "disconnected"}
}

// ConfigHostEntry mirrors SshConfigHostEntry.
// host_name/user/port have skip_serializing_if → omitempty.
type ConfigHostEntry struct {
	Alias          string  `json:"alias"`
	HostName       *string `json:"hostName,omitempty"`
	User           *string `json:"user,omitempty"`
	Port           *uint16 `json:"port,omitempty"`
	HasIdentityFile bool   `json:"hasIdentityFile"`
}

// LastConnection mirrors SshLastConnection.
// private_key_path has skip_serializing_if → omitempty.
type LastConnection struct {
	Host           string  `json:"host"`
	Port           uint16  `json:"port"`
	Username       string  `json:"username"`
	AuthMethod     string  `json:"authMethod"`
	PrivateKeyPath *string `json:"privateKeyPath,omitempty"`
}
