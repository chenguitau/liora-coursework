package llmpool

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"strings"
	"testing"
	"time"
	"unicode/utf8"

	"github.com/Autumn-27/norma/llm"
)

// fakeProv is a scripted provider: script[i] is what the i-th call yields —
// some events, then optionally an error.
type fakeProv struct {
	name   string
	calls  int
	events [][]llm.StreamEvent // events emitted before the error, per call
	errs   []error             // error to end each call with (nil = clean finish)
}

// at returns script entry n, repeating the last one once the script runs out, so
// a provider defined as "always succeeds" / "always 402" keeps behaving that way
// across repeated calls.
func at[T any](s []T, n int) (T, bool) {
	var zero T
	if len(s) == 0 {
		return zero, false
	}
	if n >= len(s) {
		n = len(s) - 1
	}
	return s[n], true
}

func (f *fakeProv) Stream(ctx context.Context, req llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	n := f.calls
	f.calls++
	return func(yield func(llm.StreamEvent, error) bool) {
		if evs, ok := at(f.events, n); ok {
			for _, e := range evs {
				if !yield(e, nil) {
					return
				}
			}
		}
		err, _ := at(f.errs, n)
		if err != nil {
			yield(llm.StreamEvent{}, err)
			return
		}
		yield(llm.StreamEvent{Type: llm.SEMessageStop}, nil)
	}
}

func (f *fakeProv) Complete(ctx context.Context, req llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	acc := llm.NewAccumulator()
	for ev, err := range f.Stream(ctx, req) {
		if err != nil {
			return llm.Message{}, "", llm.Usage{}, err
		}
		acc.Add(ev)
	}
	return acc.Message(), acc.StopReason, acc.Usage, nil
}

// ok builds a provider that always succeeds with one text delta.
func okProv(name, text string) *fakeProv {
	return &fakeProv{name: name, events: [][]llm.StreamEvent{{{Type: llm.SETextDelta, Text: text}}}}
}

// failProv builds a provider that fails immediately (before any event) with status.
func failProv(name string, status int) *fakeProv {
	return &fakeProv{name: name, errs: []error{fmt.Errorf("anthropic: status %d: nope", status)}}
}

func member(id int64, name string, rank int, p llm.Provider) *Member {
	return &Member{ID: id, Name: name, Model: "m" + name, Rank: rank, Prov: p}
}

// drain consumes a stream, returning the concatenated text and terminal error.
func drain(seq iter.Seq2[llm.StreamEvent, error]) (string, error) {
	var sb strings.Builder
	for ev, err := range seq {
		if err != nil {
			return sb.String(), err
		}
		if ev.Type == llm.SETextDelta {
			sb.WriteString(ev.Text)
		}
	}
	return sb.String(), nil
}

func TestFailoverOnNoCredit(t *testing.T) {
	a, b := failProv("a", 402), okProv("b", "hello")
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, NewRegistry(nil, nil))

	got, err := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if err != nil {
		t.Fatalf("expected failover to succeed, got %v", err)
	}
	if got != "hello" {
		t.Fatalf("text = %q, want %q", got, "hello")
	}
	if a.calls != 1 || b.calls != 1 {
		t.Fatalf("calls: a=%d b=%d, want 1/1", a.calls, b.calls)
	}
}

// A 402 is deterministic: one failure must open the breaker, so the NEXT request
// skips that profile entirely instead of paying for another round-trip.
func TestHardFailureTripsBreakerImmediately(t *testing.T) {
	a, b := failProv("a", 402), okProv("b", "x")
	reg := NewRegistry(nil, nil)
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, reg)

	_, _ = drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if !reg.IsOpen(1) {
		t.Fatal("402 should have tripped the breaker on the first failure")
	}
	_, _ = drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if a.calls != 1 {
		t.Fatalf("tripped profile was called again: calls=%d, want 1", a.calls)
	}
	if b.calls != 2 {
		t.Fatalf("fallback calls=%d, want 2", b.calls)
	}
}

