package llmpool

import (
	"context"
	"errors"
	"fmt"
	"iter"
	"log"
	"regexp"
	"strconv"
	"strings"
	"sync/atomic"
	"time"
	"unicode/utf8"

	"github.com/Autumn-27/norma/llm"
)

// Member is one LLM profile in the chain, already built into a provider (wrapped
// with the recorder by the caller, so a failed attempt is still recorded under
// its own profile name).
type Member struct {
	ID       int64  // llm_profiles.id
	Name     string // profile name, for logs / UI
	Model    string
	Format   string // "anthropic" | "openai"
	Priority int    // the profile's configured priority (display only)
	Active   bool   // is_default (display only)
	// Rank is the ordering key the caller assigned: higher goes first, and members
	// sharing a Rank take turns leading (load-spreading across duplicate keys).
	// The caller encodes "active profile heads the chain" as a Rank above every
	// user-settable priority, so this type needs no policy of its own.
	Rank int
	// WindowTokens is the profile's context window in tokens. A member whose
	// window can't hold the request is skipped rather than made to fail on it.
	WindowTokens int
	Prov         llm.Provider
}

// RankActive is the Rank the caller gives the chain head (the active profile, or
// an explicitly bound one) so it always outranks any configured priority.
const RankActive = int(^uint(0)>>1) - 1

// ErrExhausted is returned when every member of the chain failed. The error
// returned then wraps both ErrExhausted and the last member's failure, so callers
// can classify the cause (402 vs 429) with errors.Is instead of parsing text.
var ErrExhausted = errors.New("LLM 轮询：所有配置均不可用")

// Pool is an llm.Provider that fails over across an ordered chain of members.
// It is safe for concurrent use: members are immutable after construction, the
// breaker state lives in the shared Registry, and the only local mutable state is
// the rotation counter plus the per-member last-resort probe stamps.
type Pool struct {
	members []*Member // in chain order (active first, then priority DESC)
	health  *Registry
	rr      atomic.Uint64 // rotates the starting point within an equal-priority group
	// probedAt is when each member was last probed as a last resort (unix nanos,
	// indexed like members). It bounds the "everything is cooling off" fallback so
	// an all-down chain doesn't spend a round-trip on every request.
	probedAt []atomic.Int64
}

// New builds a Pool over members (already in chain order). Returns nil when the
// chain is empty. A single-member chain is still a valid Pool — it just behaves
// exactly like the bare provider.
func New(members []*Member, health *Registry) *Pool {
	if len(members) == 0 {
		return nil
	}
	if health == nil {
		health = NewRegistry(nil, nil)
	}
	return &Pool{members: members, health: health, probedAt: make([]atomic.Int64, len(members))}
}

// Members returns the chain in order (read-only).
func (p *Pool) Members() []*Member { return p.members }

// Stream implements llm.Provider with failover.
//
// The one hard rule: a member may only be abandoned BEFORE it has yielded any
// event. Once text or a tool_use has reached the caller, re-sending the same
// request to another model would duplicate output and corrupt the conversation
// history — so a mid-stream failure is surfaced as-is and left to the agent
// harness's resume logic. Fortunately the failures this exists for (402 no
// credit, 401 bad key, 429, 5xx) all surface during request establishment,
// before the body is read, so they always land in the safe window.
func (p *Pool) Stream(ctx context.Context, req llm.CompletionRequest) iter.Seq2[llm.StreamEvent, error] {
	order := p.order(req)
	return func(yield func(llm.StreamEvent, error) bool) {
		if len(order) == 0 {
			yield(llm.StreamEvent{}, p.exhaustedError())
			return
		}
		var lastErr error
		for i, m := range order {
			emitted := false
			var failed error
			for ev, err := range m.Prov.Stream(ctx, req) {
				if err != nil && !emitted && shouldFailover(ctx, err) {
					failed = err
					break // safe window: nothing reached the caller yet
				}
				emitted = true
				if !yield(ev, err) {
					return // caller stopped consuming (cancel / early exit)
				}
				if err != nil {
					return // terminal error already handed to the caller
				}
			}
			if failed == nil {
				p.health.Pass(m.ID) // the provider finished the stream cleanly
				return
			}
			lastErr = failed
			hard := isHardFailure(failed)
			if p.health.Trip(m.ID, trimErr(failed), hard) {
				log.Printf("[llmpool] 配置 %q(%s) 已熔断：%s", m.Name, m.Model, trimErr(failed))
			}
			if i+1 < len(order) {
				n := order[i+1]
				log.Printf("[llmpool] LLM 故障转移：%q(%s) → %q(%s)，原因：%s",
					m.Name, m.Model, n.Name, n.Model, trimErr(failed))
			}
		}
		if lastErr == nil {
			lastErr = ErrExhausted
		}
		log.Printf("[llmpool] 轮询链已耗尽(%d 个配置全部失败)，最后错误：%s", len(order), trimErr(lastErr))
		yield(llm.StreamEvent{}, fmt.Errorf("%w：%w", ErrExhausted, lastErr))
	}
}

