package mcphttp

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

// NewSSE's long-lived GET must still respect the caller's context while it waits
// for the endpoint event: a server that accepts the connection and stays silent
// would otherwise block the caller (and leak its goroutine and connection) forever.
func TestNewSSEHonorsContextWhileWaitingForEndpoint(t *testing.T) {
	release := make(chan struct{})
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/event-stream")
		w.WriteHeader(http.StatusOK)
		w.(http.Flusher).Flush()
		<-release // never announce a message endpoint
	}))
	defer srv.Close()
	defer close(release)

	ctx, cancel := context.WithTimeout(context.Background(), 200*time.Millisecond)
	defer cancel()
	done := make(chan error, 1)
	go func() {
		_, err := NewSSE(ctx, "test", srv.URL, nil, false)
		done <- err
	}()
	select {
	case err := <-done:
		if err == nil {
			t.Fatal("expected an error for a stream without an endpoint event")
		}
	case <-time.After(5 * time.Second):
		t.Fatal("NewSSE ignored the caller's context and hung")
	}
}

// A server-initiated JSON-RPC request (e.g. sampling/createMessage) carries its
// own id namespace. A frame with our id but a method is not our response; taking
// it as one drops the real result.
func TestParseSSESkipsServerRequestsWithCollidingID(t *testing.T) {
	stream := `data: {"jsonrpc":"2.0","id":1,"method":"sampling/createMessage","params":{}}

data: {"jsonrpc":"2.0","id":1,"result":{"tools":[]}}
`
	resp, err := parseSSE(strings.NewReader(stream), 1)
	if err != nil {
		t.Fatal(err)
	}
	if resp == nil || resp.Error != nil || string(resp.Result) != `{"tools":[]}` {
		t.Fatalf("server request mistaken for the response: %+v", resp)
	}
}

// A JSON-RPC error reply for a request the server could not correlate carries
// "id": null. Its code/message must reach the caller instead of a generic
// "no matching response".
func TestParseSSESurfacesUncorrelatedError(t *testing.T) {
	stream := `data: {"jsonrpc":"2.0","id":null,"error":{"code":-32602,"message":"Invalid params"}}`
	resp, err := parseSSE(strings.NewReader(stream), 7)
	if err != nil {
		t.Fatal(err)
	}
	if resp == nil || resp.Error == nil || resp.Error.Code != -32602 || resp.Error.Message != "Invalid params" {
		t.Fatalf("lost the server's error: %+v", resp)
	}
}

// End-to-end: a Streamable HTTP server answering over SSE with a server-initiated
// request before the response must still yield the tool list.
func TestStreamableHTTPIgnoresServerRequestFrames(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req rpcRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		if req.ID == 0 {
			w.WriteHeader(http.StatusAccepted)
			return
		}
		w.Header().Set("Content-Type", "text/event-stream")
		send := func(payload string) { fmt.Fprintf(w, "data: %s\n\n", payload) }
		send(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"method":"roots/list","params":{}}`, req.ID))
		switch req.Method {
		case "initialize":
			send(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"protocolVersion":"2025-06-18","capabilities":{},"serverInfo":{"name":"t","version":"1"}}}`, req.ID))
		case "tools/list":
			send(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{"tools":[{"name":"echo"}]}}`, req.ID))
		default:
			send(fmt.Sprintf(`{"jsonrpc":"2.0","id":%d,"result":{}}`, req.ID))
		}
	}))
	defer srv.Close()
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	c, err := New(ctx, "test", srv.URL, nil, false)
	if err != nil {
		t.Fatal(err)
	}
	defer c.Close()
	tools, err := c.Tools(ctx)
	if err != nil {
		t.Fatalf("Tools() = %v", err)
	}
	if len(tools) != 1 {
		t.Fatalf("tools = %d", len(tools))
	}
}
