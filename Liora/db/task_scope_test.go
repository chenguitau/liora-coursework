package db

import (
	"fmt"
	"testing"
)

// TestStripHostPort covers the ip:port / [ipv6]:port stripping used by the
// ip/cidr scope path so a target like "10.0.188.136:3000" no longer 404s.
func TestStripHostPort(t *testing.T) {
	cases := []struct{ in, want string }{
		{"10.0.188.136:3000", "10.0.188.136"},       // the reported IP case
		{"10.0.188.136", "10.0.188.136"},            // bare IPv4 unchanged
		{"[2001:db8::1]:8080", "2001:db8::1"},       // bracketed IPv6 + port
		{"2001:db8::1", "2001:db8::1"},              // bare IPv6 unchanged (has colons)
		{" 1.2.3.4:80 ", "1.2.3.4"},                 // trims surrounding space
		{"example.com:443", "example.com"},          // domain + port → bare host
		{"api.example.com:8080", "api.example.com"}, // subdomain + port
		{"example.com", "example.com"},              // bare domain unchanged
	}
	for _, c := range cases {
		if got := stripHostPort(c.in); got != c.want {
			t.Errorf("stripHostPort(%q) = %q, want %q", c.in, got, c.want)
		}
	}
}

// TestBuildCoverageGraphConnectors covers the connector nodes BuildCoverageGraph
// adds outside its single asset query: a synthetic "r:<domain>" root for a
// subdomain whose root-domain row does not exist, and a company node carrying the
// real name. Both are resolved in batch, so this guards the batching against the
// per-row lookups it replaced.
func TestBuildCoverageGraphConnectors(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	task, err := d.CreateTask("coverage graph connectors", "goal", nil, 0, 0)
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = d.DeleteTask(task.ID) })

	companies := d.Companies()
	nameA := fmt.Sprintf("Graph Co A %d", task.ID)
	nameB := fmt.Sprintf("Graph Co B %d", task.ID)
	companyA, _, err := companies.UpsertCompany(nameA, "")
	if err != nil {
		t.Fatal(err)
	}
	companyB, _, err := companies.UpsertCompany(nameB, "")
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		_ = companies.DeleteCompany(companyA)
		_ = companies.DeleteCompany(companyB)
	})

	rootA := fmt.Sprintf("graph-a-%d.invalid", task.ID)
	rootB := fmt.Sprintf("graph-b-%d.invalid", task.ID)
	assets := d.Assets()
	for _, item := range []struct {
		sub, root string
		company   int64
	}{
		{"www." + rootA, rootA, companyA},
		{"www." + rootB, rootB, companyB},
	} {
		// Inserted directly: UpsertSubdomain would create the root-domain row,
		// and the graph must synthesize the connector when it is missing.
		if _, err := d.Exec(`INSERT INTO assets(type, domain, root_domain, company_id, company_source, task_ids)
VALUES ('subdomain', $1, $2, $3, 'explicit', json_array($4))`, item.sub, item.root, item.company, task.ID); err != nil {
			t.Fatalf("insert subdomain %s: %v", item.sub, err)
		}
		if _, err := assets.AddAgentScope(task.ID, "root_domain", item.root, "test", "agent"); err != nil {
			t.Fatalf("scope %s: %v", item.root, err)
		}
	}

	graph, err := assets.BuildCoverageGraph(task.ID, task.ExplorationID)
	if err != nil {
		t.Fatalf("BuildCoverageGraph: %v", err)
	}
	byKey := map[string]CoverageGraphNode{}
	for _, node := range graph.Nodes {
		byKey[node.Key] = node
	}
	for _, root := range []string{rootA, rootB} {
		node, ok := byKey["r:"+root]
		if !ok {
			t.Fatalf("synthetic root %q missing from graph: %+v", root, graph.Nodes)
		}
		if node.Kind != "root_domain" || node.Label != root || node.AssetID != 0 || node.InScope {
			t.Fatalf("synthetic root %q = %+v", root, node)
		}
	}
	for _, want := range []struct {
		key, label string
	}{
		{companyKey(companyA), nameA},
		{companyKey(companyB), nameB},
	} {
		node, ok := byKey[want.key]
		if !ok {
			t.Fatalf("company node %q missing from graph: %+v", want.key, graph.Nodes)
		}
		if node.Kind != "company" || node.Label != want.label || node.InScope {
			t.Fatalf("company node %q = %+v", want.key, node)
		}
	}
	if len(graph.Edges) == 0 {
		t.Fatalf("expected containment edges, got none: %+v", graph.Nodes)
	}
}
