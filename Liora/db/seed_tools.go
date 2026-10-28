package db

import (
	"encoding/json"
	"fmt"
	"log"
)

// legacyTrafficSearchDescription is the original traffic_search default text.
// The one-time migration replaces it only while the row still carries exactly
// this text, so a user-edited description survives upgrades.
const legacyTrafficSearchDescription = `查询记录代理已抓取的目标流量（必须指定 host，可再按 URL 子串或正文关键词过滤）。body_contains 会在已抓取的请求/响应头与正文中做全文搜索，支持任意子串和中文（至少 3 个字符），可用来找响应里的密码、密钥、报错、内网地址等。仅返回极轻量索引(id/method/url/status/resp_len)，不含任何响应内容。默认只返回 3 条、每页最多 10 条；结果多时用 page 翻页（page=0 起）；要看某条的请求/响应原文用 traffic_get(id)。回看已访问资源、找端点先用它，避免重复 curl 同一 URL。`

// ToolSchemaDefaults carries code-owned literals that db cannot import: both
// the traffic and agent packages depend on db, so the caller injects them.
type ToolSchemaDefaults struct {
	// TrafficSearchDescription is the current code default
	// (traffic.TrafficSearchDescription).
	TrafficSearchDescription string
	// HintTrafficSchema is the hint traffic-refs fragment
	// (agent.HintTrafficSchema()).
	HintTrafficSchema map[string]any
}

// EnsureToolSchema applies the one-time finding-workflow tools migration: the
// traffic_search description upgrade, the report_finding/add_hint/add_task_hint
// schema upgrade, and the reporter agent's traffic bindings. Every step keeps
// its historical one-time flag, conditional UPDATE guard and user-edit
// preservation semantics; the flag is only set after all steps succeed, so a
// failure is retried on the next startup.
//
// Failures that the original server-side migration logged are returned with the
// same message text (the caller logs them with the "[evidence]" prefix); the
// traffic_search description failure stays non-fatal and is logged here, exactly
// as before, so it never skips the reporter migration below.
func (d *DB) EnsureToolSchema(def ToolSchemaDefaults) error {
	const hostSearchDescriptionFlag = "finding_workflow_tools_v3_host_search_description"
	if value, _, _ := d.GetSetting(hostSearchDescriptionFlag); value != "true" {
		// Only replace the original built-in text. A user-edited description is
		// authoritative and must survive upgrades.
		if _, err := d.Exec(`UPDATE tools SET description=$1,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE key='traffic_search' AND system AND description=$2`, def.TrafficSearchDescription, legacyTrafficSearchDescription); err != nil {
			// Log and leave the flag unset so the next startup retries; do not
			// return, or a transient error here would also skip the reporter
			// migration below — the two are independent.
			log.Printf("[evidence] upgrade traffic_search description: %v", err)
		} else {
			_ = d.SetSetting(hostSearchDescriptionFlag, "true")
		}
	}
	const flag = "finding_workflow_tools_v2_reporter"
	if value, _, _ := d.GetSetting(flag); value == "true" {
		return nil
	}
	for _, key := range []string{"report_finding", "add_hint", "add_task_hint"} {
		row, err := d.GetTool(key)
		if err != nil {
			return fmt.Errorf("load %s: %w", key, err)
		}
		if row == nil || !row.System {
			continue
		}
		var schema map[string]any
		if err := json.Unmarshal(row.Schema, &schema); err != nil {
			return fmt.Errorf("invalid schema for %s: %w", key, err)
		}
		if schema == nil {
			return fmt.Errorf("missing object schema for %s", key)
		}
		props := objectProperty(schema, "properties")
		if key == "report_finding" {
			if _, exists := props["evidence_hint_id"]; !exists {
				props["evidence_hint_id"] = map[string]any{"type": "integer", "description": "可选：本任务中对应此漏洞的 hint ID；读取该提示保存的 traffic_refs 一并绑定，无提示时省略"}
			}
		} else {
			if _, exists := props["traffic_refs"]; !exists {
				props["traffic_refs"] = def.HintTrafficSchema
			}
			hints := objectProperty(props, "hints")
			if _, exists := hints["type"]; !exists {
				hints["type"] = "array"
			}
			items := objectProperty(hints, "items")
			if _, ok := items["type"]; !ok {
				items["type"] = "object"
			}
			itemProps := objectProperty(items, "properties")
			for name, value := range map[string]any{"text": stringParam("提示内容"), "asset_ids": map[string]any{"type": "array", "items": map[string]any{"type": "integer"}}, "traffic_refs": def.HintTrafficSchema} {
				if _, exists := itemProps[name]; !exists {
					itemProps[name] = value
				}
			}
		}
		raw, _ := json.Marshal(schema)
		result, err := d.Exec(`UPDATE tools SET schema=$2,updated_at=strftime('%Y-%m-%d %H:%M:%f','now') WHERE key=$1 AND system AND schema=$3`, key, string(raw), string(row.Schema))
		if err != nil {
			return fmt.Errorf("upgrade %s: %w", key, err)
		}
		if n, _ := result.RowsAffected(); n != 1 {
			return nil // preserve concurrent user edits; leave the flag unset
		}
	}
	// Upgrade only the original default binding. Customized lists and enabled
	// flags survive; the one-time flag also preserves future user unbinding.
	//
	// The binding steps below mirror the original migration exactly: a failure
	// stops this pass without logging and leaves the flag unset, so the next
	// startup retries.
	readers := `["worker","reporter"]`
	for _, key := range []string{"traffic_search", "traffic_get", "traffic_blob"} {
		if _, err := d.Exec(`UPDATE tools SET agents=$2 WHERE key=$1 AND system AND (agents='["worker"]' OR (json_array_length(agents)=5 AND NOT EXISTS (SELECT 1 FROM json_each('["worker","planner","mainagent","auto","pentest"]') req WHERE NOT EXISTS (SELECT 1 FROM json_each(tools.agents) cur WHERE cur.value=req.value))))`, key, readers); err != nil {
			return nil
		}
	}
	if _, err := d.Exec(`UPDATE tools SET agents=$1 WHERE key='get_finding_traffic' AND system AND json_array_length(agents)=2 AND NOT EXISTS (SELECT 1 FROM json_each('["auto","reporter"]') req WHERE NOT EXISTS (SELECT 1 FROM json_each(tools.agents) cur WHERE cur.value=req.value))`, `["auto","reporter","worker","planner","mainagent","pentest"]`); err != nil {
		return nil
	}
	// Replace the previous code default only; preserve customized binding lists.
	if _, err := d.Exec(`UPDATE tools SET agents='["reporter"]' WHERE key='bind_finding_traffic' AND system AND json_array_length(agents)=5 AND NOT EXISTS (SELECT 1 FROM json_each('["worker","planner","mainagent","auto","pentest"]') req WHERE NOT EXISTS (SELECT 1 FROM json_each(tools.agents) cur WHERE cur.value=req.value))`); err != nil {
		return nil
	}
	if err := d.AddAgentToToolBinding("reporter", []string{"bind_finding_traffic"}); err != nil {
		return nil
	}
	_ = d.SetSetting(flag, "true")
	return nil
}

// objectProperty returns parent[key] as an object, creating it when absent or
// when it is not an object (mirrors the server helper of the same name).
func objectProperty(parent map[string]any, key string) map[string]any {
	value, ok := parent[key].(map[string]any)
	if !ok {
		value = map[string]any{}
		parent[key] = value
	}
	return value
}

// stringParam is a JSON-schema string property (mirrors the server's strParam).
func stringParam(desc string) map[string]any {
	return map[string]any{"type": "string", "description": desc}
}