// 429 is transient: the SDK already retried, but we shouldn't write a profile off
// until it fails repeatedly.
func TestSoftFailureNeedsRepeats(t *testing.T) {
	reg := NewRegistry(nil, nil)
	for i := 1; i < softTripAfter; i++ {
		if reg.Trip(1, "429", false) {
			t.Fatalf("tripped after %d transient failures, want %d", i, softTripAfter)
		}
	}
	if !reg.Trip(1, "429", false) {
		t.Fatalf("should trip on failure #%d", softTripAfter)
	}
	if !reg.IsOpen(1) {
		t.Fatal("breaker should be open")
	}
}

// A success must fully clear the counters, so an intermittent profile never
// accumulates its way to a trip.
func TestPassResetsCounters(t *testing.T) {
	reg := NewRegistry(nil, nil)
	reg.Trip(1, "429", false)
	reg.Trip(1, "429", false)
	reg.Pass(1)
	if got := reg.Get(1).Fails; got != 0 {
		t.Fatalf("fails=%d after Pass, want 0", got)
	}
	if reg.Trip(1, "429", false) {
		t.Fatal("tripped immediately after a success — counters were not reset")
	}
}

// Pass drops the ladder too, not just the consecutive-failure counter: a profile
// that served a request starts again from the first rung. The flip side — that a
// non-failover error must NOT do this — is TestNonFailoverErrorLeavesBreakerStateAlone.
func TestPassResetsBackoffLadder(t *testing.T) {
	reg := NewRegistry(nil, nil)
	for range 3 {
		reg.Trip(1, "402", true)
	}
	if got := reg.Get(1).Trips; got != 3 {
		t.Fatalf("Trips=%d, want 3", got)
	}
	reg.Pass(1)
	reg.Trip(1, "402", true)
	if got := reg.Get(1).Trips; got != 1 {
		t.Fatalf("Trips=%d after Pass+Trip, want 1 — the ladder was not reset", got)
	}
	if d := time.Until(reg.Get(1).OpenUntil); d > 2*time.Minute {
		t.Fatalf("cooldown=%v after a success, want the first rung (~1min)", d)
	}
}

func TestBackoffLadderGrows(t *testing.T) {
	reg := NewRegistry(nil, nil)
	var prev time.Duration
	for i := range 4 {
		reg.Reset(1)
		st := State{Trips: i}
		reg.Restore(1, st)
		reg.Trip(1, "402", true)
		d := time.Until(reg.Get(1).OpenUntil)
		// Non-decreasing, with a second of slack: the ladder plateaus at its last
		// rung, and each Trip stamps its own time.Now().
		if i > 0 && d < prev-time.Second {
			t.Fatalf("trip #%d cools for %v, shorter than the previous %v", i+1, d, prev)
		}
		prev = d
	}
	if prev < 25*time.Minute {
		t.Fatalf("ladder tops out at %v, want ~30m", prev)
	}
}

// The safety rule: once output has reached the caller, a mid-stream failure must
// NOT be retried on another model — that would duplicate the assistant turn.
func TestNoFailoverAfterEmit(t *testing.T) {
	a := &fakeProv{
		name:   "a",
		events: [][]llm.StreamEvent{{{Type: llm.SETextDelta, Text: "partial"}}},
		errs:   []error{fmt.Errorf("anthropic: status 500: mid-stream drop")},
	}
	b := okProv("b", "full")
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, NewRegistry(nil, nil))

	got, err := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if err == nil {
		t.Fatal("mid-stream error should surface, not be swallowed by a failover")
	}
	if got != "partial" {
		t.Fatalf("text = %q, want the partial output %q", got, "partial")
	}
	if b.calls != 0 {
		t.Fatalf("fell over to the backup after emitting output (calls=%d) — would duplicate the turn", b.calls)
	}
}

