package server

import (
	"context"
	"encoding/json"
	"fmt"
	"log"
	"sort"
	"strconv"
	"strings"
	"time"

	"liora/db"
)

// Scheduler drives P3 triggers: on each tick it fires due interval triggers and
// scans for new findings / newly-met goals (any task) to fire event triggers.
// Each fire enqueues a NEW conversation on the agent's per-agent trigger queue
// (StartTriggeredRun): fires for the same agent run one at a time in FIFO order,
// distinct agents still run concurrently. State is persisted (per-trigger last_fire
// + finding watermark + fired-goal set) so a restart resumes without double-firing.
// Triggers only attach to CUSTOM agents.
type Scheduler struct {
	s    *Server
	pg   *db.DB
	tick time.Duration
	// orphanLogged remembers agent keys already reported as missing so a stale
	// enabled trigger cannot log on every 5s tick. It is only touched from the
	// Run loop (step), so no lock is needed; a key is forgotten once its agent
	// reappears, so a later deletion is reported again.
	orphanLogged map[string]struct{}
}

const (
	schedKeyLastFinding    = "last_finding_id"    // watermark: max finding node id fired for
	schedKeyFiredGoals     = "fired_goals"        // legacy (superseded): JSON array of goal node ids, unbounded
	schedKeyGoalWatermark  = "fired_goals_wm"     // watermark: goal node updated_at already consumed (inclusive)
	schedKeyFiredGoalsTail = "fired_goals_recent" // JSON array of {id,at} consumed at/after the watermark
	schedKeyLastTimeout    = "last_timeout_id"    // watermark: max task id fired for task timeout
	schedKeyLastToolCall   = "last_toolcall_id"   // watermark: max activity id fired for tool call
	schedKeyLastTaskCreate = "last_taskcreate_id" // watermark: max task id fired for task create
)

// goalFiredOverlap is how long a consumed goal id is remembered after the scan
// watermark has passed it. The scan itself is inclusive at the watermark (so ids
// stamped exactly at it stay), and the extra window keeps a payload edit or a
// repeated state flip shortly after "met" from notifying twice. Past the window
// an already-fired goal is only remembered while it is still inside the scan
// window — that is what bounds the persisted set.
const goalFiredOverlap = time.Hour

func newScheduler(s *Server) *Scheduler {
	return &Scheduler{s: s, pg: s.m.pg, tick: 5 * time.Second, orphanLogged: map[string]struct{}{}}
}

// Run loops until ctx is done, ticking the scheduler. Started once from server New.
func (sc *Scheduler) Run(ctx context.Context) {
	if sc.pg == nil {
		return
	}
	sc.init()
	t := time.NewTicker(sc.tick)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-t.C:
			sc.s.reconcileConcurrency() // 并发上限:有空位就把排队任务补位启动
			sc.step()
		}
	}
}

