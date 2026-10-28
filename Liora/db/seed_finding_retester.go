package db

import (
	"database/sql"
	"errors"
)

// EnsureFindingRetesterAgent seeds the editable 「漏洞复测」 agent exactly once.
// The settings flag and the agent/prompt rows commit in one transaction, so a
// failure never leaves a half-seeded agent and the next startup retries. Once
// seeded, user edits/deletion survive restarts; a pre-existing key is kept.
//
// prompt is the code-default template (agent.RetesterDefaultPrompt). It is a
// parameter because agent imports db, so db cannot import agent.
func (d *DB) EnsureFindingRetesterAgent(prompt string) error {
	const flag = "finding_retester_seed_v1"
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	// SQLite transactions acquire the writer reservation at BEGIN IMMEDIATE,
	// so this migration is serialized across server initializations.
	var done string
	err = tx.QueryRow(`SELECT value FROM settings WHERE key=$1`, flag).Scan(&done)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if done == "true" {
		return nil
	}
	var id int64
	err = tx.QueryRow(`INSERT INTO agents(key,name,description,role,builtin,enabled)
	VALUES ($1,'漏洞复测','从漏洞详情手动启动，读取原证据并保存独立复测结论。','assistant',false,true)
	ON CONFLICT (key) DO NOTHING RETURNING id`, FindingRetestAgentKey).Scan(&id)
	if err != nil && !errors.Is(err, sql.ErrNoRows) {
		return err
	}
	if id > 0 {
		var pid int64
		if err = tx.QueryRow(`INSERT INTO agent_prompts(agent_id,version,template_text,note,updated_by)
		VALUES ($1,1,$2,'内置默认','system') RETURNING id`, id, prompt).Scan(&pid); err != nil {
			return err
		}
		if _, err = tx.Exec(`UPDATE agents SET current_prompt_id=$1 WHERE id=$2`, pid, id); err != nil {
			return err
		}
	}
	if _, err = tx.Exec(`INSERT INTO settings(key,value) VALUES ($1,'true') ON CONFLICT(key) DO UPDATE SET value='true'`, flag); err != nil {
		return err
	}
	return tx.Commit()
}
