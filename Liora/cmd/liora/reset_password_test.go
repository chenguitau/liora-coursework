package main

import (
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/crypto/bcrypt"
	"liora/db"
)

func TestResetPasswordPreservesExistingBusinessData(t *testing.T) {
	path := filepath.Join(t.TempDir(), "liora.db")
	d, err := db.Open(path)
	if err != nil {
		t.Fatal(err)
	}
	defer d.Close()
	if err := d.SetSetting("business.sentinel", "keep"); err != nil {
		t.Fatal(err)
	}
	if err := resetAdminPassword(path, strings.NewReader("new-test-password\n")); err != nil {
		t.Fatal(err)
	}
	hash, _, err := d.GetSetting("auth.password_hash")
	if err != nil || bcrypt.CompareHashAndPassword([]byte(hash), []byte("new-test-password")) != nil {
		t.Fatal("password was not updated")
	}
	if got, _, _ := d.GetSetting("business.sentinel"); got != "keep" {
		t.Fatal("unrelated data changed")
	}
	if err := resetAdminPassword(path, strings.NewReader("short\n")); err == nil {
		t.Fatal("short password accepted")
	}
	if got, _, _ := d.GetSetting("auth.password_hash"); got != hash {
		t.Fatal("failed reset changed hash")
	}
	if err := resetAdminPassword(filepath.Join(t.TempDir(), "missing.db"), strings.NewReader("new-test-password\n")); err == nil {
		t.Fatal("missing database accepted")
	}
}