// Cancelling a task must not burn a backup key, and must not be diagnosed as an
// LLM fault.
func TestNoFailoverOnCancel(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	a := &fakeProv{name: "a", errs: []error{context.Canceled}}
	b := okProv("b", "x")
	reg := NewRegistry(nil, nil)
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, reg)

	_, err := drain(p.Stream(ctx, llm.CompletionRequest{}))
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("err = %v, want context.Canceled", err)
	}
	if b.calls != 0 {
		t.Fatalf("failed over on cancellation (backup calls=%d)", b.calls)
	}
	if reg.Get(1).Fails != 0 {
		t.Fatal("cancellation counted as a profile failure")
	}
}

// A non-failover error (400, cancelled context) says nothing about the profile's
// health, so it must neither count as a failure nor clear one that is already
// recorded — clearing would reset the backoff ladder without a successful call.
func TestNonFailoverErrorLeavesBreakerStateAlone(t *testing.T) {
	reg := NewRegistry(nil, nil)
	reg.Trip(1, "429", false) // one transient failure: degraded, breaker still closed
	a := failProv("a", 400)
	p := New([]*Member{member(1, "a", 10, a)}, reg)

	if _, _, _, err := p.Complete(context.Background(), llm.CompletionRequest{}); err == nil {
		t.Fatal("a 400 must be surfaced, not swallowed")
	}
	if got := reg.Get(1).Fails; got != 1 {
		t.Fatalf("Complete: Fails=%d after a 400, want the pre-existing 1 — the error must not touch health", got)
	}
	if _, err := drain(p.Stream(context.Background(), llm.CompletionRequest{})); err == nil {
		t.Fatal("a 400 must be surfaced by Stream too")
	}
	if got := reg.Get(1).Fails; got != 1 {
		t.Fatalf("Stream: Fails=%d after a 400, want the pre-existing 1 — the error must not touch health", got)
	}
	if reg.IsOpen(1) {
		t.Fatal("a 400 must not trip the breaker either")
	}
}

func TestShouldFailoverByStatus(t *testing.T) {
	cases := []struct {
		status int
		want   bool
	}{
		{400, false}, // bad/over-long request fails identically everywhere
		{401, true}, {402, true}, {403, true}, {404, true},
		{408, true}, {429, true}, {500, true}, {503, true},
		{200, false},
	}
	for _, c := range cases {
		err := fmt.Errorf("openai: status %d: body", c.status)
		if got := shouldFailover(context.Background(), err); got != c.want {
			t.Errorf("status %d: shouldFailover=%v, want %v", c.status, got, c.want)
		}
	}
	// A transport error carries no status and must fail over.
	if !shouldFailover(context.Background(), errors.New("dial tcp: connection reset by peer")) {
		t.Error("network error should fail over")
	}
}

func TestHardVsSoftClassification(t *testing.T) {
	for _, s := range []int{401, 402, 403, 404} {
		if !isHardFailure(fmt.Errorf("status %d: x", s)) {
			t.Errorf("status %d should be a hard failure", s)
		}
	}
	for _, s := range []int{408, 429, 500, 502, 503} {
		if isHardFailure(fmt.Errorf("status %d: x", s)) {
			t.Errorf("status %d should be transient, not hard", s)
		}
	}
}

// A member whose context window can't hold the request is a guaranteed 400 —
// skip it rather than spend a round-trip proving it.
// The output budget counts against the window too: Anthropic rejects
// prompt + max_tokens > window, so a big MaxTokens must keep the request off a
// member that can only hold the prompt.
func TestOutputBudgetCountsAgainstWindow(t *testing.T) {
	small, big := okProv("small", "s"), okProv("big", "b")
	ms := member(1, "small", 10, small)
	ms.WindowTokens = 32_000
	mb := member(2, "big", 5, big)
	mb.WindowTokens = 200_000
	p := New([]*Member{ms, mb}, NewRegistry(nil, nil))

	req := llm.CompletionRequest{
		Messages:  []llm.Message{llm.UserText(strings.Repeat("x", 60_000))}, // ≈17k tokens
		MaxTokens: 30_000,
	}
	if got, err := drain(p.Stream(context.Background(), req)); err != nil || got != "b" {
		t.Fatalf("got %q / %v, want the large-window member", got, err)
	}
	if small.calls != 0 {
		t.Fatalf("routed prompt+output to a 32k member (calls=%d)", small.calls)
	}
}

