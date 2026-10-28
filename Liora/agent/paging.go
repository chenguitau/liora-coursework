package agent

// Paging bounds for the list_* tools. The model chooses these numbers, so an
// uncapped page_size turns one tool call into a full-table scan, and a huge page
// overflows (page-1)*page_size into a negative offset — which the store then
// either rejects or answers with the wrong slice.
const (
	defaultListSize = 10
	maxListSize     = 200
	maxListPage     = 1_000_000
)

// clampLimitOffset bounds a model-supplied limit/offset pair.
func clampLimitOffset(limit, offset int) (int, int) {
	if limit <= 0 {
		limit = defaultListSize
	}
	if limit > maxListSize {
		limit = maxListSize
	}
	if offset < 0 {
		offset = 0
	}
	return limit, offset
}

// clampPaging bounds a model-supplied page/page_size pair and derives the offset
// from the values actually used, so the returned page and page_size describe the
// rows the caller will see.
func clampPaging(page, size int) (int, int, int) {
	if page < 1 {
		page = 1
	}
	if page > maxListPage {
		page = maxListPage
	}
	size, _ = clampLimitOffset(size, 0)
	return page, size, (page - 1) * size
}
