package maintenance

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"time"

	"github.com/google/uuid"
)

// maxHistoryLine caps one history.jsonl line; an oversized line aborts the
// prune (never a silently-truncated rewrite) via scanner.Err().
const maxHistoryLine = 16 << 20

// HistoryMonth is one bucket of the history histogram.
type HistoryMonth struct {
	Month string `json:"month"` // "2006-01"
	Lines int    `json:"lines"`
	Bytes int64  `json:"bytes"`
}

// HistoryStats summarizes <root>/history.jsonl for the W10 panel.
type HistoryStats struct {
	TotalLines    int            `json:"totalLines"`
	Bytes         int64          `json:"bytes"`
	Malformed     int            `json:"malformed"`
	OldestMs      float64        `json:"oldestMs"`
	NewestMs      float64        `json:"newestMs"`
	Months        []HistoryMonth `json:"months"`
	PrunableLines int            `json:"prunableLines"`
	PrunableBytes int64          `json:"prunableBytes"`
}

// AnalyzeHistory streams history.jsonl and reports a monthly histogram plus how
// much is prunable against the cutoff. Malformed lines are counted, never fatal.
// A missing file is an empty (non-error) result.
func AnalyzeHistory(root string, cutoff time.Time) (HistoryStats, error) {
	path := filepath.Join(root, "history.jsonl")
	if err := refuseSymlinkFile(path); err != nil {
		return HistoryStats{}, err
	}
	f, err := os.Open(path)
	if os.IsNotExist(err) {
		return HistoryStats{}, nil
	}
	if err != nil {
		return HistoryStats{}, err
	}
	defer f.Close()

	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), maxHistoryLine)
	months := map[string]*HistoryMonth{}
	stats := HistoryStats{}
	for sc.Scan() {
		n := int64(len(sc.Bytes())) + 1
		stats.TotalLines++
		stats.Bytes += n
		ts, ok := historyLineTime(sc.Bytes())
		if !ok {
			stats.Malformed++
			continue
		}
		ms := float64(ts.UnixMilli())
		if stats.OldestMs == 0 || ms < stats.OldestMs {
			stats.OldestMs = ms
		}
		if ms > stats.NewestMs {
			stats.NewestMs = ms
		}
		key := ts.Format("2006-01")
		m := months[key]
		if m == nil {
			m = &HistoryMonth{Month: key}
			months[key] = m
		}
		m.Lines++
		m.Bytes += n
		if ts.Before(cutoff) {
			stats.PrunableLines++
			stats.PrunableBytes += n
		}
	}
	if err := sc.Err(); err != nil {
		return HistoryStats{}, fmt.Errorf("maintenance: scan history: %w", err)
	}

	keys := make([]string, 0, len(months))
	for k := range months {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	for _, k := range keys {
		stats.Months = append(stats.Months, *months[k])
	}
	return stats, nil
}

