package db

import (
	"context"
	"database/sql"
	"path/filepath"
	"testing"
	"time"
)

func TestSQLitePersistenceAndConnectionPragmas(t *testing.T) {
	path := filepath.Join(t.TempDir(), "with spaces", "liora.db")
	d, err := Open(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := d.SetSetting("persistence-test", "保留配置"); err != nil {
		t.Fatal(err)
	}
	// Hold two connections so connection-local settings are checked on both.
	c1, err := d.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	c2, err := d.Conn(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	for _, c := range []*sql.Conn{c1, c2} {
		var foreignKeys, timeout int
		var mode string
		if err := c.QueryRowContext(t.Context(), "PRAGMA foreign_keys").Scan(&foreignKeys); err != nil {
			t.Fatal(err)
		}
		if err := c.QueryRowContext(t.Context(), "PRAGMA busy_timeout").Scan(&timeout); err != nil {
			t.Fatal(err)
		}
		if err := c.QueryRowContext(t.Context(), "PRAGMA journal_mode").Scan(&mode); err != nil {
			t.Fatal(err)
		}
		if foreignKeys != 1 || timeout != 15000 || mode != "wal" {
			t.Fatalf("pragmas: fk=%d timeout=%d mode=%s", foreignKeys, timeout, mode)
		}
	}
	c1.Close()
	c2.Close()
	if err := d.Close(); err != nil {
		t.Fatal(err)
	}
	d, err = Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	value, ok, err := d.GetSetting("persistence-test")
	if err != nil || !ok || value != "保留配置" {
		t.Fatalf("reopen: %q %v %v", value, ok, err)
	}
	var result string
	if err := d.QueryRow("PRAGMA integrity_check").Scan(&result); err != nil || result != "ok" {
		t.Fatalf("integrity: %s %v", result, err)
	}
}

func TestSQLiteImmediateTransactionsSerializeReadModifyWrite(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if _, err := d.Exec("CREATE TABLE test_counter(value INTEGER NOT NULL); INSERT INTO test_counter VALUES(0)"); err != nil {
		t.Fatal(err)
	}
	first, err := d.Begin()
	if err != nil {
		t.Fatal(err)
	}
	defer first.Rollback()
	if _, err := first.Exec("UPDATE test_counter SET value=1"); err != nil {
		t.Fatal(err)
	}
	started := make(chan struct{})
	done := make(chan error, 1)
	go func() {
		close(started)
		ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
		defer cancel()
		tx, e := d.BeginTx(ctx, nil)
		if e != nil {
			done <- e
			return
		}
		defer tx.Rollback()
		var n int
		if e = tx.QueryRow("SELECT value FROM test_counter").Scan(&n); e != nil {
			done <- e
			return
		}
		if _, e = tx.Exec("UPDATE test_counter SET value=$1", n+1); e != nil {
			done <- e
			return
		}
		done <- tx.Commit()
	}()
	<-started
	select {
	case err := <-done:
		t.Fatalf("second writer bypassed transaction: %v", err)
	case <-time.After(100 * time.Millisecond):
	}
	if err := first.Commit(); err != nil {
		t.Fatal(err)
	}
	if err := <-done; err != nil {
		t.Fatal(err)
	}
	var n int
	if err := d.QueryRow("SELECT value FROM test_counter").Scan(&n); err != nil || n != 2 {
		t.Fatalf("lost update: %d %v", n, err)
	}
}

func TestSQLiteRollbackAndForeignKeys(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	tx, err := d.Begin()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := tx.Exec("INSERT INTO companies(name,nkey) VALUES('rollback','rollback')"); err != nil {
		t.Fatal(err)
	}
	if err := tx.Rollback(); err != nil {
		t.Fatal(err)
	}
	var n int
	if err := d.QueryRow("SELECT count(*) FROM companies WHERE nkey='rollback'").Scan(&n); err != nil || n != 0 {
		t.Fatalf("rollback: %d %v", n, err)
	}
	_, err = d.Exec("INSERT INTO task_categories(name,nkey) VALUES('one','one'),('two','one')")
	if !IsUniqueViolation(err) {
		t.Fatalf("unique classification: %v", err)
	}
	_, err = d.Exec("INSERT INTO company_scope(company_id,kind,domain,raw) VALUES(-1,'domain','example.test','example.test')")
	if !IsForeignKeyViolation(err) {
		t.Fatalf("foreign key classification: %v", err)
	}
}
