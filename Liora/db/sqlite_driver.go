package db

import (
	"context"
	"database/sql"
	"database/sql/driver"
	"encoding/json"
	"reflect"
	"time"
)

// Business arrays/documents are JSON TEXT, and timestamps are UTC. Keeping
// argument encoding at the driver boundary applies equally to transactions and
// prepared statements. SQL itself is native SQLite, without runtime rewriting.
type localDriver struct{ driver.Driver }
type localConn struct{ driver.Conn }
type localRows struct{ driver.Rows }

func (r *localRows) ColumnTypeDatabaseTypeName(i int) string {
	if types, ok := r.Rows.(driver.RowsColumnTypeDatabaseTypeName); ok {
		return types.ColumnTypeDatabaseTypeName(i)
	}
	return ""
}

// database/sql can scan byte strings into both string and json.RawMessage;
// plain driver strings cannot be assigned to the latter named byte-slice type.
func (r *localRows) Next(values []driver.Value) error {
	if err := r.Rows.Next(values); err != nil {
		return err
	}
	for i, v := range values {
		if s, ok := v.(string); ok {
			values[i] = []byte(s)
		}
	}
	return nil
}

func init() {
	base, err := sql.Open("sqlite", ":memory:")
	if err != nil {
		panic(err)
	}
	sql.Register("liora-sqlite", &localDriver{base.Driver()})
	base.Close()
}

func (d *localDriver) Open(name string) (driver.Conn, error) {
	c, err := d.Driver.Open(name)
	if err != nil {
		return nil, err
	}
	return &localConn{c}, nil
}

func (c *localConn) CheckNamedValue(v *driver.NamedValue) error {
	if v.Value == nil {
		return nil
	}
	r := reflect.ValueOf(v.Value)
	for r.Kind() == reflect.Pointer {
		if r.IsNil() {
			v.Value = nil
			return nil
		}
		r = r.Elem()
	}
	value := r.Interface()
	if t, ok := value.(time.Time); ok {
		v.Value = t.UTC().Format("2006-01-02 15:04:05.999999999")
		return nil
	}
	switch b := value.(type) {
	case json.RawMessage:
		v.Value = string(b)
		return nil
	case []byte:
		v.Value = string(b)
		return nil
	}
	if r.Kind() == reflect.Slice || r.Kind() == reflect.Array {
		if r.Kind() == reflect.Slice && r.IsNil() {
			v.Value = "[]"
			return nil
		}
		b, err := json.Marshal(value)
		if err != nil {
			return err
		}
		v.Value = string(b)
		return nil
	}
	return driver.ErrSkip
}

func (c *localConn) BeginTx(ctx context.Context, opts driver.TxOptions) (driver.Tx, error) {
	return c.Conn.(driver.ConnBeginTx).BeginTx(ctx, opts)
}
func (c *localConn) ExecContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Result, error) {
	return c.Conn.(driver.ExecerContext).ExecContext(ctx, q, args)
}
func (c *localConn) QueryContext(ctx context.Context, q string, args []driver.NamedValue) (driver.Rows, error) {
	r, err := c.Conn.(driver.QueryerContext).QueryContext(ctx, q, args)
	if err != nil {
		return nil, err
	}
	return &localRows{r}, nil
}
func (c *localConn) Ping(ctx context.Context) error { return c.Conn.(driver.Pinger).Ping(ctx) }
func (c *localConn) PrepareContext(ctx context.Context, q string) (driver.Stmt, error) {
	return c.Conn.(driver.ConnPrepareContext).PrepareContext(ctx, q)
}
