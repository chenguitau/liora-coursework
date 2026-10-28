package server

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// TestDeleteAssetsRejectsOversizedBatch pins the per-request cap: over the limit
// is a 400 before touching the DB, while exactly the limit is still accepted.
func TestDeleteAssetsRejectsOversizedBatch(t *testing.T) {
	m, err := NewManager(t.TempDir(), "")
	if err != nil {
		t.Skipf("database unavailable (%v) — skipping", err)
	}
	defer m.Close()
	s := &Server{m: m}

	// Negative ids cannot collide with real assets in the shared test database.
	ids := make([]int64, maxAssetDeleteIDs+1)
	for i := range ids {
		ids[i] = -int64(i + 1)
	}

	post := func(ids []int64) *httptest.ResponseRecorder {
		body, err := json.Marshal(map[string]any{"ids": ids})
		if err != nil {
			t.Fatal(err)
		}
		req := httptest.NewRequest(http.MethodDelete, "/api/assets", bytes.NewReader(body))
		rec := httptest.NewRecorder()
		s.deleteAssets(rec, req)
		return rec
	}

	rec := post(ids)
	if rec.Code != http.StatusBadRequest {
		t.Fatalf("over-limit batch status=%d body=%s", rec.Code, rec.Body.String())
	}
	if !strings.Contains(rec.Body.String(), "5000") {
		t.Fatalf("over-limit message should name the cap: %s", rec.Body.String())
	}

	rec = post(ids[:maxAssetDeleteIDs])
	if rec.Code != http.StatusOK {
		t.Fatalf("at-limit batch status=%d body=%s", rec.Code, rec.Body.String())
	}
}
