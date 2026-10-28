package db

import (
	"strings"
	"testing"
)

// explainQueryPlan returns the plan of query, binding args (if any) exactly as the
// caller would. Binding does not influence plan selection — SQLite decides at
// prepare time — so parameterised statements can be explained without rewriting them.
func explainQueryPlan(t *testing.T, d *DB, query string, args ...any) string {
	t.Helper()
	rows, err := d.Query("EXPLAIN QUERY PLAN "+query, args...)
	if err != nil {
		t.Fatalf("explain query plan: %v", err)
	}
	defer rows.Close()
	details := []string{}
	for rows.Next() {
		var id, parent, notUsed int
		var detail string
		if err := rows.Scan(&id, &parent, &notUsed, &detail); err != nil {
			t.Fatal(err)
		}
		details = append(details, detail)
	}
	if err := rows.Err(); err != nil {
		t.Fatal(err)
	}
	return strings.Join(details, "\n")
}

// TestAggregationQueriesUseIndexes pins the access path of the two dashboard
// aggregations: without idx_act_kind_created / idx_llm_usage_ts they degrade to a
// full scan as the tables grow, and a dropped or misnamed index must fail loudly.
func TestAggregationQueriesUseIndexes(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()
	if err := d.EnsureLLMUsageTable(); err != nil {
		t.Fatal(err)
	}

	activityPlan := explainQueryPlan(t, d, `
		SELECT strftime('%Y-%m-%d',created_at) AS day,
		       COALESCE(SUM(input_tokens), 0),
		       COALESCE(SUM(output_tokens), 0),
		       COALESCE(SUM(cache_read_tokens), 0)
		FROM activity
		WHERE kind = 'result'
		  AND created_at >= strftime('%Y-%m-%d %H:%M:%f','now','-30 days')
		GROUP BY day
		ORDER BY day`)
	t.Logf("TokenDailyAll plan:\n%s", activityPlan)
	if !strings.Contains(activityPlan, "idx_act_kind_created") {
		t.Fatalf("TokenDailyAll plan does not use idx_act_kind_created:\n%s", activityPlan)
	}

	usagePlan := explainQueryPlan(t, d, `
		SELECT COALESCE(profile_name,'') AS profile_name,
		       strftime('%Y-%m-%d',ts) AS day,
		       COALESCE(SUM(input_tokens),0), COALESCE(SUM(output_tokens),0), COALESCE(SUM(cache_read),0)
		FROM llm_usage
		WHERE ts >= datetime('now', printf('-%d days', 30))
		GROUP BY profile_name, day
		ORDER BY day`)
	t.Logf("UsageDaily plan:\n%s", usagePlan)
	if !strings.Contains(usagePlan, "idx_llm_usage_ts") {
		t.Fatalf("UsageDaily plan does not use idx_llm_usage_ts:\n%s", usagePlan)
	}
}

// TestKindStateCountsUsesCoveringIndex pins the access path of KindStateCounts:
// idx_expnodes_kind_state carries state after (exploration_id, kind), so the GROUP BY
// is answered from the index itself instead of one table lookup per matching row.
// The table is seeded because SQLite may prefer a scan of an empty table, and the
// plan is taken over the exact statement production runs.
func TestKindStateCountsUsesCoveringIndex(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()

	expID, err := d.CreateExploration("counts-plan", "覆盖索引计划")
	if err != nil {
		t.Fatal(err)
	}
	store := d.Exploration(expID)
	states := []string{"open", "running", "paused", "done"}
	for i := 0; i < 32; i++ {
		if _, err := store.AddNode(KindIntent, map[string]any{"summary": "plan"}, 1, states[i%len(states)], "planner", nil); err != nil {
			t.Fatalf("add node %d: %v", i, err)
		}
	}

	plan := explainQueryPlan(t, d, kindStateCountsSQL, expID, KindIntent)
	t.Logf("KindStateCounts plan:\n%s", plan)
	if !strings.Contains(plan, "idx_expnodes_kind_state") {
		t.Fatalf("KindStateCounts plan does not use idx_expnodes_kind_state:\n%s", plan)
	}
	if !strings.Contains(plan, "COVERING INDEX") {
		t.Fatalf("KindStateCounts plan is not index-only:\n%s", plan)
	}
}

// TestEnsureQueryIndexesRecreatesOnOpen covers databases created before these
// indexes existed: schema.sql is never replayed, so only the per-open hook can add
// them. Dropping an index and reopening must restore it.
func TestEnsureQueryIndexesRecreatesOnOpen(t *testing.T) {
	for _, index := range []string{"idx_act_kind_created", "idx_expnodes_kind_state"} {
		t.Run(index, func(t *testing.T) {
			path := testDSN(t)
			d, err := Open(path)
			if err != nil {
				t.Fatalf("SQLite unavailable (%v) — skipping", err)
			}
			if _, err := d.Exec("DROP INDEX IF EXISTS " + index); err != nil {
				d.Close()
				t.Fatal(err)
			}
			if err := d.Close(); err != nil {
				t.Fatal(err)
			}

			d, err = Open(path)
			if err != nil {
				t.Fatal(err)
			}
			defer d.Close()
			var count int
			if err := d.QueryRow(`SELECT count(*) FROM sqlite_master WHERE type='index' AND name=?`, index).Scan(&count); err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Fatalf("%s was not recreated on open (count=%d)", index, count)
			}
		})
	}
}
