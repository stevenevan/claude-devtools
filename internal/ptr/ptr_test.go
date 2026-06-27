package ptr

import "testing"

func TestDerefNilReturnsZero(t *testing.T) {
	if got := Deref[string](nil); got != "" {
		t.Fatalf("Deref(nil string) = %q, want empty", got)
	}
	if got := Deref[uint64](nil); got != 0 {
		t.Fatalf("Deref(nil uint64) = %d, want 0", got)
	}
}

func TestToAndDerefRoundTrip(t *testing.T) {
	if *To("x") != "x" {
		t.Fatal("To/deref string round-trip failed")
	}
	if got := Deref(To(true)); got != true {
		t.Fatal("Deref(To(true)) != true")
	}
}
