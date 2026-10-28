package db

import (
	"database/sql"
	"encoding/json"
	"fmt"
	"strings"
)

type sqlQueryer interface {
	Query(string, ...any) (*sql.Rows, error)
}

// jsonRows streams one encoded object at a time. This preserves bounded memory
// for large archive exports without PostgreSQL's row_to_json or JSON aggregates.
type jsonRows struct {
	*sql.Rows
	columns []string
	types   []*sql.ColumnType
}

func queryJSON(q sqlQueryer, query string, args ...any) (*jsonRows, error) {
	rows, err := q.Query(query, args...)
	if err != nil {
		return nil, err
	}
	cols, err := rows.Columns()
	if err != nil {
		rows.Close()
		return nil, err
	}
	types, err := rows.ColumnTypes()
	if err != nil {
		rows.Close()
		return nil, err
	}
	return &jsonRows{rows, cols, types}, nil
}

func (r *jsonRows) Scan(dest ...any) error {
	if len(dest) != 1 {
		return fmt.Errorf("JSON row scan expects one destination")
	}
	values := make([]any, len(r.columns))
	pointers := make([]any, len(values))
	for i := range values {
		pointers[i] = &values[i]
	}
	if err := r.Rows.Scan(pointers...); err != nil {
		return err
	}
	obj := make(map[string]any, len(values))
	for i, value := range values {
		typ := strings.ToUpper(r.types[i].DatabaseTypeName())
		if bytes, ok := value.([]byte); ok {
			value = string(bytes)
		}
		if value != nil && typ == "JSON" {
			raw := json.RawMessage(fmt.Sprint(value))
			if !json.Valid(raw) {
				return fmt.Errorf("invalid JSON in %s", r.columns[i])
			}
			value = raw
		}
		if n, ok := value.(int64); ok && typ == "BOOLEAN" {
			value = n != 0
		}
		obj[r.columns[i]] = value
	}
	b, err := json.Marshal(obj)
	if err != nil {
		return err
	}
	switch target := dest[0].(type) {
	case *[]byte:
		*target = b
	case *json.RawMessage:
		*target = b
	case *string:
		*target = string(b)
	default:
		return fmt.Errorf("unsupported JSON destination %T", dest[0])
	}
	return nil
}

func queryJSONObject(q sqlQueryer, query string, args ...any) (json.RawMessage, error) {
	rows, err := queryJSON(q, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	if !rows.Next() {
		if err := rows.Err(); err != nil {
			return nil, err
		}
		return nil, sql.ErrNoRows
	}
	var raw json.RawMessage
	err = rows.Scan(&raw)
	return raw, err
}
