package server

import (
	"net/url"
	"testing"
)

func TestPageParams(t *testing.T) {
	for _, tc := range []struct {
		name                  string
		query                 string
		defPage, defSize, cap int
		wantPage, wantSize    int
	}{
		{name: "missing", query: "", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "page zero", query: "page=0", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "page negative", query: "page=-3", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "page non-numeric", query: "page=abc", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "page valid", query: "page=4", defPage: 1, defSize: 20, cap: 100, wantPage: 4, wantSize: 20},
		{name: "page uncapped", query: "page=1000000", defPage: 1, defSize: 20, cap: 100, wantPage: 1000000, wantSize: 20},
		{name: "size zero", query: "size=0", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "size negative", query: "size=-9", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "size non-numeric", query: "size=x", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 20},
		{name: "size valid", query: "size=55", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 55},
		{name: "size at cap", query: "size=100", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 100},
		{name: "size above cap", query: "size=101", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 100},
		{name: "size huge", query: "size=1000000000", defPage: 1, defSize: 20, cap: 100, wantPage: 1, wantSize: 100},
		{name: "both set", query: "page=2&size=7", defPage: 1, defSize: 20, cap: 100, wantPage: 2, wantSize: 7},
		{name: "no cap", query: "size=1000000000", defPage: 1, defSize: 200, cap: 0, wantPage: 1, wantSize: 1000000000},
		{name: "custom defaults", query: "", defPage: 1, defSize: 200, cap: 500, wantPage: 1, wantSize: 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q, err := url.ParseQuery(tc.query)
			if err != nil {
				t.Fatalf("ParseQuery(%q): %v", tc.query, err)
			}
			page, size := pageParams(q, tc.defPage, tc.defSize, tc.cap)
			if page != tc.wantPage || size != tc.wantSize {
				t.Fatalf("pageParams(%q, %d, %d, %d) = (%d, %d), want (%d, %d)",
					tc.query, tc.defPage, tc.defSize, tc.cap, page, size, tc.wantPage, tc.wantSize)
			}
		})
	}
}

// The findings views keep their own defaults (page 1, limit 20/200 or 10/100)
// now that they delegate to pageParams.
func TestFindingPaginationParamKeepsDefaults(t *testing.T) {
	for _, tc := range []struct {
		raw, name             string
		fallback, upper, want int
	}{
		{name: "missing", raw: "", fallback: 20, upper: 200, want: 20},
		{name: "zero", raw: "0", fallback: 20, upper: 200, want: 20},
		{name: "negative", raw: "-5", fallback: 1, upper: 0, want: 1},
		{name: "non-numeric", raw: "abc", fallback: 10, upper: 100, want: 10},
		{name: "capped", raw: "1000", fallback: 20, upper: 200, want: 200},
		{name: "uncapped", raw: "1000", fallback: 1, upper: 0, want: 1000},
	} {
		t.Run(tc.name, func(t *testing.T) {
			if got := findingPaginationParam(tc.raw, tc.fallback, tc.upper); got != tc.want {
				t.Fatalf("findingPaginationParam(%q, %d, %d) = %d, want %d",
					tc.raw, tc.fallback, tc.upper, got, tc.want)
			}
		})
	}
}

// The intercept list keeps page 1 / size 20 / cap 100.
func TestInterceptPageParamsKeepsDefaults(t *testing.T) {
	for _, tc := range []struct {
		name             string
		query            string
		wantPage, wantSz int
	}{
		{name: "missing", query: "", wantPage: 1, wantSz: 20},
		{name: "zero", query: "page=0&size=0", wantPage: 1, wantSz: 20},
		{name: "negative", query: "page=-2&size=-2", wantPage: 1, wantSz: 20},
		{name: "capped", query: "page=3&size=1000", wantPage: 3, wantSz: 100},
		{name: "valid", query: "page=3&size=40", wantPage: 3, wantSz: 40},
		{name: "non-numeric", query: "page=x&size=y", wantPage: 1, wantSz: 20},
	} {
		t.Run(tc.name, func(t *testing.T) {
			q, err := url.ParseQuery(tc.query)
			if err != nil {
				t.Fatalf("ParseQuery(%q): %v", tc.query, err)
			}
			page, size := interceptPageParams(q)
			if page != tc.wantPage || size != tc.wantSz {
				t.Fatalf("interceptPageParams(%q) = (%d, %d), want (%d, %d)",
					tc.query, page, size, tc.wantPage, tc.wantSz)
			}
		})
	}
}