// init seeds the watermarks on first run so pre-existing findings/goals don't all
// fire at once — only events created AFTER the scheduler first starts count.
func (sc *Scheduler) init() {
	if sc.mustState(schedKeyLastFinding) == "" {
		var maxID int64
		if evs, err := sc.pg.NewFindingsSince(0); err == nil {
			for _, e := range evs {
				if e.NodeID > maxID {
					maxID = e.NodeID
				}
			}
		}
		_ = sc.pg.SetSchedState(schedKeyLastFinding, strconv.FormatInt(maxID, 10))
	}
	if sc.mustState(schedKeyGoalWatermark) == "" && sc.mustState(schedKeyFiredGoalsTail) == "" {
		// First run with the watermark scheme. Seed the remembered set from the
		// legacy unbounded id set so nothing already fired is replayed, and leave
		// the watermark empty: the first tick scans every met goal once — the exact
		// cost the old code paid on every tick — stamps the ids it keeps with their
		// real updated_at, and only scans the tail from then on.
		seeds := map[int64]string{}
		legacy := sc.mustState(schedKeyFiredGoals)
		if legacy != "" {
			var ids []int64
			if json.Unmarshal([]byte(legacy), &ids) == nil {
				for _, id := range ids {
					seeds[id] = ""
				}
			}
		}
		_ = sc.pg.SetSchedState(schedKeyGoalWatermark, "")
		sc.saveFiredGoals(seeds)
		if legacy != "" {
			// The legacy blob is the thing that grew without bound; the new keys
			// supersede it (an old binary re-seeds itself from MetGoals on downgrade).
			_ = sc.pg.DeleteSchedState(schedKeyFiredGoals)
		}
	}
	if sc.mustState(schedKeyLastTimeout) == "" {
		var maxID int64
		if evs, err := sc.pg.TimedOutTasksSince(0); err == nil {
			for _, e := range evs {
				if e.NodeID > maxID {
					maxID = e.NodeID
				}
			}
		}
		_ = sc.pg.SetSchedState(schedKeyLastTimeout, strconv.FormatInt(maxID, 10))
	}
	if sc.mustState(schedKeyLastToolCall) == "" {
		var maxID int64
		if evs, err := sc.pg.NewToolCallsSince(0); err == nil {
			for _, e := range evs {
				if e.NodeID > maxID {
					maxID = e.NodeID
				}
			}
		}
		_ = sc.pg.SetSchedState(schedKeyLastToolCall, strconv.FormatInt(maxID, 10))
	}
	if sc.mustState(schedKeyLastTaskCreate) == "" {
		var maxID int64
		if evs, err := sc.pg.NewTasksSince(0); err == nil {
			for _, e := range evs {
				if e.NodeID > maxID {
					maxID = e.NodeID
				}
			}
		}
		_ = sc.pg.SetSchedState(schedKeyLastTaskCreate, strconv.FormatInt(maxID, 10))
	}
}

func (sc *Scheduler) step() {
	triggers, err := sc.pg.ListEnabledTriggers()
	if err != nil {
		return
	}
	if len(triggers) == 0 {
		return
	}
	// 一次 tick 只校验一次存在性，覆盖下面全部 fire* 入口：并发删除 agent 的窗口
	// 里，触发器行可能还在，但按 key 启动一个不存在的 agent 没有意义。行不在这里
	// 删除——历史孤儿由启动时的 DeleteOrphanTriggers 负责。
	triggers = sc.existingAgentTriggers(triggers)
	if len(triggers) == 0 {
		return
	}
	sc.fireIntervals(triggers)
	sc.fireFindings(triggers)
	sc.fireGoals(triggers)
	sc.fireTaskTimeouts(triggers)
	sc.fireToolCalls(triggers)
	sc.fireTaskCreates(triggers)
}

// existingAgentTriggers drops enabled triggers whose agent_key no longer exists
// in agents, returning the rest. One ListAgents per tick covers every trigger
// family. A missing key is logged once (not once per tick, and not once per
// trigger): the cleanup is DeleteOrphanTriggers' job, so the row is left in place.
// If the agent lookup itself fails, the whole tick is skipped rather than firing
// against keys we cannot verify.
func (sc *Scheduler) existingAgentTriggers(triggers []*db.AgentTrigger) []*db.AgentTrigger {
	agents, err := sc.pg.ListAgents()
	if err != nil {
		log.Printf("[scheduler] 校验触发器 agent 存在性失败，本轮跳过: %v", err)
		return nil
	}
	exists := make(map[string]struct{}, len(agents))
	for _, a := range agents {
		exists[a.Key] = struct{}{}
	}
	kept := make([]*db.AgentTrigger, 0, len(triggers))
	var newlyMissing []string
	for _, tr := range triggers {
		if _, ok := exists[tr.AgentKey]; ok {
			delete(sc.orphanLogged, tr.AgentKey) // agent 回来了，之后再删时重新报告
			kept = append(kept, tr)
			continue
		}
		if _, logged := sc.orphanLogged[tr.AgentKey]; logged {
			continue
		}
		if sc.orphanLogged == nil {
			sc.orphanLogged = map[string]struct{}{}
		}
		sc.orphanLogged[tr.AgentKey] = struct{}{}
		newlyMissing = append(newlyMissing, tr.AgentKey)
	}
	if len(newlyMissing) > 0 {
		log.Printf("[scheduler] 跳过 agent 已不存在的触发器（%s）；触发器行保留，由启动清理删除", strings.Join(newlyMissing, ", "))
	}
	return kept
}

