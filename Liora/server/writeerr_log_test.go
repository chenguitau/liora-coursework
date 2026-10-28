package server

import (
	"bytes"
	"log"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestWriteErrLogsServerErrors(t *testing.T) {
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })

	rec := httptest.NewRecorder()
	writeErr(rec, http.StatusInternalServerError, "读取发现失败: database is closed")
	if rec.Code != http.StatusInternalServerError {
		t.Fatalf("status=%d", rec.Code)
	}
	if !strings.Contains(buf.String(), "读取发现失败") {
		t.Fatalf("5xx reason not logged: %q", buf.String())
	}
}

func TestWriteErrDoesNotLogClientErrors(t *testing.T) {
	var buf bytes.Buffer
	previous := log.Writer()
	log.SetOutput(&buf)
	t.Cleanup(func() { log.SetOutput(previous) })

	writeErr(httptest.NewRecorder(), http.StatusBadRequest, "参数错误")
	if buf.Len() != 0 {
		t.Fatalf("4xx logged: %q", buf.String())
	}
}
