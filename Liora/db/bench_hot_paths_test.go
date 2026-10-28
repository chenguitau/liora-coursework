package db

// 热点查询性能基线。本文件只有基准测试，常规 go test 不会执行（-bench 才运行），
// 也不改变任何生产 SQL 或行为。
//
// 用途：为列表/聚合的四个热点查询留下可复现的 ns/op 与 allocs/op 基线，比较索引
// 增删、SQL 改写或数据规模变化带来的回归：
//   - KindStateCounts      /api/stats 的状态计数（覆盖索引 idx_expnodes_kind_state）
//   - TaskListMetricsAll   任务列表的 token / 目标 / 运行中 intent 聚合
//   - ListFindingsPage     发现列表按 severity 排序的第 1 页（20 条）
//   - FindingGroups        同一数据集按任务分组的第 1 页
//
// 运行方式（-run '^$' 跳过常规测试）：
//   go test ./db -bench 'Benchmark(KindStateCounts|TaskListMetricsAll|ListFindingsPage|FindingGroups)$' -benchmem -run '^$'
//
// 每个 benchmark 都 Open 一个 b.TempDir() 下的独立临时库，互不污染；fixture 用
// 单事务 + 预编译语句批量写入，并在 b.ResetTimer 之前完成，所以计时只覆盖查询
// 本身。数据规模固定（2000 intent / 20 任务 / 5000 发现），便于跨机器、跨提交对比，
// 不要为了跑得快而缩小 fixture。

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"
)

// benchOpen opens a throwaway database in the benchmark's own temp dir. Every
// benchmark gets a fresh file so fixtures never leak between measurements.
func benchOpen(b *testing.B) *DB {
	b.Helper()
	d, err := Open(filepath.Join(b.TempDir(), "bench.db"))
	if err != nil {
		b.Fatalf("open db: %v", err)
	}
	b.Cleanup(func() { d.Close() })
	return d
}

// benchBulkInsert runs query once per row inside a single transaction with one
// prepared statement, so multi-thousand-row fixtures cost one commit instead of
// one per row and stay well inside the benchmark setup budget.
func benchBulkInsert(b *testing.B, d *DB, query string, rows int, args func(i int) []any) {
	b.Helper()
	tx, err := d.Begin()
	if err != nil {
		b.Fatalf("begin: %v", err)
	}
	defer tx.Rollback() //nolint:errcheck
	stmt, err := tx.Prepare(query)
	if err != nil {
		b.Fatalf("prepare: %v", err)
	}
	for i := 0; i < rows; i++ {
		if _, err := stmt.Exec(args(i)...); err != nil {
			b.Fatalf("insert row %d: %v", i, err)
		}
	}
	if err := stmt.Close(); err != nil {
		b.Fatalf("close stmt: %v", err)
	}
	if err := tx.Commit(); err != nil {
		b.Fatalf("commit: %v", err)
	}
}

// BenchmarkKindStateCounts measures the node counters behind /api/stats: one
// exploration holding 2000 intents split evenly across the four live states. With
// idx_expnodes_kind_state the GROUP BY is answered from the covering index (no
// table lookup per row); without it every call reads the slice back from the table.
func BenchmarkKindStateCounts(b *testing.B) {
	const intents = 2000
	states := []string{"open", "running", "paused", "done"}

	start := time.Now()
	d := benchOpen(b)
	expID, err := d.CreateExploration("bench kind/state counts", "状态计数基准")
	if err != nil {
		b.Fatalf("create exploration: %v", err)
	}
	benchBulkInsert(b, d, `INSERT INTO exploration_nodes(exploration_id, kind, payload, state, priority, origin)
VALUES ($1,$2,$3,$4,0,'planner')`, intents, func(i int) []any {
		return []any{expID, KindIntent, `{"summary":"bench intent"}`, states[i%len(states)]}
	})
	b.Logf("setup (1 exploration, %d intents): %s", intents, time.Since(start))

	store := d.Exploration(expID)
	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		counts, err := store.KindStateCounts(KindIntent)
		if err != nil {
			b.Fatal(err)
		}
		if len(counts) != len(states) {
			b.Fatalf("KindStateCounts returned %d states, want %d", len(counts), len(states))
		}
	}
}