// Complete implements llm.Provider with failover for non-streaming calls. A
// non-streaming request is atomic — it never delivers partial output — so every
// failover-eligible failure lands in the safe window and the next member can be
// tried without risk of duplicated output. Mirrors Stream's health-tripping and
// chain-exhaustion behavior.
func (p *Pool) Complete(ctx context.Context, req llm.CompletionRequest) (llm.Message, string, llm.Usage, error) {
	order := p.order(req)
	if len(order) == 0 {
		return llm.Message{}, "", llm.Usage{}, p.exhaustedError()
	}
	var lastErr error
	for i, m := range order {
		msg, sr, usage, err := m.Prov.Complete(ctx, req)
		if err == nil {
			p.health.Pass(m.ID)
			return msg, sr, usage, nil
		}
		if !shouldFailover(ctx, err) {
			// Non-failover error (e.g. ctx cancel, deterministic 4xx): surface it as-is
			// and leave health alone. It says nothing about the profile, so it must not
			// count as a failure — and must not clear one either: Pass here would wipe a
			// recorded trip and reset the backoff ladder without a single successful
			// call. Stream already behaves this way.
			return llm.Message{}, "", llm.Usage{}, err
		}
		lastErr = err
		hard := isHardFailure(err)
		if p.health.Trip(m.ID, trimErr(err), hard) {
			log.Printf("[llmpool] 配置 %q(%s) 已熔断：%s", m.Name, m.Model, trimErr(err))
		}
		if i+1 < len(order) {
			n := order[i+1]
			log.Printf("[llmpool] LLM 故障转移：%q(%s) → %q(%s)，原因：%s",
				m.Name, m.Model, n.Name, n.Model, trimErr(err))
		}
	}
	if lastErr == nil {
		lastErr = ErrExhausted
	}
	log.Printf("[llmpool] 轮询链已耗尽(%d 个配置全部失败)，最后错误：%s", len(order), trimErr(lastErr))
	return llm.Message{}, "", llm.Usage{}, fmt.Errorf("%w：%w", ErrExhausted, lastErr)
}

// order picks the members to try, in order: skip those in a cooling-off window
// and those whose context window can't hold this request, then rotate within each
// equal-priority group so same-priority profiles share the load. Returns an empty
// slice only when nothing is worth a round-trip right now (see lastResort); the
// caller then reports ErrExhausted instead of stalling.
func (p *Pool) order(req llm.CompletionRequest) []*Member {
	est := estimateTokens(req)
	var open []*Member
	for _, m := range p.members {
		if p.health.IsOpen(m.ID) {
			continue
		}
		if m.WindowTokens > 0 && est > m.WindowTokens {
			continue // would 400 on length — not a useful failover target
		}
		open = append(open, m)
	}
	if len(open) == 0 {
		return p.lastResort(est)
	}
	return rotateGroups(open, p.rr.Add(1)-1)
}

// probeEvery is the minimum interval between two last-resort probes of the same
// member. Without it an all-down chain re-probes the head on every request — one
// guaranteed wasted round-trip per call against a profile already known to be
// broken — while a 30s cadence still finds a recovery just as quickly as a user
// could act on it.
const probeEvery = 30 * time.Second

