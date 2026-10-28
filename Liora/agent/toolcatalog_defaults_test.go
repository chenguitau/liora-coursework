package agent

import (
	"encoding/json"
	"testing"
)

// A model may emit a tool call whose input is the JSON literal null (instead of
// {}). injectDefaults must treat that as "no arguments" and still fill declared
// defaults — not panic on a nil map.
func TestInjectDefaultsHandlesNullInput(t *testing.T) {
	schema := map[string]any{
		"type": "object",
		"properties": map[string]any{
			"limit": map[string]any{"type": "integer", "default": 10},
		},
	}
	got := injectDefaults(json.RawMessage("null"), schema)
	var m map[string]json.RawMessage
	if err := json.Unmarshal(got, &m); err != nil {
		t.Fatalf("injectDefaults returned non-object %q: %v", got, err)
	}
	if string(m["limit"]) != "10" {
		t.Fatalf("default not injected: %s", got)
	}
}
