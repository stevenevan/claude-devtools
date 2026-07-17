// webhook.go.
// Template expansion, SSRF allowlist, retry-with-backoff, HTTP dispatch.
// Uses stdlib net/http for the actual POST — no reqwest equivalent needed.
package notifications

import (
	"bytes"
	"fmt"
	"net"
	"net/http"
	"strings"
	"sync/atomic"
	"time"
)

// ── Types ─────────────────────────────────────────────────────────────────────

// WebhookEndpoint mirrors webhook.rs WebhookEndpoint.
type WebhookEndpoint struct {
	ID       string `json:"id"`
	Label    string `json:"label"`
	URL      string `json:"url"`
	Template string `json:"template"`
}

// WebhookContext mirrors webhook.rs WebhookContext.
type WebhookContext struct {
	SessionID string  `json:"sessionId"`
	Tool      string  `json:"tool"`
	Cost      float64 `json:"cost"`
	Summary   string  `json:"summary"`
}

// WebhookError mirrors webhook.rs WebhookError.
type WebhookError struct {
	Kind string
	Why  string
	Code int
}

func (e *WebhookError) Error() string {
	switch e.Kind {
	case "ssrf":
		return fmt.Sprintf("SSRF guard rejected: %s", e.Why)
	case "invalidUrl":
		return fmt.Sprintf("Invalid URL: %s", e.Why)
	case "httpStatus":
		return fmt.Sprintf("HTTP %d", e.Code)
	case "network":
		return fmt.Sprintf("Network: %s", e.Why)
	}
	return e.Why
}

func ssrfError(why string) *WebhookError    { return &WebhookError{Kind: "ssrf", Why: why} }
func urlError(why string) *WebhookError     { return &WebhookError{Kind: "invalidUrl", Why: why} }
func statusError(code int) *WebhookError    { return &WebhookError{Kind: "httpStatus", Code: code} }
func networkError(why string) *WebhookError { return &WebhookError{Kind: "network", Why: why} }

// AttemptOutcome mirrors webhook.rs AttemptOutcome.
type AttemptOutcome int

const (
	AttemptSuccess   AttemptOutcome = iota
	AttemptRetryable AttemptOutcome = iota
	AttemptPermanent AttemptOutcome = iota
)

// WebhookTransport abstracts the HTTP layer for testing.
// Mirrors webhook.rs WebhookTransport.
type WebhookTransport interface {
	Send(url, body string) AttemptOutcome
}

// RetryStats counts attempts (mirrors webhook.rs RetryStats).
type RetryStats struct {
	Attempts atomic.Int32
}

// ── SSRF allowlist ────────────────────────────────────────────────────────────

var allowedDiscordPathPrefixes = []string{"/api/webhooks/"}

func hostAllowed(host, path string) bool {
	h := strings.ToLower(host)
	if h == "hooks.slack.com" {
		return true
	}
	if h == "discord.com" || h == "discordapp.com" {
		for _, prefix := range allowedDiscordPathPrefixes {
			if strings.HasPrefix(path, prefix) {
				return true
			}
		}
		return false
	}
	return false
}

func ipIsPrivate(ip net.IP) bool {
	if ip4 := ip.To4(); ip4 != nil {
		return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() ||
			ip.IsLinkLocalMulticast() || ip4[0] == 0 ||
			(ip4[0] == 169 && ip4[1] == 254)
	}
	// IPv6: loopback, unspecified, or ULA (fc00::/7)
	return ip.IsLoopback() || ip.IsUnspecified() || (ip[0]&0xfe) == 0xfc
}

// parsedURL holds minimal URL decomposition.
type parsedURL struct {
	scheme string
	host   string
	path   string
}

func parseURL(rawURL string) (*parsedURL, *WebhookError) {
	idx := strings.Index(rawURL, "://")
	if idx < 0 {
		return nil, urlError("missing scheme")
	}
	scheme := rawURL[:idx]
	if scheme != "https" && scheme != "http" {
		return nil, urlError(fmt.Sprintf("scheme %s not allowed", scheme))
	}
	rest := rawURL[idx+3:]
	// Split host from path.
	pathIdx := strings.Index(rest, "/")
	var hostWithPort, path string
	if pathIdx >= 0 {
		hostWithPort = rest[:pathIdx]
		path = rest[pathIdx:]
	} else {
		hostWithPort = rest
		path = "/"
	}
	// Reject userinfo: "user@host" would let the allowlist see an approved host
	// while net/http connects to the part after '@' (SSRF bypass). No legitimate
	// webhook URL carries userinfo.
	if strings.ContainsRune(hostWithPort, '@') {
		return nil, urlError("userinfo not allowed in webhook URL")
	}
	// Strip port.
	host := hostWithPort
	if i := strings.LastIndex(hostWithPort, ":"); i >= 0 {
		// Only strip if what follows looks like a port number (no brackets = not IPv6).
		if !strings.Contains(hostWithPort, "[") {
			host = hostWithPort[:i]
		}
	}
	return &parsedURL{scheme: scheme, host: host, path: path}, nil
}

