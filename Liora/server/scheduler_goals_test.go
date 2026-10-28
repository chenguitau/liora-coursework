package server

import (
	"context"
	"encoding/json"
	"fmt"
	"path/filepath"
	"sort"
	"testing"
	"time"

	"liora/agent"
	"liora/db"
)

// goalSched wires a Scheduler to a throwaway DB and to a Server whose root
// context is already cancelled: StartTriggeredRun still enqueues the fire (so a
// test can count it) but pumpLocked returns immediately, so no agent run starts.
type goalSched struct {
	t   *testing.T
	sc  *Scheduler
	pg  *db.DB
	srv *Server
	exp int64
}

func newGoalSched(t *testing.T) *goalSched {
	t.Helper()
	// A private database file: the server test package otherwise shares one SQLite
	// file (see TestMain), and scheduler state is global to the database.
	pg, err := db.Open(filepath.Join(t.TempDir(), "sched.db"))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	t.Cleanup(func() { pg.Close() })
	task, err := pg.CreateTask("goal trigger", "goal trigger", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	exp := task.ExplorationID
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	srv := &Server{
		m: &Manager{pg: pg}, ctx: ctx, chatAgent: &agent.ChatAgent{},
		triggerQ:      map[string][]triggeredRun{},
		triggerActive: map[string]int{},
		triggerCfg:    map[string]triggerBehavior{},
	}
	return &goalSched{t: t, sc: newScheduler(srv), pg: pg, srv: srv, exp: exp}
}

// start simulates a process start: the scheduler seeds its watermarks.
func (g *goalSched) start() { g.sc.init() }

func (g *goalSched) goal(text string) int64 {
	g.t.Helper()
	id, err := g.pg.Exploration(g.exp).AddGoal(map[string]any{"text": text}, "human")
	if err != nil {
		g.t.Fatalf("add goal %q: %v", text, err)
	}
	return id
}

func (g *goalSched) meet(id int64) {
	g.t.Helper()
	if err := g.pg.Exploration(g.exp).SetNodeState(id, "met"); err != nil {
		g.t.Fatalf("meet goal %d: %v", id, err)
	}
}

// setNode forces a state + updated_at stamp directly (the trg_expnodes_upd trigger
// only bumps updated_at when the UPDATE leaves it untouched, so an explicit stamp
// sticks). Used to place a goal exactly on the watermark or far in the past.
func (g *goalSched) setNode(id int64, state, stamp string) {
	g.t.Helper()
	if _, err := g.pg.Exec(`UPDATE exploration_nodes SET state=$1, updated_at=$2 WHERE id=$3`, state, stamp, id); err != nil {
		g.t.Fatalf("set node %d: %v", id, err)
	}
}

func (g *goalSched) stamp(id int64) string {
	g.t.Helper()
	var s string
	if err := g.pg.QueryRow(`SELECT updated_at FROM exploration_nodes WHERE id=$1`, id).Scan(&s); err != nil {
		g.t.Fatalf("read stamp %d: %v", id, err)
	}
	return s
}

// tick runs one scheduler goal pass with an on_goal_met trigger live.
func (g *goalSched) tick() {
	g.sc.fireGoals([]*db.AgentTrigger{{AgentKey: "goals", OnGoalMet: true}})
}

// fires counts the trigger fires enqueued so far.
func (g *goalSched) fires() int {
	g.srv.queueMu.Lock()
	defer g.srv.queueMu.Unlock()
	n := 0
	for _, q := range g.srv.triggerQ {
		n += len(q)
	}
	return n
}

func (g *goalSched) wm() string { return g.sc.mustState(schedKeyGoalWatermark) }

// remembered returns the goal ids the scheduler still remembers as consumed.
func (g *goalSched) remembered() []int64 {
	raw := g.sc.mustState(schedKeyFiredGoalsTail)
	var rows []firedGoal
	if raw != "" {
		if err := json.Unmarshal([]byte(raw), &rows); err != nil {
			g.t.Fatalf("decode fired set %q: %v", raw, err)
		}
	}
	ids := make([]int64, 0, len(rows))
	for _, r := range rows {
		ids = append(ids, r.ID)
	}
	sort.Slice(ids, func(i, j int) bool { return ids[i] < ids[j] })
	return ids
}

func containsID(ids []int64, id int64) bool {
	for _, v := range ids {
		if v == id {
			return true
		}
	}
	return false
}

// TestSchedulerGoalFiresLowIDMetLater is the case an id watermark would lose: a
// goal created early (low id) is proved long after a newer goal (high id), so by
// then the id watermark is already past it.
func TestSchedulerGoalFiresLowIDMetLater(t *testing.T) {
	g := newGoalSched(t)
	g.start()
	low := g.goal("low id, proved later")
	high := g.goal("high id, proved first")
	if low >= high {
		t.Fatalf("fixture needs low < high, got low=%d high=%d", low, high)
	}

	g.meet(high)
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("after proving the high id goal: %d fires, want 1", got)
	}
	if wm := g.wm(); wm == "" {
		t.Fatal("watermark did not advance after the first goal")
	}

	g.meet(low) // a lower id, proved after the watermark moved past that id
	g.tick()
	if got := g.fires(); got != 2 {
		t.Fatalf("goal %d (low id) met after the watermark must still fire: %d fires, want 2", low, got)
	}

	g.tick() // steady state
	if got := g.fires(); got != 2 {
		t.Fatalf("no goal was met, but the tick fired again: %d fires, want 2", got)
	}
}

