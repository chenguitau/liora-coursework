package db

import (
	"fmt"
	"testing"
)

// TestDeleteByIDsHandlesLargeBatch pins the json_each rewrite: 1000 IDs in one
// call must delete all rows instead of hitting SQLite's bind-variable limit.
func TestDeleteByIDsHandlesLargeBatch(t *testing.T) {
	d, av2, _ := testSetup(t)
	defer d.Close()

	const n = 1000
	ids := make([]int64, 0, n)
	for i := 0; i < n; i++ {
		var id int64
		domain := fmt.Sprintf("bulk-delete-%d.example", i)
		if err := d.QueryRow(`INSERT INTO assets(type, domain, root_domain) VALUES ('root_domain',$1,$1) RETURNING id`, domain).Scan(&id); err != nil {
			t.Fatal(err)
		}
		ids = append(ids, id)
	}

	deleted, err := av2.DeleteByIDs(ids)
	if err != nil {
		t.Fatalf("delete %d ids: %v", n, err)
	}
	if deleted != n {
		t.Fatalf("want %d rows deleted, got %d", n, deleted)
	}
	var remaining int
	if err := d.QueryRow(`SELECT count(*) FROM assets WHERE id IN (SELECT value FROM json_each($1))`, ids).Scan(&remaining); err != nil {
		t.Fatal(err)
	}
	if remaining != 0 {
		t.Fatalf("want 0 remaining rows, got %d", remaining)
	}
}
