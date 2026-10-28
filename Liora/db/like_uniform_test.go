package db

import "testing"

// Three call sites filter user text with LIKE: FindingFilter.where, the
// exploration node keyword filter and the chat-mention search. They must agree
// on what a keyword means, so the same corpus and the same keywords must yield
// the same hit counts everywhere. A call site that loses its ESCAPE clause (or
// its escaping) drops out of line here instead of silently returning the wrong
// rows.
func TestLikeEscapingIsUniformAcrossCallSites(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	texts := []string{
		"likepin 100% done",
		"likepin 1000 done",
		"likepin id_a co",
		"likepin idxa co",
	}
	expID, err := d.CreateExploration("like uniform", "goal")
	if err != nil {
		t.Fatal(err)
	}
	es := d.Exploration(expID)
	for i, text := range texts {
		if _, err := d.AddFinding(0, 0, "xss", text, "low", text, "", "test", nil); err != nil {
			t.Fatal(err)
		}
		if _, err := es.AddNode(KindFact, map[string]any{"summary": text}, 0, "confirmed", "worker", nil); err != nil {
			t.Fatal(err)
		}
		if _, err := d.Exec("INSERT INTO companies(name,nkey) VALUES($1,$2)", text, "likepin-"+string(rune('a'+i))); err != nil {
			t.Fatal(err)
		}
	}

	sites := []struct {
		name  string
		count func(q string) int
	}{
		{"findings", func(q string) int {
			_, total, err := d.ListFindingsPage(FindingFilter{Query: q}, 1, 100)
			if err != nil {
				t.Fatalf("findings %q: %v", q, err)
			}
			return total
		}},
		{"exploration", func(q string) int {
			_, _, total, err := es.ListByKindPageWithSources(KindFact, 0, 100, q)
			if err != nil {
				t.Fatalf("exploration %q: %v", q, err)
			}
			return total
		}},
		{"mentions", func(q string) int {
			items, err := d.SearchChatMentions(t.Context(), "company", q)
			if err != nil {
				t.Fatalf("mentions %q: %v", q, err)
			}
			return len(items)
		}},
	}

	cases := []struct {
		query string
		want  int
	}{
		{"likepin", 4},      // no wildcard: every row
		{"likepin 100", 2},  // ordinary substring
		{"likepin 100%", 1}, // % literal
		{"likepin id_a", 1}, // _ literal
		{"likepin id%a", 0}, // % must not bridge id and a
		{"likepin none", 0}, // no match
	}
	for _, c := range cases {
		for _, site := range sites {
			if got := site.count(c.query); got != c.want {
				t.Errorf("%s: search %q matched %d rows, want %d", site.name, c.query, got, c.want)
			}
		}
	}
}