// fireIntervals fires triggers whose interval has elapsed since last_fire.
func (sc *Scheduler) fireIntervals(triggers []*db.AgentTrigger) {
	now := time.Now()
	for _, tr := range triggers {
		if tr.IntervalSec <= 0 {
			continue
		}
		due := tr.LastFire == nil || now.Sub(*tr.LastFire) >= time.Duration(tr.IntervalSec)*time.Second
		if !due {
			continue
		}
		// Advance the watermark BEFORE starting the run. If the write fails and we
		// still fire, last_fire stays behind and the next 5s tick fires the same
		// interval trigger again — duplicated conversations and duplicated token spend.
		if err := sc.pg.TouchTriggerFire(tr.ID); err != nil {
			log.Printf("[scheduler] 触发器 %d 推进 last_fire 失败，跳过本轮: %v", tr.ID, err)
			continue
		}
		ctx := "\n\n【本次为定时触发】" + now.Format(" 2006-01-02 15:04:05 MST")
		sc.s.StartTriggeredRun(tr.AgentKey, fmt.Sprintf("定时触发 · %s", now.Format("15:04")), tr.IntervalMessage+ctx, 0, false, "", "")
	}
}

// fireFindings fires on_finding triggers for findings above the persisted
// watermark (monotonic node id → no double-fire across restarts).
func (sc *Scheduler) fireFindings(triggers []*db.AgentTrigger) {
	var want []*db.AgentTrigger
	for _, tr := range triggers {
		if tr.OnFinding {
			want = append(want, tr)
		}
	}
	last, _ := strconv.ParseInt(sc.mustState(schedKeyLastFinding), 10, 64)
	events, err := sc.pg.NewFindingsSince(last)
	if err != nil || len(events) == 0 {
		return
	}
	// Advance the watermark whether or not any on_finding trigger is active: a
	// finding fires only for triggers live at the moment it appears. Otherwise a
	// trigger enabled later would replay the entire historical backlog at once.
	maxID := last
	for _, e := range events {
		if e.NodeID > maxID {
			maxID = e.NodeID
		}
		if len(want) == 0 {
			continue
		}
		msgCtx := fmt.Sprintf("\n\n【本次由任务发现 finding 触发】\n发现: [%s/%s] %s",
			e.VulnClass, e.Severity, e.Summary)
		for _, tr := range want {
			sc.s.StartTriggeredRun(tr.AgentKey, fmt.Sprintf("finding 触发 · task#%d", e.TaskID), tr.FindingMessage+msgCtx, e.TaskID, true, e.TaskDesc, e.TaskGoal)
		}
	}
	_ = sc.pg.SetSchedState(schedKeyLastFinding, strconv.FormatInt(maxID, 10))
}

// fireGoals fires on_goal_met triggers for met goals that were not consumed yet.
//
// Goal ids cannot be a watermark the way finding/task ids are: they are assigned
// at creation while "met" happens later and in no id order, so a low id may be
// met after the watermark has already passed it and an "id > watermark" scan
// would skip it forever. The achievement clock is the node's updated_at, bumped
// by the trg_expnodes_upd trigger on the state flip. Each tick scans
// updated_at >= watermark (inclusive), remembers the ids it consumed together
// with that stamp, and advances the watermark to the newest stamp it saw. The
// remembered set is pruned to a short overlap window, so its size follows "goals
// met recently" instead of every goal ever met.
func (sc *Scheduler) fireGoals(triggers []*db.AgentTrigger) {
	var want []*db.AgentTrigger
	for _, tr := range triggers {
		if tr.OnGoalMet {
			want = append(want, tr)
		}
	}
	wm := sc.mustState(schedKeyGoalWatermark)
	// Read the clock BEFORE the scan: a goal met after this instant carries
	// updated_at >= now, so advancing the watermark to it on an empty scan cannot
	// skip that goal.
	now, err := sc.pg.SchedNow()
	if err != nil {
		return
	}
	events, err := sc.pg.MetGoalsSince(wm)
	if err != nil {
		return
	}
	// Mark goals as consumed whether or not a trigger is active, so enabling an
	// on_goal_met trigger later doesn't replay every already-met goal.
	fired := sc.firedGoals()
	changed := false
	for _, e := range events {
		if _, done := fired[e.NodeID]; done {
			// Already consumed: keep its stamp current. Without this, a goal seeded
			// from the legacy set (no stamp) would be pruned while still inside the
			// scan window and fire again on the next tick.
			if fired[e.NodeID] != e.UpdatedAt {
				fired[e.NodeID] = e.UpdatedAt
				changed = true
			}
			continue
		}
		fired[e.NodeID] = e.UpdatedAt
		changed = true
		if len(want) == 0 {
			continue
		}
		msgCtx := fmt.Sprintf("\n\n【本次由任务完成目标触发】\n达成目标: %s", e.Summary)
		for _, tr := range want {
			sc.s.StartTriggeredRun(tr.AgentKey, fmt.Sprintf("目标触发 · task#%d", e.TaskID), tr.GoalMessage+msgCtx, e.TaskID, true, e.TaskDesc, e.TaskGoal)
		}
	}
	newWM := wm
	if len(events) == 0 {
		newWM = now
	} else {
		for _, e := range events {
			if e.UpdatedAt > newWM {
				newWM = e.UpdatedAt
			}
		}
	}
	if newWM < wm {
		newWM = wm // never move the watermark backwards (clock skew / manual stamps)
	}
	if cutoff := goalPruneCutoff(newWM); cutoff != "" {
		for id, at := range fired {
			if at < cutoff {
				delete(fired, id)
				changed = true
			}
		}
	}
	// Persist the set before the watermark: if the process dies in between, the
	// next tick rescans the same window and finds the ids already consumed
	// (a wasted scan), instead of advancing past ids it never recorded (a loss).
	if changed {
		sc.saveFiredGoals(fired)
	}
	if newWM != wm {
		_ = sc.pg.SetSchedState(schedKeyGoalWatermark, newWM)
	}
}

