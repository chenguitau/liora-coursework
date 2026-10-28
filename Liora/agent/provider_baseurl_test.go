package agent

import (
	"testing"

	"github.com/Autumn-27/norma/llm"
)

// TestNormalizeBaseURL locks the single base-URL normalizer: each provider's own
// endpoint suffix is stripped, whitespace and trailing slashes are trimmed, and a
// URL that is already an API base (including an Anthropic-compatible /anthropic
// root) is left untouched.
func TestNormalizeBaseURL(t *testing.T) {
	cases := []struct{ name, provider, in, want string }{
		{"openai chat completions endpoint", "openai", "https://api.openai.com/v1/chat/completions", "https://api.openai.com/v1"},
		{"openai responses endpoint", "openai-responses", "https://api.openai.com/v1/responses", "https://api.openai.com/v1"},
		{"anthropic messages endpoint", "anthropic", "https://api.anthropic.com/v1/messages", "https://api.anthropic.com"},
		{"anthropic compatible root kept", "anthropic", "https://api.deepseek.com/anthropic", "https://api.deepseek.com/anthropic"},
		{"empty provider defaults to anthropic", "", "https://gw.example/v1/messages/", "https://gw.example"},
		{"trims spaces and trailing slash", "openai", " https://gw.example/v1/ ", "https://gw.example/v1"},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			if got := NormalizeBaseURL(tc.provider, tc.in); got != tc.want {
				t.Fatalf("NormalizeBaseURL(%q, %q) = %q, want %q", tc.provider, tc.in, got, tc.want)
			}
		})
	}
}

// TestConfigFromSharesNormalizeBaseURL guards the single-implementation rule:
// ConfigFrom must derive BaseURL from NormalizeBaseURL for every provider.
func TestConfigFromSharesNormalizeBaseURL(t *testing.T) {
	cases := []struct {
		provider, in string
		format       llm.Format
	}{
		{"openai", "https://gw.example/v1/chat/completions", llm.FormatOpenAI},
		{"openai-responses", "https://gw.example/v1/responses", llm.FormatOpenAIResponses},
		{"anthropic", "https://gw.example/anthropic/v1/messages", llm.FormatAnthropic},
	}
	for _, tc := range cases {
		t.Run(tc.provider, func(t *testing.T) {
			c := ConfigFrom(tc.provider, "m", tc.in, "sk-x", "")
			if want := NormalizeBaseURL(tc.provider, tc.in); c.BaseURL != want {
				t.Fatalf("ConfigFrom base_url = %q, want NormalizeBaseURL %q", c.BaseURL, want)
			}
			if c.Format != tc.format {
				t.Fatalf("format = %v, want %v", c.Format, tc.format)
			}
		})
	}
}