// A tool schema's bulk is in its nested properties, not in its top-level key
// count — the old flat per-key charge saw one property and moved on.
func TestEstimateCountsNestedSchema(t *testing.T) {
	props := map[string]any{}
	for i := range 40 {
		props[fmt.Sprintf("field_%02d", i)] = map[string]any{
			"type":        "string",
			"description": strings.Repeat("d", 200),
		}
	}
	req := llm.CompletionRequest{
		MaxTokens: 1, // isolate the schema from the output reserve
		Tools: []llm.ToolSchema{{
			Name: "t",
			InputSchema: map[string]any{
				"type":       "object",
				"properties": map[string]any{"options": map[string]any{"type": "object", "properties": props}},
			},
		}},
	}
	if got := estimateTokens(req); got < 2000 {
		t.Fatalf("estimate=%d, want >= 2000 — 40 nested 200-char descriptions must be counted", got)
	}
}

// CJK text is not 3.5 bytes per token: a wide character costs about a token, so a
// byte-ratio estimate under-counts a Chinese conversation by ~3x.
func TestEstimateCountsWideText(t *testing.T) {
	req := llm.CompletionRequest{MaxTokens: 1, Messages: []llm.Message{llm.UserText(strings.Repeat("错", 1000))}}
	if got := estimateTokens(req); got < 1000 {
		t.Fatalf("estimate=%d for 1000 CJK characters, want >= 1000", got)
	}
}

// ... and a request that does fit must stay on the head: the estimate may not
// over-skip either.
func TestEstimateKeepsFittingRequestOnHead(t *testing.T) {
	head := okProv("head", "H")
	mh := member(1, "head", RankActive, head)
	mh.WindowTokens = 32_000
	p := New([]*Member{mh, member(2, "b", 5, okProv("b", "b"))}, NewRegistry(nil, nil))

	req := llm.CompletionRequest{
		Messages:  []llm.Message{llm.UserText(strings.Repeat("x", 8_000))},
		MaxTokens: 4096,
	}
	if got, err := drain(p.Stream(context.Background(), req)); err != nil || got != "H" {
		t.Fatalf("got %q / %v, want the head to serve a request that fits", got, err)
	}
}

func TestSkipsMembersTooSmallForRequest(t *testing.T) {
	small, big := okProv("small", "s"), okProv("big", "b")
	ms := member(1, "small", 10, small)
	ms.WindowTokens = 1000
	mb := member(2, "big", 5, big)
	mb.WindowTokens = 1_000_000
	p := New([]*Member{ms, mb}, NewRegistry(nil, nil))

	req := llm.CompletionRequest{Messages: []llm.Message{llm.UserText(strings.Repeat("x", 100_000))}}
	got, err := drain(p.Stream(context.Background(), req))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "b" {
		t.Fatalf("text=%q, want the large-window member to serve it", got)
	}
	if small.calls != 0 {
		t.Fatalf("sent a request to a member that can't hold it (calls=%d)", small.calls)
	}
}

