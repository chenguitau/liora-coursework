package agent

import (
	"context"
	"encoding/json"
	"testing"

	actool "github.com/Autumn-27/norma/tool"
)

// Tool wrappers embed CoreTool, so an optional capability such as RawInput is
// silently dropped unless forwarded. The harness discovers RawInput by type
// assertion; losing it re-enables schema validation for a tool that opted out.
func TestToolWrappersPreserveRawInput(t *testing.T) {
	raw := actool.Build(actool.Spec{
		Name:     "raw_tool",
		Schema:   obj(map[string]any{"x": str("x")}),
		RawInput: true,
		Run: func(context.Context, json.RawMessage, *actool.ToolContext) (actool.Result, error) {
			return actool.Text("ok"), nil
		},
	})
	wrappers := map[string]actool.CoreTool{
		"guardPanic":   guardPanic(raw),
		"DecorateTool": DecorateTool(raw, "", nil),
	}
	for name, wrapped := range wrappers {
		r, ok := wrapped.(interface{ AcceptsRawInput() bool })
		if !ok || !r.AcceptsRawInput() {
			t.Fatalf("%s dropped AcceptsRawInput", name)
		}
	}

	plain := actool.Build(actool.Spec{
		Name:   "plain_tool",
		Schema: obj(map[string]any{"x": str("x")}),
		Run: func(context.Context, json.RawMessage, *actool.ToolContext) (actool.Result, error) {
			return actool.Text("ok"), nil
		},
	})
	if r, ok := guardPanic(plain).(interface{ AcceptsRawInput() bool }); ok && r.AcceptsRawInput() {
		t.Fatal("guardPanic reported raw-input support for a tool that has none")
	}
}