// TestSchedulerGoalNoReplayAfterRestart proves a restart neither re-fires goals
// consumed before it nor loses one consumed just before the process died.
func TestSchedulerGoalNoReplayAfterRestart(t *testing.T) {
	g := newGoalSched(t)
	g.start()
	a := g.goal("proved before restart")
	g.meet(a)
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("first tick: %d fires, want 1", got)
	}

	restarted := newScheduler(g.srv) // same DB, fresh in-memory scheduler
	restarted.init()
	restarted.fireGoals([]*db.AgentTrigger{{AgentKey: "goals", OnGoalMet: true}})
	if got := g.fires(); got != 1 {
		t.Fatalf("restart replayed a consumed goal: %d fires, want 1", got)
	}
}

// TestSchedulerGoalMigratesLegacyFiredSet upgrades a database that still holds the
// legacy unbounded id array: already-consumed goals must not replay, a goal met
// but not yet consumed must still fire, and the legacy blob must be dropped.
func TestSchedulerGoalMigratesLegacyFiredSet(t *testing.T) {
	g := newGoalSched(t)
	consumed := g.goal("consumed before the upgrade")
	g.meet(consumed)
	pending := g.goal("met but not yet consumed")
	g.meet(pending)
	raw, err := json.Marshal([]int64{consumed})
	if err != nil {
		t.Fatal(err)
	}
	if err := g.pg.SetSchedState(schedKeyFiredGoals, string(raw)); err != nil {
		t.Fatal(err)
	}

	g.start()
	if got := g.sc.mustState(schedKeyFiredGoals); got != "" {
		t.Fatalf("legacy fired_goals should be dropped after migration, still %q", got)
	}
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("upgrade must fire only the unconsumed goal: %d fires, want 1", got)
	}
	if g.wm() == "" {
		t.Fatal("watermark must be set after the first post-migration scan")
	}
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("post-migration tick replayed a goal: %d fires, want 1", got)
	}
}

// TestSchedulerGoalSameMillisecondBoundary proves the inclusive scan: a goal whose
// updated_at is exactly the persisted watermark must still fire.
func TestSchedulerGoalSameMillisecondBoundary(t *testing.T) {
	g := newGoalSched(t)
	g.start()
	a := g.goal("first")
	g.meet(a)
	g.tick()
	wm := g.wm()
	if wm == "" {
		t.Fatal("watermark not set")
	}

	b := g.goal("met at exactly the watermark")
	g.setNode(b, "open", "2020-01-01 00:00:00.000") // distinct stamp so the trigger cannot bump it
	g.setNode(b, "met", wm)                         // achieved in the same millisecond as the watermark
	g.tick()
	if got := g.fires(); got != 2 {
		t.Fatalf("goal stamped exactly at the watermark was missed: %d fires, want 2", got)
	}
}

// TestSchedulerGoalFiredSetStaysBounded proves the remembered set follows the scan
// window instead of every goal ever met: goals the watermark has passed and the
// overlap window no longer covers are forgotten, and forgetting them never
// replays a fire.
func TestSchedulerGoalFiredSetStaysBounded(t *testing.T) {
	g := newGoalSched(t)
	g.start()
	var old []int64
	for i := 0; i < 5; i++ {
		id := g.goal(fmt.Sprintf("proved in 2020 #%d", i))
		g.setNode(id, "met", fmt.Sprintf("2020-01-01 00:00:0%d.000", i))
		old = append(old, id)
	}
	g.tick()
	if got := len(g.remembered()); got != 5 {
		t.Fatalf("after the old goals: remembered %d ids, want 5", got)
	}

	for i := 0; i < 10; i++ {
		g.meet(g.goal(fmt.Sprintf("proved now #%d", i)))
	}
	g.tick()
	remembered := g.remembered()
	if len(remembered) != 10 {
		t.Fatalf("remembered set did not shrink to the scan window: %d ids (5 goals from 2020 + 10 new), want 10", len(remembered))
	}
	for _, id := range old {
		if containsID(remembered, id) {
			t.Fatalf("goal %d is far behind the watermark but still remembered", id)
		}
	}
	before := g.fires()
	g.tick()
	if got := g.fires(); got != before {
		t.Fatalf("forgetting a consumed goal replayed it: %d fires, want %d", got, before)
	}
}

// TestSchedulerGoalEditDoesNotRefire covers the one false-positive surface of a
// timestamp watermark: editing an already-met goal touches updated_at and puts it
// back inside the scan window. The remembered id must absorb that.
func TestSchedulerGoalEditDoesNotRefire(t *testing.T) {
	g := newGoalSched(t)
	g.start()
	a := g.goal("original text")
	g.meet(a)
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("first tick: %d fires, want 1", got)
	}
	time.Sleep(3 * time.Millisecond) // force a new millisecond stamp
	if err := g.pg.Exploration(g.exp).UpdateGoalPayload(a, "rewritten text", ""); err != nil {
		t.Fatal(err)
	}
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("editing an already-fired goal notified again: %d fires, want 1", got)
	}
}

// TestSchedulerGoalLostWatermarkDoesNotReplay covers the crash window between
// persisting the consumed set and persisting the watermark: the next tick
// rescans the same window and must find the ids already consumed.
func TestSchedulerGoalLostWatermarkDoesNotReplay(t *testing.T) {
	g := newGoalSched(t)
	g.start()
	a := g.goal("consumed before the crash")
	g.meet(a)
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("first tick: %d fires, want 1", got)
	}
	// Simulate a crash that persisted the consumed set but not the watermark.
	if err := g.pg.SetSchedState(schedKeyGoalWatermark, ""); err != nil {
		t.Fatal(err)
	}
	g.tick()
	if got := g.fires(); got != 1 {
		t.Fatalf("a lost watermark replayed a consumed goal: %d fires, want 1", got)
	}
}