// Everything tripped: probing the head beats stalling the engine outright.
// When every profile is cooling off, probing one of them still beats stalling —
// but only once per member per probeEvery. A head that is confirmed dead must not
// cost a round-trip on every single request.
func TestAllTrippedProbesAtMostOncePerMemberPerInterval(t *testing.T) {
	a, b := failProv("a", 402), failProv("b", 402)
	reg := NewRegistry(nil, nil)
	reg.Trip(1, "anthropic: status 402: no credit", true)
	reg.Trip(2, "anthropic: status 402: no credit", true)
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, reg)

	// Two requests, one probe each: the fallback spreads its probes instead of
	// hammering the head.
	for range 2 {
		if _, err := drain(p.Stream(context.Background(), llm.CompletionRequest{})); !errors.Is(err, ErrExhausted) {
			t.Fatalf("err = %v, want ErrExhausted", err)
		}
	}
	if a.calls != 1 || b.calls != 1 {
		t.Fatalf("calls a=%d b=%d, want each cooling-off member probed exactly once", a.calls, b.calls)
	}

	// Both were probed inside the window: fail fast with no round-trip, but keep the
	// recorded cause so callers can still classify the outage.
	_, err := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if !errors.Is(err, ErrExhausted) || !strings.Contains(err.Error(), "402") {
		t.Fatalf("err = %v, want ErrExhausted wrapping the recorded 402", err)
	}
	if a.calls != 1 || b.calls != 1 {
		t.Fatalf("re-probed a cooling-off member within probeEvery (a=%d b=%d)", a.calls, b.calls)
	}

	// Once the interval has passed, probes resume — that is how a recovery is found.
	for i := range p.probedAt {
		p.probedAt[i].Store(time.Now().Add(-2 * probeEvery).UnixNano())
	}
	_, _ = drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if a.calls+b.calls != 3 {
		t.Fatalf("probes did not resume after probeEvery (a=%d b=%d)", a.calls, b.calls)
	}
}

// A last-resort probe must not be spent on a member that cannot hold the request:
// that is a guaranteed length 400, while the next member down might answer.
func TestLastResortSkipsMemberTooSmallForRequest(t *testing.T) {
	small, big := failProv("small", 402), failProv("big", 429)
	ms := member(1, "small", 10, small)
	ms.WindowTokens = 1000
	mb := member(2, "big", 5, big)
	mb.WindowTokens = 1_000_000
	reg := NewRegistry(nil, nil)
	reg.Trip(1, "402", true)
	reg.Trip(2, "429", true)
	p := New([]*Member{ms, mb}, reg)

	req := llm.CompletionRequest{Messages: []llm.Message{llm.UserText(strings.Repeat("x", 100_000))}}
	if _, err := drain(p.Stream(context.Background(), req)); !errors.Is(err, ErrExhausted) {
		t.Fatalf("err = %v, want ErrExhausted", err)
	}
	if small.calls != 0 {
		t.Fatalf("last-resort probed a member that cannot hold the request (calls=%d)", small.calls)
	}
	if big.calls != 1 {
		t.Fatalf("big member calls=%d, want 1 — it was the only useful probe", big.calls)
	}
}

func TestAllTrippedStillProbesHead(t *testing.T) {
	a, b := okProv("a", "a"), okProv("b", "b")
	reg := NewRegistry(nil, nil)
	reg.Trip(1, "402", true)
	reg.Trip(2, "402", true)
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, reg)

	got, err := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "a" || a.calls != 1 {
		t.Fatalf("text=%q a.calls=%d — want the head probed as a last resort", got, a.calls)
	}
}

func TestExhaustedChainReportsClearly(t *testing.T) {
	a, b := failProv("a", 402), failProv("b", 402)
	p := New([]*Member{member(1, "a", 10, a), member(2, "b", 5, b)}, NewRegistry(nil, nil))

	_, err := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if !errors.Is(err, ErrExhausted) {
		t.Fatalf("err = %v, want it to wrap ErrExhausted", err)
	}
}

