package agent

import "testing"

// The model picks page_size/limit, so an unbounded value must never reach the
// store: it turns one tool call into a full-table scan, and a huge page overflows
// (page-1)*page_size into a negative offset.
func TestClampPagingBoundsModelInput(t *testing.T) {
	cases := []struct {
		page, size         int
		wantPage, wantSize int
		wantOffset         int
	}{
		{0, 0, 1, 10, 0},
		{-5, -1, 1, 10, 0},
		{2, 10, 2, 10, 10},
		{3, 100000, 3, 200, 400},
		{1 << 31, 10, maxListPage, 10, (maxListPage - 1) * 10},
		{2, 500, 2, 200, 200},
	}
	for _, c := range cases {
		page, size, offset := clampPaging(c.page, c.size)
		if page != c.wantPage || size != c.wantSize || offset != c.wantOffset {
			t.Fatalf("clampPaging(%d,%d) = (%d,%d,%d), want (%d,%d,%d)",
				c.page, c.size, page, size, offset, c.wantPage, c.wantSize, c.wantOffset)
		}
		if offset < 0 {
			t.Fatalf("clampPaging(%d,%d) produced a negative offset %d", c.page, c.size, offset)
		}
	}
}

func TestClampLimitOffsetBoundsModelInput(t *testing.T) {
	if limit, offset := clampLimitOffset(0, 0); limit != 10 || offset != 0 {
		t.Fatalf("defaults = (%d,%d), want (10,0)", limit, offset)
	}
	if limit, offset := clampLimitOffset(1e9, -7); limit != maxListSize || offset != 0 {
		t.Fatalf("clamped = (%d,%d), want (%d,0)", limit, offset, maxListSize)
	}
	if limit, offset := clampLimitOffset(25, 50); limit != 25 || offset != 50 {
		t.Fatalf("in-range values must pass through, got (%d,%d)", limit, offset)
	}
}
