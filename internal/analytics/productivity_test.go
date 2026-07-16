package analytics

import "testing"

func TestPercentileU64EmptyZero(t *testing.T) {
	if got := PercentileU64([]uint64{}, 0.5); got != 0 {
		t.Errorf("got %d, want 0", got)
	}
}

func TestPercentileU64Median(t *testing.T) {
	data := []uint64{1, 2, 3, 4, 5}
	if got := PercentileU64(data, 0.5); got != 3 {
		t.Errorf("got %d, want 3", got)
	}
}

func TestPercentileU64P95SmallSampleRounds(t *testing.T) {
	data := []uint64{10, 20, 30, 40, 50}
	if got := PercentileU64(data, 0.95); got != 50 {
		t.Errorf("got %d, want 50", got)
	}
}

func TestPercentileU64ClampsUpper(t *testing.T) {
	data := []uint64{7}
	if got := PercentileU64(data, 0.99); got != 7 {
		t.Errorf("got %d, want 7", got)
	}
}