// Exhaustion must not flatten the last failure into text: a caller needs to tell
// "out of credit" from "rate-limited" without parsing the message.
func TestExhaustedChainKeepsCause(t *testing.T) {
	cause := errors.New("upstream 402")
	a := &fakeProv{name: "a", errs: []error{fmt.Errorf("anthropic: status 402: %w", cause)}}
	p := New([]*Member{member(1, "a", 10, a)}, NewRegistry(nil, nil))

	if _, err := drain(p.Stream(context.Background(), llm.CompletionRequest{})); !errors.Is(err, ErrExhausted) || !errors.Is(err, cause) {
		t.Fatalf("stream err = %v, want it to wrap both ErrExhausted and the provider cause", err)
	}
	if _, _, _, err := p.Complete(context.Background(), llm.CompletionRequest{}); !errors.Is(err, ErrExhausted) || !errors.Is(err, cause) {
		t.Fatalf("complete err = %v, want it to wrap both ErrExhausted and the provider cause", err)
	}
}

// Equal-rank members take turns leading, so duplicate keys share the load.
func TestEqualRankRotates(t *testing.T) {
	a, b := okProv("a", "a"), okProv("b", "b")
	head := member(1, "head", RankActive, failProv("head", 402))
	p := New([]*Member{head, member(2, "a", 5, a), member(3, "b", 5, b)}, NewRegistry(nil, nil))

	first := map[string]int{}
	for range 4 {
		txt, _ := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
		first[txt]++
	}
	if first["a"] == 0 || first["b"] == 0 {
		t.Fatalf("same-rank members did not rotate: %v", first)
	}
}

// The head keeps its own rank and never joins a rotation group.
func TestHeadAlwaysFirst(t *testing.T) {
	head := okProv("head", "H")
	p := New([]*Member{
		member(1, "head", RankActive, head),
		member(2, "a", 5, okProv("a", "a")),
		member(3, "b", 5, okProv("b", "b")),
	}, NewRegistry(nil, nil))
	for range 5 {
		if txt, _ := drain(p.Stream(context.Background(), llm.CompletionRequest{})); txt != "H" {
			t.Fatalf("head was not tried first, got %q", txt)
		}
	}
}

// A single-member chain must behave exactly like the bare provider.
func TestSingleMemberPassthrough(t *testing.T) {
	a := okProv("a", "solo")
	p := New([]*Member{member(1, "a", RankActive, a)}, NewRegistry(nil, nil))
	got, err := drain(p.Stream(context.Background(), llm.CompletionRequest{}))
	if err != nil || got != "solo" {
		t.Fatalf("got %q / %v, want solo / nil", got, err)
	}
}

// A truncated error must stay valid UTF-8: it is logged, shown in the UI and
// persisted, and a 300-byte cut lands inside a Chinese character more often than
// not (3 bytes each).
func TestTrimErrCutsOnRuneBoundary(t *testing.T) {
	got := trimErr(errors.New("a" + strings.Repeat("错", 200)))
	if !utf8.ValidString(got) {
		t.Fatalf("trimErr produced invalid UTF-8: %q", got)
	}
	if !strings.HasSuffix(got, "…") {
		t.Fatalf("long error was not shortened: %q", got)
	}
	if len(got) > maxErrLen+len("…") {
		t.Fatalf("trimmed error is %d bytes, want about %d", len(got), maxErrLen)
	}
	if short := trimErr(errors.New("短错误")); short != "短错误" {
		t.Fatalf("short error was mangled: %q", short)
	}
}

func TestNewEmptyChainIsNil(t *testing.T) {
	if New(nil, nil) != nil {
		t.Fatal("empty chain should yield a nil pool so callers use the bare provider")
	}
}

// An expired cooling-off window must not keep a profile out of the chain.
func TestExpiredWindowIsClosed(t *testing.T) {
	reg := NewRegistry(nil, nil)
	reg.Restore(1, State{Trips: 1, OpenUntil: time.Now().Add(-time.Second)})
	if reg.IsOpen(1) {
		t.Fatal("expired window should read as closed")
	}
}