// goalPruneCutoff turns the watermark into the oldest stamp the consumed-id set
// must still remember, in the same textual format (UTC, millisecond precision).
// An unparsable watermark keeps every id — never replay.
func goalPruneCutoff(wm string) string {
	if wm == "" {
		return ""
	}
	t, err := time.Parse(db.SchedStampLayout, wm)
	if err != nil {
		return ""
	}
	return t.Add(-goalFiredOverlap).UTC().Format(db.SchedStampLayout)
}

// fireTaskTimeouts fires on_task_timeout triggers for tasks that newly reached
// status='timeout' above the persisted watermark (task id → no double-fire).
func (sc *Scheduler) fireTaskTimeouts(triggers []*db.AgentTrigger) {
	var want []*db.AgentTrigger
	for _, tr := range triggers {
		if tr.OnTaskTimeout {
			want = append(want, tr)
		}
	}
	last, _ := strconv.ParseInt(sc.mustState(schedKeyLastTimeout), 10, 64)
	events, err := sc.pg.TimedOutTasksSince(last)
	if err != nil || len(events) == 0 {
		return
	}
	// Advance the watermark even with no active trigger — see fireFindings.
	maxID := last
	for _, e := range events {
		if e.NodeID > maxID {
			maxID = e.NodeID
		}
		if len(want) == 0 {
			continue
		}
		msgCtx := "\n\n【本次由任务超时触发】"
		for _, tr := range want {
			sc.s.StartTriggeredRun(tr.AgentKey, fmt.Sprintf("超时触发 · task#%d", e.TaskID), tr.TaskTimeoutMessage+msgCtx, e.TaskID, true, e.TaskDesc, e.TaskGoal)
		}
	}
	_ = sc.pg.SetSchedState(schedKeyLastTimeout, strconv.FormatInt(maxID, 10))
}

// fireTaskCreates fires on_task_create triggers for tasks newly created above the
// persisted watermark (task id → no double-fire across restarts).
func (sc *Scheduler) fireTaskCreates(triggers []*db.AgentTrigger) {
	var want []*db.AgentTrigger
	for _, tr := range triggers {
		if tr.OnTaskCreate {
			want = append(want, tr)
		}
	}
	last, _ := strconv.ParseInt(sc.mustState(schedKeyLastTaskCreate), 10, 64)
	events, err := sc.pg.NewTasksSince(last)
	if err != nil || len(events) == 0 {
		return
	}
	// Advance the watermark even with no active trigger — see fireFindings.
	maxID := last
	for _, e := range events {
		if e.NodeID > maxID {
			maxID = e.NodeID
		}
		if len(want) == 0 {
			continue
		}
		msgCtx := "\n\n【本次由任务创建触发】"
		for _, tr := range want {
			sc.s.StartTriggeredRun(tr.AgentKey, fmt.Sprintf("任务创建触发 · task#%d", e.TaskID), tr.TaskCreateMessage+msgCtx, e.TaskID, true, e.TaskDesc, e.TaskGoal)
		}
	}
	_ = sc.pg.SetSchedState(schedKeyLastTaskCreate, strconv.FormatInt(maxID, 10))
}

