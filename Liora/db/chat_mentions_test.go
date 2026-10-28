package db

import (
	"strings"
	"testing"
)

// The mention search escapes %, _ and backslash before building the LIKE
// pattern, but the query had no ESCAPE clause, so SQLite treated the backslash
// as an ordinary character: the pattern for "100%" was "%100\%%", which matches
// the literal text "100\%" and therefore nothing at all. Keywords containing a
// wildcard silently returned an empty catalog.
func TestSearchChatMentionsTreatsWildcardsLiterally(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	rows := [][2]string{
		{"mentpct 100% done", "mentpct-a"},
		{"mentpct 1000 done", "mentpct-b"},
		{"mentus id_a co", "mentus-a"},
		{"mentus idxa co", "mentus-b"},
	}
	for _, r := range rows {
		if _, err := d.Exec("INSERT INTO companies(name,nkey) VALUES($1,$2)", r[0], r[1]); err != nil {
			t.Fatal(err)
		}
	}

	// Count only this test's rows so seeded/other companies can't skew the result.
	count := func(query, prefix string) int {
		t.Helper()
		items, err := d.SearchChatMentions(t.Context(), "company", query)
		if err != nil {
			t.Fatalf("search %q: %v", query, err)
		}
		n := 0
		for _, item := range items {
			if strings.HasPrefix(item.Label, prefix) {
				n++
			}
		}
		return n
	}

	cases := []struct {
		query, prefix string
		want          int
	}{
		{"mentpct 100%", "mentpct", 1}, // % is literal, not "anything after 100"
		{"mentus id_a", "mentus", 1},   // _ is literal, not "any single character"
		{"mentus id%a", "mentus", 0},   // % must not bridge id and a
		{"mentpct 100", "mentpct", 2},  // ordinary keyword: unchanged
		{"mentpct", "mentpct", 2},      // ordinary keyword: unchanged
	}
	for _, c := range cases {
		if got := count(c.query, c.prefix); got != c.want {
			t.Errorf("search %q matched %d rows, want %d", c.query, got, c.want)
		}
	}
}
