package db

import (
	"net/netip"
	"testing"
)

// A CIDR written as an IPv4-mapped IPv6 prefix (::ffff:a.b.c.d/N) must behave
// like the equivalent IPv4 prefix. parseNetwork unmasks the address branch but
// used to keep the mapped form for the prefix branch, so the prefix stayed
// 128 bits wide while an IPv4 asset address is 32 bits: liora_net_contains then
// failed its equal-bit-length guard and every such scope rule silently matched
// nothing.
func TestParseNetworkNormalizesIPv4MappedPrefix(t *testing.T) {
	cases := []struct{ in, want string }{
		{"::ffff:192.168.1.0/120", "192.168.1.0/24"},
		{"::ffff:10.0.0.0/104", "10.0.0.0/8"},
		{"::ffff:0:0/96", "0.0.0.0/0"},
		{"::ffff:203.0.113.7/128", "203.0.113.7/32"},
		{"::ffff:203.0.113.7", "203.0.113.7/32"},
		// Plain prefixes keep their existing behaviour.
		{"192.168.1.0/24", "192.168.1.0/24"},
		{"10.1.2.3", "10.1.2.3/32"},
		{"2001:db8::/32", "2001:db8::/32"},
		{"2001:db8::1", "2001:db8::1/128"},
		{"0.0.0.0/0", "0.0.0.0/0"},
		{"::/0", "::/0"},
	}
	for _, c := range cases {
		got, err := parseNetwork(c.in)
		if err != nil {
			t.Fatalf("parseNetwork(%q): %v", c.in, err)
		}
		if want := netip.MustParsePrefix(c.want); got != want {
			t.Errorf("parseNetwork(%q) = %v (bits %d), want %v", c.in, got, got.Bits(), want)
		}
	}
}

// liora_net_contains is what task scopes and company CIDR matching use in SQL,
// so the user-visible proof is a query, not just the helper.
func TestNetContainsMatchesIPv4MappedCIDR(t *testing.T) {
	d, err := Open(testDSN(t))
	if err != nil {
		t.Fatalf("SQLite unavailable (%v) - skipping", err)
	}
	defer d.Close()

	cases := []struct {
		net, addr string
		want      int64
	}{
		{"::ffff:192.168.1.0/120", "192.168.1.5", 1},
		{"::ffff:192.168.1.0/120", "192.168.2.5", 0},
		{"::ffff:10.0.0.0/104", "10.255.0.9", 1},
		{"192.168.1.0/24", "192.168.1.5", 1},
		{"2001:db8::/32", "2001:db8::1", 1},
		// A mapped prefix must not start matching plain IPv6 addresses.
		{"::ffff:192.168.1.0/120", "2001:db8::1", 0},
	}
	for _, c := range cases {
		var got int64
		if err := d.QueryRow("SELECT liora_net_contains(?, ?)", c.net, c.addr).Scan(&got); err != nil {
			t.Fatalf("liora_net_contains(%q,%q): %v", c.net, c.addr, err)
		}
		if got != c.want {
			t.Errorf("liora_net_contains(%q, %q) = %d, want %d", c.net, c.addr, got, c.want)
		}
	}

	// liora_net_bits drives the "most specific rule wins" ordering, so the
	// mapped form must report the unmapped width.
	var bits int64
	if err := d.QueryRow("SELECT liora_net_bits(?)", "::ffff:192.168.1.0/120").Scan(&bits); err != nil {
		t.Fatal(err)
	}
	if bits != 24 {
		t.Errorf("liora_net_bits(::ffff:192.168.1.0/120) = %d, want 24", bits)
	}
}