// lastResort picks the single member to try when nothing passed the filter, or nil
// when nothing is worth a round-trip right now.
//
// Probing beats stalling, so a member that could actually hold this request is
// preferred over one that would only answer with a length 400, and a member whose
// breaker is open is probed at most once per probeEvery. A member that is merely
// too small (but healthy) is still tried, so the caller gets the provider's real
// "prompt too long" error rather than a generic "all unavailable".
func (p *Pool) lastResort(est int) []*Member {
	now := time.Now()
	for i, m := range p.members {
		if m.WindowTokens > 0 && est > m.WindowTokens {
			continue // guaranteed length 400 — never a useful probe
		}
		if p.health.IsOpen(m.ID) && !p.claimProbe(i, now) {
			continue // cooling off, and probed too recently
		}
		return p.members[i : i+1]
	}
	for i, m := range p.members {
		if !p.health.IsOpen(m.ID) {
			return p.members[i : i+1] // healthy but too small: let it report why
		}
	}
	return nil // every member is cooling off and was just probed: fail fast
}

// claimProbe reserves this round's last-resort probe of members[i], reporting
// false when one was already spent within probeEvery.
func (p *Pool) claimProbe(i int, now time.Time) bool {
	prev := p.probedAt[i].Load()
	if prev != 0 && now.Sub(time.Unix(0, prev)) < probeEvery {
		return false
	}
	return p.probedAt[i].CompareAndSwap(prev, now.UnixNano())
}

// exhaustedError reports "nothing could be tried" in the same shape as a chain
// that ran and failed: it wraps ErrExhausted plus the most recent failure on
// record, so callers can still tell a 402 from a 429.
func (p *Pool) exhaustedError() error {
	var last error
	var newest time.Time
	for _, m := range p.members {
		st := p.health.Get(m.ID)
		if st.LastError == "" || !st.LastAt.After(newest) {
			continue
		}
		newest, last = st.LastAt, errors.New(st.LastError)
	}
	if last == nil {
		return ErrExhausted
	}
	return fmt.Errorf("%w：%w", ErrExhausted, last)
}

// rotateGroups rotates each run of equal-ranked members by n, so profiles sharing
// a priority take turns going first (free load-spreading across duplicate keys).
// The chain head has its own Rank and always stays at the front.
func rotateGroups(in []*Member, n uint64) []*Member {
	out := make([]*Member, 0, len(in))
	for i := 0; i < len(in); {
		j := i + 1
		for j < len(in) && in[j].Rank == in[i].Rank {
			j++
		}
		g := in[i:j]
		if len(g) > 1 {
			off := int(n % uint64(len(g)))
			for k := range g {
				out = append(out, g[(k+off)%len(g)])
			}
		} else {
			out = append(out, g...)
		}
		i = j
	}
	return out
}

// statusRe pulls the HTTP status out of the SDK's error text, which is formatted
// as "<prefix>: status <code>: <body>" (norma/llm/retry.go). The SDK exposes no
// typed error, so the string is what we have.
var statusRe = regexp.MustCompile(`status (\d{3})`)

// statusOf returns the HTTP status carried by err, or 0 if it isn't one.
func statusOf(err error) int {
	m := statusRe.FindStringSubmatch(err.Error())
	if m == nil {
		return 0
	}
	code, _ := strconv.Atoi(m[1])
	return code
}

// shouldFailover reports whether err justifies trying the next profile.
//
// Never fails over on context cancellation — that's the user stopping a task or a
// task-level timeout, and burning a backup key on it would both waste credit and
// pollute the run's termination diagnosis. Never on 400 either: a malformed or
// over-long request fails identically everywhere.
func shouldFailover(ctx context.Context, err error) bool {
	if err == nil {
		return false
	}
	if ctx.Err() != nil || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
		return false
	}
	switch code := statusOf(err); {
	case code == 0:
		return true // no status → transport-level failure (reset / DNS / timeout)
	case code == 400:
		return false // bad or over-long request: identical everywhere
	case code == 401, code == 402, code == 403, code == 404, code == 408, code == 429:
		return true
	case code >= 500:
		return true
	}
	return false
}

