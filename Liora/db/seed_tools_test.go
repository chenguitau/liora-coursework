package db

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestEnsureToolSchemaMigratesOnceAndPreservesUserEdits(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer d.Close()

	userSchema := json.RawMessage(`{"type":"object","properties":{"text":{"type":"string","description":"USER TEXT"},"hints":{"type":"array","items":{"type":"object","properties":{"text":{"type":"string","description":"USER ITEM"}}}}},"required":["text"]}`)
	for _, key := range []string{"report_finding", "add_hint", "add_task_hint"} {
		if err := d.SeedTool(key, "USER DESCRIPTION", userSchema, json.RawMessage(`["custom-agent"]`)); err != nil {
			t.Fatal(err)
		}
	}
	if err := d.SeedTool("traffic_search", legacyTrafficSearchDescription, json.RawMessage(`{"type":"object"}`), json.RawMessage(`["worker"]`)); err != nil {
		t.Fatal(err)
	}
	hint := map[string]any{"type": "array", "description": "hint refs", "items": map[string]any{"type": "object"}}
	def := ToolSchemaDefaults{TrafficSearchDescription: "新版流量检索说明", HintTrafficSchema: hint}
	if err := d.EnsureToolSchema(def); err != nil {
		t.Fatalf("first ensure: %v", err)
	}

	search, err := d.GetTool("traffic_search")
	if err != nil || search == nil {
		t.Fatalf("traffic_search: %v %v", search, err)
	}
	if search.Description != def.TrafficSearchDescription {
		t.Fatalf("traffic_search description = %q", search.Description)
	}
	if !strings.Contains(strings.Join(search.Agents, ","), "reporter") || !strings.Contains(strings.Join(search.Agents, ","), "worker") {
		t.Fatalf("traffic_search bindings = %v", search.Agents)
	}
	for _, key := range []string{"report_finding", "add_hint", "add_task_hint"} {
		row, err := d.GetTool(key)
		if err != nil || row == nil {
			t.Fatalf("%s: %v %v", key, row, err)
		}
		if row.Description != "USER DESCRIPTION" || !row.Enabled || len(row.Agents) != 1 || row.Agents[0] != "custom-agent" {
			t.Fatalf("%s user configuration changed: desc=%q enabled=%v agents=%v", key, row.Description, row.Enabled, row.Agents)
		}
		raw := string(row.Schema)
		if !strings.Contains(raw, "USER TEXT") || !strings.Contains(raw, "USER ITEM") {
			t.Fatalf("%s user schema changed: %s", key, raw)
		}
		field := "traffic_refs"
		if key == "report_finding" {
			field = "evidence_hint_id"
		}
		var schema map[string]any
		if err := json.Unmarshal(row.Schema, &schema); err != nil {
			t.Fatal(err)
		}
		props, _ := schema["properties"].(map[string]any)
		if _, ok := props[field]; !ok {
			t.Fatalf("%s missing %s: %s", key, field, raw)
		}
	}
	if v, ok, err := d.GetSetting("finding_workflow_tools_v2_reporter"); err != nil || !ok || v != "true" {
		t.Fatalf("migration flag = %q ok=%v err=%v", v, ok, err)
	}

	// A second startup is a no-op: same rows, same schema, same bindings.
	before := map[string]string{}
	for _, key := range []string{"report_finding", "add_hint", "add_task_hint", "traffic_search"} {
		row, err := d.GetTool(key)
		if err != nil || row == nil {
			t.Fatalf("%s: %v %v", key, row, err)
		}
		before[key] = string(row.Schema) + "|" + strings.Join(row.Agents, ",") + "|" + row.Description
	}
	if err := d.EnsureToolSchema(def); err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	for key, want := range before {
		row, err := d.GetTool(key)
		if err != nil || row == nil {
			t.Fatalf("%s: %v %v", key, row, err)
		}
		got := string(row.Schema) + "|" + strings.Join(row.Agents, ",") + "|" + row.Description
		if got != want {
			t.Fatalf("%s changed on second ensure: got %s want %s", key, got, want)
		}
	}

	// A user-edited traffic_search description is authoritative: clearing the
	// one-time flag must not replace it with the code default.
	if _, err := d.Exec(`UPDATE tools SET description='USER TRAFFIC DESC' WHERE key='traffic_search'`); err != nil {
		t.Fatal(err)
	}
	if err := d.SetSetting("finding_workflow_tools_v3_host_search_description", "false"); err != nil {
		t.Fatal(err)
	}
	if err := d.EnsureToolSchema(def); err != nil {
		t.Fatalf("ensure after user edit: %v", err)
	}
	if row, err := d.GetTool("traffic_search"); err != nil || row == nil || row.Description != "USER TRAFFIC DESC" {
		t.Fatalf("user description overwritten: %v %v", row, err)
	}
}
