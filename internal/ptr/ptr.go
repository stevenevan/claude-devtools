// Package ptr provides generic pointer helpers, replacing the per-package
// strPtr/boolPtr/ptrStr/derefStr/... duplicates that accumulated across internal/.
package ptr

// To returns a pointer to v.
func To[T any](v T) *T { return &v }

// Deref returns the value p points at, or the zero value of T when p is nil.
// The nil guard is load-bearing: callers deref *string fields parsed from
// untrusted JSONL/SSH logs where fields are routinely absent.
func Deref[T any](p *T) T {
	if p == nil {
		var zero T
		return zero
	}
	return *p
}
