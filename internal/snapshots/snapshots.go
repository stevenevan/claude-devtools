// Package snapshots ports src-tauri/src/snapshots.rs: gzip-compressed serialized
// SessionDetail stored in ~/.claude-devtools/snapshots/ as <id>.json.gz, with
// metadata alongside as <id>.meta.json for listing without decompressing.
//
// The on-disk format is FROZEN for cross-version compatibility: payload =
// gzip(json(detail)); meta = pretty json(SnapshotMeta).
package snapshots

import (
	"bytes"
	"compress/gzip"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"

	"github.com/google/uuid"

	"claude-devtools/internal/domain"
)

// SnapshotMeta mirrors snapshots.rs SnapshotMeta (serde camelCase).
type SnapshotMeta struct {
	ID              string  `json:"id"`
	Label           string  `json:"label"`
	SourceSessionID string  `json:"sourceSessionId"`
	SourceProjectID string  `json:"sourceProjectId"`
	CreatedAt       float64 `json:"createdAt"`
	MessageCount    uint32  `json:"messageCount"`
	ChunkCount      uint32  `json:"chunkCount"`
	// SizeBytes is the compressed payload size on disk.
	SizeBytes uint64 `json:"sizeBytes"`
}

func snapshotsDir() (string, error) {
	var dir string
	if override := os.Getenv("CLAUDE_DEVTOOLS_SNAPSHOTS_DIR"); override != "" {
		dir = override
	} else {
		home, err := os.UserHomeDir()
		if err != nil {
			return "", fmt.Errorf("cannot resolve home directory")
		}
		dir = filepath.Join(home, ".claude-devtools", "snapshots")
	}
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", fmt.Errorf("cannot create snapshots dir: %w", err)
	}
	return dir, nil
}

func payloadPath(dir, id string) string { return filepath.Join(dir, id+".json.gz") }
func metaPath(dir, id string) string    { return filepath.Join(dir, id+".meta.json") }

func nowMS() float64 {
	return float64(time.Now().UnixNano()) / 1e6
}

// CreateSnapshot gzips the SessionDetail and writes payload + meta.
func CreateSnapshot(label string, detail domain.SessionDetail) (SnapshotMeta, error) {
	dir, err := snapshotsDir()
	if err != nil {
		return SnapshotMeta{}, err
	}
	id := uuid.NewString()

	jsonBytes, err := json.Marshal(detail)
	if err != nil {
		return SnapshotMeta{}, fmt.Errorf("serialize failed: %w", err)
	}
	var buf bytes.Buffer
	enc := gzip.NewWriter(&buf)
	if _, err := enc.Write(jsonBytes); err != nil {
		return SnapshotMeta{}, fmt.Errorf("compress failed: %w", err)
	}
	if err := enc.Close(); err != nil {
		return SnapshotMeta{}, fmt.Errorf("finish failed: %w", err)
	}
	compressed := buf.Bytes()

	if err := os.WriteFile(payloadPath(dir, id), compressed, 0o644); err != nil {
		return SnapshotMeta{}, fmt.Errorf("write payload failed: %w", err)
	}

	meta := SnapshotMeta{
		ID:              id,
		Label:           label,
		SourceSessionID: detail.Session.ID,
		SourceProjectID: detail.Session.ProjectID,
		CreatedAt:       nowMS(),
		MessageCount:    uint32(len(detail.Messages)),
		ChunkCount:      uint32(len(detail.Chunks)),
		SizeBytes:       uint64(len(compressed)),
	}
	metaJSON, err := json.MarshalIndent(meta, "", "  ")
	if err != nil {
		return SnapshotMeta{}, fmt.Errorf("meta serialize: %w", err)
	}
	if err := os.WriteFile(metaPath(dir, id), metaJSON, 0o644); err != nil {
		return SnapshotMeta{}, fmt.Errorf("write meta failed: %w", err)
	}
	return meta, nil
}

// ListSnapshots reads every <id>.meta.json, newest first.
func ListSnapshots() ([]SnapshotMeta, error) {
	dir, err := snapshotsDir()
	if err != nil {
		return nil, err
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("read dir failed: %w", err)
	}
	out := []SnapshotMeta{}
	for _, e := range entries {
		if !strings.HasSuffix(e.Name(), ".meta.json") {
			continue
		}
		bytesRead, err := os.ReadFile(filepath.Join(dir, e.Name()))
		if err != nil {
			continue
		}
		var meta SnapshotMeta
		if json.Unmarshal(bytesRead, &meta) == nil {
			out = append(out, meta)
		}
	}
	sort.SliceStable(out, func(i, j int) bool { return out[i].CreatedAt > out[j].CreatedAt })
	return out, nil
}

// DeleteSnapshot removes payload + meta (missing files are ignored).
func DeleteSnapshot(id string) error {
	dir, err := snapshotsDir()
	if err != nil {
		return err
	}
	_ = os.Remove(payloadPath(dir, id))
	_ = os.Remove(metaPath(dir, id))
	return nil
}

// OpenSnapshot decompresses a snapshot payload back into a SessionDetail.
func OpenSnapshot(id string) (domain.SessionDetail, error) {
	dir, err := snapshotsDir()
	if err != nil {
		return domain.SessionDetail{}, err
	}
	raw, err := os.ReadFile(payloadPath(dir, id))
	if err != nil {
		return domain.SessionDetail{}, fmt.Errorf("read snapshot %s failed: %w", id, err)
	}
	dec, err := gzip.NewReader(bytes.NewReader(raw))
	if err != nil {
		return domain.SessionDetail{}, fmt.Errorf("decompress failed: %w", err)
	}
	defer dec.Close()
	var detail domain.SessionDetail
	if err := json.NewDecoder(dec).Decode(&detail); err != nil {
		return domain.SessionDetail{}, fmt.Errorf("deserialize failed: %w", err)
	}
	return detail, nil
}
