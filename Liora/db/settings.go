package db

import (
	"database/sql"
	"sort"
)

// Settings is a tiny key-value store for global app config the UI toggles at
// runtime (e.g. traffic_capture). Missing keys fall back to caller defaults.

// GetSetting returns the stored value and ok=false when the key is unset.
func (d *DB) GetSetting(key string) (value string, ok bool, err error) {
	err = d.QueryRow(`SELECT value FROM settings WHERE key=$1`, key).Scan(&value)
	if err == sql.ErrNoRows {
		return "", false, nil
	}
	if err != nil {
		return "", false, err
	}
	return value, true, nil
}

// settingUpsertSQL is the one upsert statement shared by SetSetting and SetSettings,
// so the single-key and multi-key paths keep identical conflict semantics.
const settingUpsertSQL = `
INSERT INTO settings(key, value) VALUES ($1, $2)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = strftime('%Y-%m-%d %H:%M:%f','now')`

// SetSetting upserts a setting value.
func (d *DB) SetSetting(key, value string) error {
	_, err := d.Exec(settingUpsertSQL, key, value)
	return err
}

// SetSettings upserts several settings atomically: either every pair is applied or
// none is. Configuration spread over multiple keys (e.g. the interception judge) must
// be written this way — a failure halfway through would otherwise leave a mix of new
// and old values that no reader can interpret. Keys are written in sorted order so
// statement order is deterministic.
func (d *DB) SetSettings(pairs map[string]string) error {
	if len(pairs) == 0 {
		return nil
	}
	keys := make([]string, 0, len(pairs))
	for key := range pairs {
		keys = append(keys, key)
	}
	sort.Strings(keys)
	tx, err := d.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback() //nolint:errcheck
	for _, key := range keys {
		if _, err := tx.Exec(settingUpsertSQL, key, pairs[key]); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// GetBool returns the boolean setting, or def when unset/unparseable.
func (d *DB) GetBool(key string, def bool) bool {
	v, ok, err := d.GetSetting(key)
	if err != nil || !ok {
		return def
	}
	return v == "true" || v == "1"
}

// SetBool stores a boolean setting as "true"/"false".
func (d *DB) SetBool(key string, val bool) error {
	if val {
		return d.SetSetting(key, "true")
	}
	return d.SetSetting(key, "false")
}