// PruneHistory splits history.jsonl at the cutoff, trashes the old tail (as
// valid JSONL, analyzable for week 30), and atomically replaces the file with
// the retained head. A line whose timestamp can't be parsed is ALWAYS retained
// in the head — a corrupt/crafted file must never trash freshly-typed prompts.
// A concurrent append between the pre-read snapshot and the write aborts (the
// prune is lost, never the data) and retries once.
func PruneHistory(roots []string, appDataDir, historyPath string, cutoff time.Time) (TrashReceipt, error) {
	if err := refuseSymlinkFile(historyPath); err != nil {
		return TrashReceipt{}, err
	}
	canonAppData, err := resolveAppDataDir(appDataDir, true)
	if err != nil {
		return TrashReceipt{}, err
	}

	for attempt := 0; attempt < 2; attempt++ {
		snap, err := statSnapshot(historyPath)
		if err != nil {
			return TrashReceipt{}, err
		}
		head, tail, err := splitHistory(historyPath, cutoff)
		if err != nil {
			return TrashReceipt{}, err
		}
		if len(tail) == 0 {
			return TrashReceipt{}, fmt.Errorf("maintenance: nothing older than the cutoff to prune")
		}

		tailPath := filepath.Join(canonAppData, "history-tail-"+uuid.NewString()+".jsonl")
		if err := writeLines(tailPath, tail); err != nil {
			return TrashReceipt{}, err
		}
		headTmp := historyPath + ".tmp"
		if err := writeLines(headTmp, head); err != nil {
			_ = os.Remove(tailPath)
			_ = os.Remove(headTmp)
			return TrashReceipt{}, err
		}

		// Final conflict check immediately before the destructive steps.
		if cur, err := statSnapshot(historyPath); err != nil || cur != snap {
			_ = os.Remove(tailPath)
			_ = os.Remove(headTmp)
			continue // CLI appended mid-prune — discard and retry once
		}

		// Trash the tail FIRST (so a rename failure can't lose it), then rename.
		receipt, err := TrashItems(roots, appDataDir, []string{tailPath})
		if err != nil {
			_ = os.Remove(tailPath)
			_ = os.Remove(headTmp)
			return TrashReceipt{}, fmt.Errorf("maintenance: preserve history tail: %w", err)
		}
		if err := os.Rename(headTmp, historyPath); err != nil {
			_ = os.Remove(headTmp)
			return receipt, fmt.Errorf("maintenance: replace history.jsonl: %w", err)
		}
		return receipt, nil
	}
	return TrashReceipt{}, fmt.Errorf("maintenance: history.jsonl kept changing; prune aborted (no data lost)")
}

// splitHistory reads historyPath fresh and partitions lines into head
// (retained: newer-than-cutoff OR unparseable timestamp) and tail (pruned:
// parseable AND older than cutoff). Bytes are preserved per line.
func splitHistory(historyPath string, cutoff time.Time) (head, tail [][]byte, err error) {
	f, err := os.Open(historyPath)
	if err != nil {
		return nil, nil, err
	}
	defer f.Close()
	sc := bufio.NewScanner(f)
	sc.Buffer(make([]byte, 0, 64*1024), maxHistoryLine)
	for sc.Scan() {
		line := append([]byte(nil), sc.Bytes()...) // copy — scanner reuses its buffer
		ts, ok := historyLineTime(line)
		if ok && ts.Before(cutoff) {
			tail = append(tail, line)
		} else {
			head = append(head, line) // H2: unparseable stays in the head
		}
	}
	if err := sc.Err(); err != nil {
		return nil, nil, fmt.Errorf("maintenance: scan history: %w", err)
	}
	return head, tail, nil
}

// historyLineTime extracts the epoch-ms timestamp from one history.jsonl line.
func historyLineTime(line []byte) (time.Time, bool) {
	var entry struct {
		Timestamp float64 `json:"timestamp"`
	}
	if json.Unmarshal(line, &entry) != nil || entry.Timestamp <= 0 {
		return time.Time{}, false
	}
	return time.UnixMilli(int64(entry.Timestamp)), true
}

// writeLines writes each line + "\n" to path at 0600 (prompt history / secrets).
func writeLines(path string, lines [][]byte) error {
	f, err := os.OpenFile(path, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
	if err != nil {
		return err
	}
	w := bufio.NewWriter(f)
	for _, line := range lines {
		if _, err := w.Write(line); err != nil {
			f.Close()
			return err
		}
		if err := w.WriteByte('\n'); err != nil {
			f.Close()
			return err
		}
	}
	if err := w.Flush(); err != nil {
		f.Close()
		return err
	}
	if err := f.Sync(); err != nil {
		f.Close()
		return err
	}
	return f.Close()
}

type historySnapshot struct {
	size    int64
	modNano int64
}

func statSnapshot(path string) (historySnapshot, error) {
	info, err := os.Stat(path)
	if err != nil {
		return historySnapshot{}, err
	}
	return historySnapshot{size: info.Size(), modNano: info.ModTime().UnixNano()}, nil
}

// refuseSymlinkFile errors if path is a symlink (never read/rewrite through a
// planted symlink pointing outside the root).
func refuseSymlinkFile(path string) error {
	info, err := os.Lstat(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil
		}
		return err
	}
	if info.Mode()&os.ModeSymlink != 0 {
		return fmt.Errorf("maintenance: %q is a symlink; refusing", path)
	}
	return nil
}
