package server

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log"
	"strconv"

	actool "github.com/Autumn-27/norma/tool"
	"liora/agent"
	"liora/db"
	"liora/traffic"
)

// seedFindingWorkflowTools applies the one-time tools schema/agent-binding
// migration. The SQL, flags and ordering live in db.EnsureToolSchema; this only
// supplies the code-owned literals (traffic/agent import db, so db cannot import
// them) and keeps the historical "[evidence]" log prefix.
func (s *Server) seedFindingWorkflowTools() {
	if err := s.m.pg.EnsureToolSchema(db.ToolSchemaDefaults{
		TrafficSearchDescription: traffic.TrafficSearchDescription,
		HintTrafficSchema:        agent.HintTrafficSchema(),
	}); err != nil {
		log.Printf("[evidence] %v", err)
	}
}

func objectProperty(parent map[string]any, key string) map[string]any {
	value, ok := parent[key].(map[string]any)
	if !ok {
		value = map[string]any{}
		parent[key] = value
	}
	return value
}

func (s *Server) agentFindingTrafficAccess(ctx context.Context, id int64, write bool) error {
	if id <= 0 {
		return errors.New("finding_id 必须为独立漏洞记录 ID；不是探索节点 ID")
	}
	f, err := s.m.pg.GetFinding(id)
	if err != nil {
		return err
	}
	if f == nil {
		return fmt.Errorf("%w：finding_id=%d。证据工具使用独立漏洞记录 ID，请从 list_task_findings / get_task_node_detail 的 finding_id 字段读取；不要传 id / finding_node_id", db.ErrFindingNotFound, id)
	}
	if ri := agent.RunInfoFrom(ctx); ri.TaskID > 0 {
		task := s.m.ResolveTask(strconv.FormatInt(ri.TaskID, 10))
		if task == nil {
			return errors.New("任务不存在")
		}
		_, inherited, allowed := findingProvenanceInTask(task, f.TaskID)
		if !allowed {
			return errors.New("当前任务不可读取该漏洞")
		}
		if write && inherited {
			return errors.New("继承漏洞的流量证据只读，请到来源任务修改")
		}
	}
	return nil
}

func (s *Server) toolBindFindingTraffic() actool.CoreTool {
	return wrTool("bind_finding_traffic", "为已登记漏洞补绑经核实的真实 HTTP 流量。finding_id 使用独立漏洞记录 ID；不要传探索节点 ID。同批引用全部成功或全部失败，重复引用不覆盖已有说明。补绑会使已有报告标记待更新；不要为补包重新探测或重复创建漏洞。",
		objSchema(map[string]any{"finding_id": strParam("独立漏洞记录 ID，从 list_task_findings / get_task_node_detail 的 finding_id 字段读取"), "traffic_refs": agent.HintTrafficSchema()}, "finding_id", "traffic_refs"),
		func(ctx context.Context, raw json.RawMessage) (actool.Result, error) {
			if !s.m.pg.GetBool(settingAgentTrafficBinding, false) {
				return actool.Errorf("Agent 自动绑定流量已关闭；请在系统设置开启，或使用页面人工绑定。"), nil
			}
			var args struct {
				FindingID json.RawMessage `json:"finding_id"`
				Refs      []db.TrafficRef `json:"traffic_refs"`
			}
			if err := json.Unmarshal(raw, &args); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			id := parseProfileID(args.FindingID)
			if err := s.agentFindingTrafficAccess(ctx, id, true); err != nil {
				return actool.Errorf(err.Error()), nil
			}
			if len(args.Refs) == 0 {
				return actool.Errorf("补绑需要至少一条已核实的 traffic_refs；无流量无需调用此工具"), nil
			}
			list, err := s.evidenceStore().Bind(ctx, id, args.Refs)
			if err != nil {
				return actool.Errorf(err.Error()), nil
			}
			return jsonResult(trafficSummary(list))
		})
}
