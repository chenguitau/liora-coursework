package main

import (
	"bufio"
	"database/sql"
	"fmt"
	"io"
	"net/url"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/crypto/bcrypt"
	_ "modernc.org/sqlite"
)

// resetAdminPassword changes only the password setting in an existing database.
// Reading stdin keeps the password out of process arguments and environment.
func resetAdminPassword(path string, input io.Reader) error {
	info, err := os.Stat(path)
	if err != nil || info.IsDir() {
		return fmt.Errorf("数据库文件不存在：%s", path)
	}
	scanner := bufio.NewScanner(io.LimitReader(input, 1024))
	if !scanner.Scan() {
		return fmt.Errorf("请通过标准输入提供新密码")
	}
	password := scanner.Text()
	if len(password) < 8 || len(password) > 72 {
		return fmt.Errorf("密码必须为 8–72 字节")
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}
	abs, err := filepath.Abs(path)
	if err != nil {
		return err
	}
	filePath := filepath.ToSlash(abs)
	if !strings.HasPrefix(filePath, "/") {
		filePath = "/" + filePath
	}
	u := url.URL{Scheme: "file", Path: filePath}
	q := url.Values{"mode": {"rw"}, "_pragma": {"busy_timeout(15000)"}}
	u.RawQuery = q.Encode()
	database, err := sql.Open("sqlite", u.String())
	if err != nil {
		return err
	}
	defer database.Close()
	_, err = database.Exec(`INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value`, "auth.password_hash", string(hash))
	return err
}
