package db

import (
	"database/sql/driver"
	"encoding/json"
	"fmt"
	"net/netip"
	"sort"
	"strings"
	"unicode"

	"modernc.org/sqlite"
)

// Domain-specific deterministic helpers keep atomic asset merges in the SQL
// transaction. Malformed JSON is reported, never silently discarded.
func init() {
	register := func(name string, argc int32, f func([]driver.Value) (driver.Value, error)) {
		sqlite.MustRegisterDeterministicScalarFunction(name, argc, func(_ *sqlite.FunctionContext, args []driver.Value) (driver.Value, error) { return f(args) })
	}
	register("liora_json_union", 2, func(a []driver.Value) (driver.Value, error) { return mergeJSONArray(a, "") })
	register("liora_merge_ports", 2, func(a []driver.Value) (driver.Value, error) { return mergeJSONArray(a, "port") })
	register("liora_merge_params", 2, func(a []driver.Value) (driver.Value, error) { return mergeJSONArray(a, "param") })
	register("liora_json_merge", 2, func(a []driver.Value) (driver.Value, error) {
		if a[0] == nil || a[1] == nil {
			return nil, nil
		}
		out := map[string]any{}
		for _, arg := range a {
			var m map[string]any
			if err := json.Unmarshal([]byte(sqlText(arg)), &m); err != nil {
				return nil, err
			}
			for key, value := range m {
				out[key] = value
			}
		}
		b, err := json.Marshal(out)
		return string(b), err
	})
	register("liora_net_contains", 2, func(a []driver.Value) (driver.Value, error) {
		p, err := parseNetwork(sqlText(a[0]))
		if err != nil {
			return int64(0), nil
		}
		q, err := parseNetwork(sqlText(a[1]))
		if err != nil {
			return int64(0), nil
		}
		if p.Addr().BitLen() == q.Addr().BitLen() && p.Bits() <= q.Bits() && p.Contains(q.Addr()) {
			return int64(1), nil
		}
		return int64(0), nil
	})
	register("liora_net_bits", 1, func(a []driver.Value) (driver.Value, error) {
		p, e := parseNetwork(sqlText(a[0]))
		if e != nil {
			return nil, nil
		}
		return int64(p.Bits()), nil
	})
	register("liora_valid_ip", 1, func(a []driver.Value) (driver.Value, error) {
		p, e := netip.ParseAddr(sqlText(a[0]))
		if e != nil {
			return nil, nil
		}
		return p.String(), nil
	})
	register("liora_normalize_icp", 1, func(a []driver.Value) (driver.Value, error) {
		return strings.ToLower(strings.Map(func(r rune) rune {
			if unicode.IsSpace(r) {
				return -1
			}
			return r
		}, sqlText(a[0]))), nil
	})
}

func sqlText(v driver.Value) string {
	if v == nil {
		return ""
	}
	if b, ok := v.([]byte); ok {
		return string(b)
	}
	return fmt.Sprint(v)
}

func parseNetwork(s string) (netip.Prefix, error) {
	if p, err := netip.ParsePrefix(s); err == nil {
		return unmapPrefix(p.Masked()), nil
	}
	a, err := netip.ParseAddr(s)
	if err != nil {
		return netip.Prefix{}, err
	}
	a = a.Unmap()
	return netip.PrefixFrom(a, a.BitLen()), nil
}

// unmapPrefix folds an IPv4-mapped IPv6 prefix (::ffff:a.b.c.d/N) onto its IPv4
// equivalent, mirroring what the bare-address branch above does with Unmap. Left
// mapped, the prefix keeps a 128-bit address while an IPv4 asset address is 32
// bits, so liora_net_contains' equal-bit-length guard rejects every comparison
// and a mapped CIDR rule silently matches nothing. Masked() already zeroed every
// host bit, so Is4In6 surviving means the 96-bit mapped header is intact and can
// simply be dropped from the width.
func unmapPrefix(p netip.Prefix) netip.Prefix {
	if !p.Addr().Is4In6() || p.Bits() < 96 {
		return p
	}
	return netip.PrefixFrom(p.Addr().Unmap(), p.Bits()-96)
}

func mergeJSONArray(args []driver.Value, kind string) (driver.Value, error) {
	values := map[string]json.RawMessage{}
	for _, arg := range args {
		if arg == nil {
			continue
		}
		var elements []json.RawMessage
		if err := json.Unmarshal([]byte(sqlText(arg)), &elements); err != nil {
			return nil, err
		}
		for _, raw := range elements {
			var v any
			decoder := json.NewDecoder(strings.NewReader(string(raw)))
			decoder.UseNumber()
			if err := decoder.Decode(&v); err != nil {
				return nil, err
			}
			canonical, err := json.Marshal(v)
			if err != nil {
				return nil, err
			}
			key := string(canonical)
			if kind != "" {
				m, ok := v.(map[string]any)
				if !ok {
					return nil, fmt.Errorf("expected %s object", kind)
				}
				if kind == "port" {
					key = fmt.Sprint(m["port"])
				} else {
					key = fmt.Sprint(m["location"]) + "\x00" + fmt.Sprint(m["name"])
				}
				if old, ok := values[key]; ok {
					if kind == "param" {
						if string(old) >= string(canonical) {
							continue
						}
					} else {
						var prev map[string]any
						_ = json.Unmarshal(old, &prev)
						if service, ok := prev["service"].(string); ok && service != "" {
							continue
						}
					}
				}
			}
			values[key] = canonical
		}
	}
	keys := make([]string, 0, len(values))
	for k := range values {
		keys = append(keys, k)
	}
	sort.Strings(keys)
	out := make([]json.RawMessage, 0, len(keys))
	for _, k := range keys {
		out = append(out, values[k])
	}
	b, err := json.Marshal(out)
	return string(b), err
}
