package server

import (
	"encoding/json"
	"testing"
)

func TestHealthReportsDatabaseStatus(t *testing.T) {
	s, _, request := reportFixture(t)
	rec := request("/api/health")
	if rec.Code != 200 {
		t.Fatalf("status=%d body=%s", rec.Code, rec.Body.String())
	}
	var body map[string]any
	if err := json.Unmarshal(rec.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["database"] != "ok" {
		t.Fatalf("database=%v, want ok", body["database"])
	}

	if err := s.m.pg.Close(); err != nil {
		t.Fatal(err)
	}
	closed := request("/api/health")
	if closed.Code != 200 {
		t.Fatalf("closed-db status=%d, want 200", closed.Code)
	}
	if err := json.Unmarshal(closed.Body.Bytes(), &body); err != nil {
		t.Fatal(err)
	}
	if body["database"] != "error" {
		t.Fatalf("database=%v, want error", body["database"])
	}
}
