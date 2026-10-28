package db

// schedulerGoalMetIndexSQL indexes the scheduler's incremental "which goals were
// met at/after the watermark" scan. schema.sql is applied only when a database is
// created (PRAGMA user_version 0), so an index added afterwards never reaches an
// existing database by replaying the schema; creating it on every open is
// additive, idempotent and rewrites no table data.
//
// Rollback: DROP INDEX IF EXISTS idx_expnodes_goal_met_wm (an old binary ignores
// the extra index).
const schedulerGoalMetIndexSQL = `CREATE INDEX IF NOT EXISTS idx_expnodes_goal_met_wm
ON exploration_nodes(updated_at) WHERE kind='goal' AND state='met'`

// activityKindCreatedIndexSQL serves TokenDailyAll (db/exploration.go), which
// aggregates every kind='result' row in a created_at window. All other activity
// indexes lead with exploration_id, so that global window scan had no usable path.
// Like the scheduler index it is re-ensured on every open: schema.sql only runs for a
// brand-new database, and CREATE INDEX IF NOT EXISTS is additive and rewrites no data.
//
// Rollback: DROP INDEX IF EXISTS idx_act_kind_created.
const activityKindCreatedIndexSQL = `CREATE INDEX IF NOT EXISTS idx_act_kind_created
ON activity(kind, created_at)`

// expNodesKindStateIndexSQL serves KindStateCounts (db/exploration.go), which groups
// the states of one (exploration_id, kind) slice. idx_expnodes_part stops at the row
// lookup, leaving state to be read from the table for every match; this index carries
// state as a trailing key column, so the aggregation is answered from the index alone
// and in state order. schema.sql is only replayed for a brand-new database, so it is
// also re-ensured here on every open (CREATE INDEX IF NOT EXISTS is additive).
//
// Rollback: DROP INDEX IF EXISTS idx_expnodes_kind_state.
const expNodesKindStateIndexSQL = `CREATE INDEX IF NOT EXISTS idx_expnodes_kind_state
ON exploration_nodes(exploration_id, kind, state)`

// llmUsageTSIndexSQL serves UsageDaily (db/llm_usage.go), which filters the whole
// ledger by ts. llm_usage is created lazily by EnsureLLMUsageTable and is therefore
// absent from schema.sql; the index is declared in that table's DDL too. EnsureQueryIndexes
// creates it here only once the ledger exists, so Open never fails on a database that
// predates it.
//
// Rollback: DROP INDEX IF EXISTS idx_llm_usage_ts.
const llmUsageTSIndexSQL = `CREATE INDEX IF NOT EXISTS idx_llm_usage_ts ON llm_usage(ts)`

// EnsureSchedulerIndexes creates the scheduler's partial index (idempotent; a
// no-op once the index exists).
func (d *DB) EnsureSchedulerIndexes() error {
	_, err := d.Exec(schedulerGoalMetIndexSQL)
	return err
}

// EnsureQueryIndexes creates the read-path indexes that post-date the v1 schema, on
// every open: existing databases never replay schema.sql, and a missing index only
// slows the aggregation queries down rather than changing their results.
func (d *DB) EnsureQueryIndexes() error {
	if _, err := d.Exec(activityKindCreatedIndexSQL); err != nil {
		return err
	}
	if _, err := d.Exec(expNodesKindStateIndexSQL); err != nil {
		return err
	}
	// llm_usage may not exist yet: EnsureLLMUsageTable creates it (with its indexes)
	// on the first metering-capable start.
	var hasUsageTable bool
	if err := d.QueryRow(`SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='llm_usage')`).Scan(&hasUsageTable); err != nil {
		return err
	}
	if !hasUsageTable {
		return nil
	}
	_, err := d.Exec(llmUsageTSIndexSQL)
	return err
}
