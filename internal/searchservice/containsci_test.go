package searchservice

import "testing"

func TestContainsCI(t *testing.T) {
	cases := []struct {
		s, subLower string
		want        bool
	}{
		{"Hello World", "hello", true},
		{"Hello World", "WORLD", false}, // subLower must already be lowercased
		{"Hello World", "world", true},
		{"abc", "xyz", false},
		{"abc", "", true},
	}
	for _, c := range cases {
		if got := containsCI(c.s, c.subLower); got != c.want {
			t.Errorf("containsCI(%q, %q) = %v, want %v", c.s, c.subLower, got, c.want)
		}
	}
}
