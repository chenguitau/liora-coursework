package server

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"os"
	"path/filepath"
	"testing"
	"time"

	"liora/db"
)

func writeEvidenceBlob(t *testing.T, root, hash string, body []byte) {
	t.Helper()
	dir := filepath.Join(root, "blobs", hash[:2])
	if err := os.MkdirAll(dir, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, hash+".bin"), body, 0o600); err != nil {
		t.Fatal(err)
	}
}

// evidence.Store.restoreMu is the only thing that keeps the hourly GC pass from
// reaping bodies an archive restore has installed but not yet referenced from
// metadata. That only works if every caller shares one Store; evidenceStore used
// to build a fresh one per call, so the restore and the GC pass each held their own
// mutex and could never exclude each other.
func TestEvidenceStoreIsSharedSoRestoreExcludesGC(t *testing.T) {
	s, _ := newPagingTestServer(t)
	if s.evidenceStore() != s.evidenceStore() {
		t.Fatal("evidenceStore must return one shared instance; a per-call store gives every caller its own restore mutex")
	}

	body := []byte("evidence body")
	sum := sha256.Sum256(body)
	hash := hex.EncodeToString(sum[:])
	src := filepath.Join(t.TempDir(), "package")
	writeEvidenceBlob(t, src, hash, body)
	snap := db.TrafficEvidenceSnapshot{
		SourceTrafficID: "traffic-1", CapturedAt: 1, URL: "http://evidence.local/", Method: "GET", Status: 200,
		ReqHash: hash, ReqLen: int64(len(body)), RespHash: hash, RespLen: int64(len(body)),
	}
	snap.ID = db.TrafficSnapshotID(snap)

	entered := make(chan struct{})
	release := make(chan struct{})
	restoreDone := make(chan error, 1)
	go func() {
		restoreDone <- s.evidenceStore().WithInstalledSnapshots(context.Background(),
			[]db.TrafficEvidenceSnapshot{snap}, src, func() error {
				close(entered)
				<-release
				return nil
			})
	}()
	<-entered
	gcCtx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	err := s.evidenceStore().Collect(gcCtx, time.Now().Add(48*time.Hour))
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("evidence GC ran while an archive restore held the restore lock: err=%v", err)
	}
	close(release)
	if err := <-restoreDone; err != nil {
		t.Fatal(err)
	}
}
