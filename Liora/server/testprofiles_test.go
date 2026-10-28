package server

import "testing"

// clearLLMProfiles empties the shared test database's profile table. Tests in
// this package share one SQLite file (TestMain), so a profile left active by one
// test changes the behaviour of every later test that resolves an LLM: goal
// seeding stops being a no-op and starts attempting a real provider call.
//
// The active profile cannot be deleted directly, so the default flag is cleared
// first — the same dance chat_llm_resolve_test.go performs inline.
func clearLLMProfiles(t *testing.T, m *Manager) {
	t.Helper()
	profiles, err := m.pg.ListProfiles()
	if err != nil {
		t.Fatalf("list llm profiles: %v", err)
	}
	for _, p := range profiles {
		if p.IsDefault {
			_, _ = m.pg.Exec(`UPDATE llm_profiles SET is_default=false WHERE id=$1`, p.ID)
		}
		_ = m.pg.DeleteProfile(p.ID)
	}
}