// fireToolCalls fires on_tool_call triggers for tool calls (tool_result rows) above
// the persisted watermark whose tool name is in the trigger's selected set. The fire
// message carries the task id/desc/goal + tool name + (truncated) input & output.
func (sc *Scheduler) fireToolCalls(triggers []*db.AgentTrigger) {
	var want []*db.AgentTrigger
	for _, tr := range triggers {
		if tr.OnToolCall && len(tr.ToolNames) > 0 {
			want = append(want, tr)
		}
	}
	last, _ := strconv.ParseInt(sc.mustState(schedKeyLastToolCall), 10, 64)
	events, err := sc.pg.NewToolCallsSince(last)
	if err != nil || len(events) == 0 {
		return
	}
	// Advance the watermark even with no active trigger — see fireFindings.
	maxID := last
	for _, e := range events {
		if e.NodeID > maxID {
			maxID = e.NodeID
		}
		if len(want) == 0 {
			continue
		}
		// A failed finding write has no committed finding to report. Keep other
		// tool-error triggers available for user-defined automation.
		if e.ToolIsErr && e.Tool == "report_finding" {
			continue
		}
		errTag := ""
		if e.ToolIsErr {
			errTag = "[error] "
		}
		msgCtx := fmt.Sprintf("\n\n【本次由工具调用触发】\n工具: %s\n入参: %s\n返回: %s%s",
			e.Tool, trunc(e.ToolInput, 1500), errTag, trunc(e.ToolOutput, 1500))
		for _, tr := range want {
			if !containsFold(tr.ToolNames, e.Tool) {
				continue
			}
			sc.s.StartTriggeredRun(tr.AgentKey, fmt.Sprintf("工具触发 · %s · task#%d", e.Tool, e.TaskID), tr.ToolCallMessage+msgCtx, e.TaskID, true, e.TaskDesc, e.TaskGoal)
		}
	}
	_ = sc.pg.SetSchedState(schedKeyLastToolCall, strconv.FormatInt(maxID, 10))
}

// containsFold reports whether name is in set (case-insensitive).
func containsFold(set []string, name string) bool {
	for _, s := range set {
		if strings.EqualFold(s, name) {
			return true
		}
	}
	return false
}

// trunc caps s to max runes, appending an ellipsis + original length when cut.
func trunc(s string, max int) string {
	r := []rune(s)
	if len(r) <= max {
		return s
	}
	return string(r[:max]) + fmt.Sprintf("…(已截断,共 %d 字)", len(r))
}

func (sc *Scheduler) mustState(key string) string {
	v, _ := sc.pg.GetSchedState(key)
	return v
}

// firedGoal is one consumed goal id and the node updated_at it was consumed at.
// The stamp is what lets the set be pruned once it falls behind the watermark, so
// the persisted set stays bounded.
type firedGoal struct {
	ID int64  `json:"id"`
	At string `json:"at,omitempty"`
}

func (sc *Scheduler) firedGoals() map[int64]string {
	out := map[int64]string{}
	raw := sc.mustState(schedKeyFiredGoalsTail)
	if raw == "" {
		return out
	}
	var rows []firedGoal
	if json.Unmarshal([]byte(raw), &rows) == nil {
		for _, r := range rows {
			out[r.ID] = r.At
		}
	}
	return out
}

func (sc *Scheduler) saveFiredGoals(set map[int64]string) {
	rows := make([]firedGoal, 0, len(set))
	for id, at := range set {
		rows = append(rows, firedGoal{ID: id, At: at})
	}
	sort.Slice(rows, func(i, j int) bool { return rows[i].ID < rows[j].ID }) // stable output, no needless churn
	b, _ := json.Marshal(rows)
	if err := sc.pg.SetSchedState(schedKeyFiredGoalsTail, string(b)); err != nil {
		log.Printf("[scheduler] save fired goals failed: %v", err)
	}
}
