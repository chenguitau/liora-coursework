package db

import "testing"

// TestSetSettingsIsAtomic verifies the multi-key write applies every pair on success
// and none of them when one statement fails — the judge configuration depends on it.
func TestSetSettingsIsAtomic(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) — skipping", err)
	}
	defer d.Close()

	if err := d.SetSetting("existing", "old"); err != nil {
		t.Fatal(err)
	}
	if err := d.SetSettings(map[string]string{
		"existing": "new",
		"fresh-a":  "1",
		"fresh-b":  "2",
	}); err != nil {
		t.Fatal(err)
	}
	for key, want := range map[string]string{"existing": "new", "fresh-a": "1", "fresh-b": "2"} {
		got, ok, err := d.GetSetting(key)
		if err != nil || !ok || got != want {
			t.Fatalf("setting %q: want %q, got (%q,%v,%v)", key, want, got, ok, err)
		}
	}

	// A failure on the second pair must undo the first one: no half-written config.
	if _, err := d.Exec(`CREATE TRIGGER fail_settings BEFORE INSERT ON settings
WHEN NEW.key = 'fresh-bad'
BEGIN SELECT RAISE(ABORT, 'settings write blocked'); END`); err != nil {
		t.Fatal(err)
	}
	if err := d.SetSettings(map[string]string{
		"fresh-good": "written",
		"fresh-bad":  "rejected",
	}); err == nil {
		t.Fatal("SetSettings swallowed the injected failure")
	}
	for _, key := range []string{"fresh-good", "fresh-bad"} {
		if _, ok, err := d.GetSetting(key); err != nil {
			t.Fatal(err)
		} else if ok {
			t.Fatalf("setting %q survived a rolled-back batch", key)
		}
	}
	if err := d.SetSetting("existing", "still-works"); err != nil {
		t.Fatalf("single-key upsert after rollback: %v", err)
	}
}
