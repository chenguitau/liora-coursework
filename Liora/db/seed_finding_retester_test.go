package db

import "testing"

func TestEnsureFindingRetesterAgentSeedsOnce(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("open test database: %v", err)
	}
	defer d.Close()
	const prompt = "内置复测提示词"
	if err := d.EnsureFindingRetesterAgent(prompt); err != nil {
		t.Fatalf("first ensure: %v", err)
	}
	a, err := d.GetAgentByKey(FindingRetestAgentKey)
	if err != nil {
		t.Fatal(err)
	}
	if a == nil {
		t.Fatal("retester agent missing after first ensure")
	}
	if a.Builtin || !a.Enabled || a.Role != "assistant" {
		t.Fatalf("unexpected agent row: builtin=%v enabled=%v role=%s", a.Builtin, a.Enabled, a.Role)
	}
	var template string
	if err := d.QueryRow(`SELECT p.template_text FROM agent_prompts p JOIN agents a ON a.current_prompt_id=p.id WHERE a.key=$1`, FindingRetestAgentKey).Scan(&template); err != nil {
		t.Fatalf("current prompt: %v", err)
	}
	if template != prompt {
		t.Fatalf("prompt = %q, want %q", template, prompt)
	}
	if value, ok, err := d.GetSetting("finding_retester_seed_v1"); err != nil || !ok || value != "true" {
		t.Fatalf("seed flag = %q ok=%v err=%v", value, ok, err)
	}
	counts := func() (agents, prompts int) {
		t.Helper()
		if err := d.QueryRow(`SELECT count(*) FROM agents WHERE key=$1`, FindingRetestAgentKey).Scan(&agents); err != nil {
			t.Fatal(err)
		}
		if err := d.QueryRow(`SELECT count(*) FROM agent_prompts WHERE agent_id=$1`, a.ID).Scan(&prompts); err != nil {
			t.Fatal(err)
		}
		return agents, prompts
	}
	if agents, prompts := counts(); agents != 1 || prompts != 1 {
		t.Fatalf("after first ensure: agents=%d prompts=%d", agents, prompts)
	}

	// A second startup is a no-op: no duplicate agent/prompt rows and no
	// overwrite of the prompt the user may have edited.
	if _, err := d.SavePrompt(a.ID, "用户改过的提示词", "test", "test"); err != nil {
		t.Fatal(err)
	}
	if err := d.EnsureFindingRetesterAgent(prompt); err != nil {
		t.Fatalf("second ensure: %v", err)
	}
	if agents, prompts := counts(); agents != 1 || prompts != 2 {
		t.Fatalf("after second ensure: agents=%d prompts=%d", agents, prompts)
	}
	if err := d.QueryRow(`SELECT p.template_text FROM agent_prompts p JOIN agents a ON a.current_prompt_id=p.id WHERE a.key=$1`, FindingRetestAgentKey).Scan(&template); err != nil {
		t.Fatalf("current prompt after second ensure: %v", err)
	}
	if template != "用户改过的提示词" {
		t.Fatalf("second ensure overwrote prompt: %q", template)
	}

	// Once seeded, a user deletion also survives restarts (the flag stays set).
	if err := d.DeleteAgent(FindingRetestAgentKey); err != nil {
		t.Fatal(err)
	}
	if err := d.EnsureFindingRetesterAgent(prompt); err != nil {
		t.Fatalf("ensure after delete: %v", err)
	}
	if a, err := d.GetAgentByKey(FindingRetestAgentKey); err != nil || a != nil {
		t.Fatalf("deleted retester recreated: agent=%v err=%v", a, err)
	}
}