// isHardFailure reports whether the failure is deterministic (the profile will
// keep failing until a human fixes it) rather than transient. Hard failures open
// the breaker on the first occurrence.
func isHardFailure(err error) bool {
	switch statusOf(err) {
	case 401, 402, 403, 404:
		return true
	}
	return false
}

// maxErrLen is how much of a provider error is kept for logs, the UI and the
// persisted breaker row.
const maxErrLen = 300

// trimErr shortens an error for logs/UI — provider bodies can be long. The cut
// lands on a rune boundary: a byte slice would leave an invalid UTF-8 tail behind,
// and upstream bodies here are frequently Chinese (3 bytes per character).
func trimErr(err error) string {
	s := strings.TrimSpace(strings.ReplaceAll(err.Error(), "\n", " "))
	if len(s) <= maxErrLen {
		return s
	}
	cut := maxErrLen
	for cut > 0 && !utf8.RuneStart(s[cut]) {
		cut--
	}
	return s[:cut] + "…"
}

// defaultOutputReserve is the output budget assumed when a request leaves
// MaxTokens at 0: the SDK then sends its own default (8192 for Anthropic), and the
// window has to hold prompt + max_tokens, not just the prompt.
const defaultOutputReserve = 8192

// Small fixed per-item JSON overhead (keys, punctuation) — free to count.
const (
	messageOverhead = 4
	blockOverhead   = 4
	toolOverhead    = 4
)

// estimateTokens sizes a request, in tokens, so members whose context window
// can't hold it are skipped instead of 400-ing. It stays deliberately crude, but
// it must not UNDER-estimate: a length 400 is not failover-eligible, so an
// under-estimate kills the whole request even though a larger profile could have
// served it. Hence everything that reaches the wire is counted — the output
// budget, thinking signatures, and the real shape of the tool schemas.
func estimateTokens(req llm.CompletionRequest) int {
	out := req.MaxTokens
	if out <= 0 {
		out = defaultOutputReserve
	}
	n := out
	for _, s := range req.System {
		n += textTokens(s)
	}
	for _, m := range req.Messages {
		n += messageOverhead + blocksTokens(m.Content)
	}
	for _, t := range req.Tools {
		n += toolOverhead + textTokens(t.Name) + textTokens(t.Description) + schemaTokens(t.InputSchema)
	}
	return n
}

func blocksTokens(bs []llm.ContentBlock) int {
	n := 0
	for _, b := range bs {
		n += blockOverhead + textTokens(b.Text) + textTokens(b.Thinking) +
			textTokens(b.Signature) + textTokens(b.Name) + textTokens(b.ID) +
			textTokens(b.ToolUseID) + textTokens(string(b.Input))
		n += blocksTokens(b.Content)
	}
	return n
}

// textTokens approximates a string's token count. ASCII runs ~3.5 bytes per
// token; a non-ASCII rune is charged a full token, because the byte ratio would
// count a CJK character (3 bytes) as less than one when tokenizers spend 1-2.
func textTokens(s string) int {
	ascii, wide := 0, 0
	for _, r := range s {
		if r < utf8.RuneSelf {
			ascii++
		} else {
			wide++
		}
	}
	return (ascii*2+6)/7 + wide
}

// schemaTokens approximates the serialized size of a decoded JSON schema. Walking
// the value is the only way to see nested properties: a flat charge per top-level
// key badly under-counts a schema whose one "options" property holds an object
// with dozens of documented fields.
func schemaTokens(v any) int {
	switch x := v.(type) {
	case string:
		return textTokens(x) + 2 // quotes
	case map[string]any:
		n := 2 // braces
		for k, val := range x {
			n += textTokens(k) + 4 + schemaTokens(val) // "key": value,
		}
		return n
	case []any:
		n := 2 // brackets
		for _, e := range x {
			n += schemaTokens(e) + 1 // separator
		}
		return n
	}
	return 1 // number / bool / null
}
