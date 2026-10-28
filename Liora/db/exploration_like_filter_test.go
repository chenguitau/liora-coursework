package db

import "testing"

// The keyword filter is a substring search, so LIKE metacharacters typed by a
// user must match literally: searching "100%" has to find the summary that says
// "100%", not every summary starting with "100". Both the page query and the
// total count must agree, otherwise the pager shows an empty page with a
// non-zero total.
func TestListByKindPageFilteredTreatsWildcardsLiterally(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	expID, err := d.CreateExploration("like filter", "goal")
	if err != nil {
		t.Fatal(err)
	}
	defer d.Exec("DELETE FROM explorations WHERE id=$1", expID)
	es := d.Exploration(expID)

	for _, summary := range []string{"coverage 100% done", "coverage 1000 done", "id_a ok", "idxa ok"} {
		if _, err := es.AddNode(KindFact, map[string]any{"summary": summary}, 0, "confirmed", "worker", nil); err != nil {
			t.Fatal(err)
		}
	}

	cases := []struct {
		q    string
		want int
	}{
		{"", 4},     // no filter
		{"100", 2},  // ordinary keyword: plain substring
		{"100%", 1}, // % is literal, not "anything after 100"
		{"_", 1},    // _ is literal, not "any single character"
		{"id_a", 1}, // underscore in an ordinary keyword
		{"id%a", 0}, // % must not bridge id and a
		{"\\", 0},   // backslash is literal too
	}
	for _, c := range cases {
		nodes, _, total, err := es.ListByKindPageWithSources(KindFact, 0, 50, c.q)
		if err != nil {
			t.Fatalf("q=%q: %v", c.q, err)
		}
		if len(nodes) != c.want || total != c.want {
			t.Errorf("q=%q: page has %d rows, total %d, want %d", c.q, len(nodes), total, c.want)
		}
	}
}