// CheckSSRF validates a URL against the SSRF allowlist.
// Mirrors webhook.rs::check_ssrf.
func CheckSSRF(url string) *WebhookError {
	p, err := parseURL(url)
	if err != nil {
		return err
	}
	if p.scheme == "http" {
		return ssrfError("http scheme blocked")
	}
	if !hostAllowed(p.host, p.path) {
		return ssrfError(fmt.Sprintf("host %s not on allowlist", p.host))
	}
	// Reject literal IP hosts.
	if ip := net.ParseIP(p.host); ip != nil && ipIsPrivate(ip) {
		return ssrfError("literal IP host")
	}
	return nil
}

// ── Template expansion ────────────────────────────────────────────────────────

// ExpandTemplate replaces known placeholders with context values.
// Mirrors webhook.rs::expand_template.
func ExpandTemplate(template string, ctx *WebhookContext) string {
	r := strings.NewReplacer(
		"{session_id}", ctx.SessionID,
		"{tool}", ctx.Tool,
		"{cost}", fmt.Sprintf("%.4f", ctx.Cost),
		"{summary}", ctx.Summary,
	)
	return r.Replace(template)
}

// ── Retry loop ────────────────────────────────────────────────────────────────

const maxAttempts = 3

var retryDelaysMS = []int64{1000, 2000, 4000}

// DispatchWithRetry runs the transport with backoff.
// sleeper is injectable for tests. Mirrors webhook.rs::dispatch_with_retry.
func DispatchWithRetry(
	transport WebhookTransport,
	url, body string,
	sleeper func(time.Duration),
	stats *RetryStats,
) *WebhookError {
	for attempt := 0; attempt < maxAttempts; attempt++ {
		stats.Attempts.Add(1)
		switch transport.Send(url, body) {
		case AttemptSuccess:
			return nil
		case AttemptPermanent:
			return statusError(0)
		case AttemptRetryable:
			if attempt+1 >= maxAttempts {
				return networkError("Exceeded max retry attempts")
			}
			delay := retryDelaysMS[attempt]
			sleeper(time.Duration(delay) * time.Millisecond)
		}
	}
	return networkError("retry exhausted")
}

// DispatchWebhook validates, expands the template, then dispatches.
// Mirrors webhook.rs::dispatch_webhook.
func DispatchWebhook(transport WebhookTransport, endpoint *WebhookEndpoint, ctx *WebhookContext) *WebhookError {
	if err := CheckSSRF(endpoint.URL); err != nil {
		return err
	}
	body := ExpandTemplate(endpoint.Template, ctx)
	stats := &RetryStats{}
	return DispatchWithRetry(transport, endpoint.URL, body, func(d time.Duration) { time.Sleep(d) }, stats)
}

// ── Default (real) HTTP transport ────────────────────────────────────────────

// HTTPTransport sends a real POST using stdlib net/http.
// This replaces Rust's LoggingTransport stub: in the Go port we have
// a concrete net/http client available.
type HTTPTransport struct {
	client *http.Client
}

// NewHTTPTransport creates a transport with a 10-second timeout. Redirects are
// NOT followed: CheckSSRF validates only the initial URL, so following a 3xx to
// an internal address would be a redirect-SSRF hole. A redirect surfaces as its
// 3xx response (→ AttemptPermanent).
func NewHTTPTransport() *HTTPTransport {
	return &HTTPTransport{
		client: &http.Client{
			Timeout: 10 * time.Second,
			CheckRedirect: func(_ *http.Request, _ []*http.Request) error {
				return http.ErrUseLastResponse
			},
		},
	}
}

func (t *HTTPTransport) Send(url, body string) AttemptOutcome {
	req, err := http.NewRequest(http.MethodPost, url, bytes.NewBufferString(body))
	if err != nil {
		return AttemptPermanent
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "claude-devtools/webhook")

	resp, err := t.client.Do(req)
	if err != nil {
		return AttemptRetryable
	}
	defer resp.Body.Close()

	if resp.StatusCode >= 200 && resp.StatusCode < 300 {
		return AttemptSuccess
	}
	if resp.StatusCode >= 500 {
		return AttemptRetryable
	}
	return AttemptPermanent
}