// BenchmarkTaskListMetricsAll measures the list aggregate that polls every live
// task: 20 tasks, each with 500 kind='result' activity rows (tokens + last
// activity) plus 10 goal and 10 intent nodes (goal progress, running workers).
func BenchmarkTaskListMetricsAll(b *testing.B) {
	const (
		tasks      = 20
		results    = 500 // kind='result' activity rows per task
		goals      = 10
		intents    = 10
		nodesPerTx = goals + intents
	)

	start := time.Now()
	d := benchOpen(b)
	expIDs := make([]int64, 0, tasks)
	for i := 0; i < tasks; i++ {
		task, err := d.CreateTask(fmt.Sprintf("bench task %d", i), "任务列表聚合基准", nil, 0, 300)
		if err != nil {
			b.Fatalf("create task %d: %v", i, err)
		}
		expIDs = append(expIDs, task.ExplorationID)
	}
	// A distinct, increasing created_at per row keeps "last activity" deterministic.
	base := time.Now().UTC().Add(-time.Duration(tasks*results) * time.Second)
	benchBulkInsert(b, d, `INSERT INTO activity(exploration_id, kind, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens, created_at)
VALUES ($1,'result',10,5,2,1,$2)`, tasks*results, func(i int) []any {
		return []any{expIDs[i/results], base.Add(time.Duration(i) * time.Second)}
	})
	benchBulkInsert(b, d, `INSERT INTO exploration_nodes(exploration_id, kind, payload, state)
VALUES ($1,$2,$3,$4)`, tasks*nodesPerTx, func(i int) []any {
		expID := expIDs[i/nodesPerTx]
		n := i % nodesPerTx
		if n < goals {
			state := "open"
			if n%2 == 0 {
				state = "met"
			}
			return []any{expID, KindGoal, `{"text":"bench goal"}`, state}
		}
		state := "done"
		if n%2 == 0 {
			state = "running"
		}
		return []any{expID, KindIntent, `{"summary":"bench intent"}`, state}
	})
	b.Logf("setup (%d tasks x %d results, %d goals, %d intents): %s",
		tasks, results, goals, intents, time.Since(start))

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		all, err := d.TaskListMetricsAll()
		if err != nil {
			b.Fatal(err)
		}
		if len(all) != tasks {
			b.Fatalf("TaskListMetricsAll returned %d explorations, want %d", len(all), tasks)
		}
	}
}

// seedBenchFindings creates one task holding n findings whose severities cycle
// critical → high → medium → low and whose created_at increases with the row
// index, giving severity ordering a unique, deterministic time tie-breaker.
func seedBenchFindings(b *testing.B, n int) *DB {
	b.Helper()
	start := time.Now()
	d := benchOpen(b)
	task, err := d.CreateTask("bench findings", "发现列表分页基准", nil, 0, 300)
	if err != nil {
		b.Fatalf("create task: %v", err)
	}
	severities := []string{SeverityCritical, SeverityHigh, SeverityMedium, SeverityLow}
	base := time.Now().UTC().Add(-time.Duration(n) * time.Second)
	benchBulkInsert(b, d, `INSERT INTO findings(task_id, vulnclass, name, severity, summary, evidence, worker, created_at)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`, n, func(i int) []any {
		return []any{
			task.ID, "sql_injection", fmt.Sprintf("bench finding %d", i),
			severities[i%len(severities)], fmt.Sprintf("summary %d", i),
			fmt.Sprintf("evidence %d", i), "bench-worker", base.Add(time.Duration(i) * time.Second),
		}
	})
	b.Logf("setup (1 task, %d findings): %s", n, time.Since(start))
	return d
}

// BenchmarkListFindingsPage measures the 发现 page query over 5000 findings in one
// task, ordered by severity and cut to the first 20-row page. Every iteration also
// pays the exact-count query the pager needs.
func BenchmarkListFindingsPage(b *testing.B) {
	const findings = 5000
	d := seedBenchFindings(b, findings)
	filter := FindingFilter{Sort: "severity"}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		items, total, err := d.ListFindingsPage(filter, 1, 20)
		if err != nil {
			b.Fatal(err)
		}
		if total != findings || len(items) != 20 {
			b.Fatalf("ListFindingsPage returned %d/%d findings, want 20/%d", len(items), total, findings)
		}
	}
}

// BenchmarkFindingGroups measures the grouped 发现 view over the same dataset as
// BenchmarkListFindingsPage: one task bucket holding all 5000 findings, ordered by
// severity, first page. It pays both the group count and the finding count.
func BenchmarkFindingGroups(b *testing.B) {
	const findings = 5000
	d := seedBenchFindings(b, findings)
	filter := FindingFilter{Sort: "severity"}

	b.ReportAllocs()
	b.ResetTimer()
	for i := 0; i < b.N; i++ {
		groups, groupTotal, findingTotal, err := d.ListFindingGroups(filter, 1, 20)
		if err != nil {
			b.Fatal(err)
		}
		if groupTotal != 1 || findingTotal != findings || len(groups) != 1 {
			b.Fatalf("ListFindingGroups returned %d/%d groups, %d findings, want 1/1/%d",
				len(groups), groupTotal, findingTotal, findings)
		}
	}
}
