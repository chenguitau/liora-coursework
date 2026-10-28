package server

import (
	"crypto/rand"
	"fmt"
	"log"
	"math"
	"math/big"
	"net"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

const (
	jwtKeyFilename       = "jwt.key"
	authPassKey          = "auth.password_hash"
	defaultAdminUsername = "Liora"
	jwtTTL               = 7 * 24 * time.Hour
	keyChars             = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"
)

// loadOrCreateJWTKey reads the 32-byte signing key from keyDir/jwt.key. keyDir is
// the project base dir (next to the executable), NOT the browsable workspace root
// (dataDir) — the signing key must never be listable/downloadable via the file
// manager. Legacy installs kept it at dataDir/jwt.key; if present there and not yet
// at the new location, it is migrated (key preserved, so sessions stay valid) and
// the old file removed so it disappears from the workspace. On first run a random
// key is generated and persisted.
func loadOrCreateJWTKey(keyDir, dataDir string) ([]byte, error) {
	if err := os.MkdirAll(keyDir, 0700); err != nil {
		return nil, fmt.Errorf("create jwt key directory: %w", err)
	}
	path := filepath.Join(keyDir, jwtKeyFilename)
	// one-time migration out of the old in-workspace location.
	if legacy := filepath.Join(dataDir, jwtKeyFilename); legacy != path {
		if _, err := os.Stat(path); os.IsNotExist(err) {
			if data, rerr := os.ReadFile(legacy); rerr == nil {
				if werr := os.WriteFile(path, data, 0o600); werr == nil {
					_ = os.Remove(legacy)
					log.Printf("[auth] JWT key 已从 %s 迁移到 %s（移出可浏览工作区）", legacy, path)
				}
			}
		}
	}
	if data, err := os.ReadFile(path); err == nil && len(strings.TrimSpace(string(data))) >= 32 {
		return []byte(strings.TrimSpace(string(data))), nil
	}
	buf := make([]byte, 32)
	for i := range buf {
		n, err := rand.Int(rand.Reader, big.NewInt(int64(len(keyChars))))
		if err != nil {
			return nil, fmt.Errorf("generate jwt key: %w", err)
		}
		buf[i] = keyChars[n.Int64()]
	}
	if err := os.WriteFile(path, buf, 0600); err != nil {
		return nil, fmt.Errorf("write jwt key: %w", err)
	}
	log.Printf("[auth] 新 JWT key 已写入 %s", path)
	return buf, nil
}

// signJWT issues a 7-day HS256 token for user Liora.
func signJWT(key []byte) (string, error) {
	return jwt.NewWithClaims(jwt.SigningMethodHS256, jwt.RegisteredClaims{
		Subject:   defaultAdminUsername,
		ExpiresAt: jwt.NewNumericDate(time.Now().Add(jwtTTL)),
		IssuedAt:  jwt.NewNumericDate(time.Now()),
	}).SignedString(key)
}

// verifyJWT returns true when tokenStr is a valid, non-expired HS256 token.
func verifyJWT(tokenStr string, key []byte) bool {
	t, err := jwt.Parse(tokenStr, func(t *jwt.Token) (any, error) {
		if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
			return nil, fmt.Errorf("unexpected signing method")
		}
		return key, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithSubject(defaultAdminUsername))
	return err == nil && t.Valid
}

// extractToken reads the JWT from the Authorization header or the liora_token
// cookie. The ?token= query param is accepted ONLY on streaming endpoints:
// EventSource cannot send headers, but a token in a URL leaks into proxy logs,
// browser history and Referer headers, so it must not work anywhere else.
func extractToken(r *http.Request) string {
	if h := r.Header.Get("Authorization"); strings.HasPrefix(h, "Bearer ") {
		return strings.TrimPrefix(h, "Bearer ")
	}
	if c, err := r.Cookie("liora_token"); err == nil && c.Value != "" {
		return c.Value
	}
	if isStreamEndpoint(r.URL.Path) {
		return r.URL.Query().Get("token")
	}
	return ""
}

// isStreamEndpoint reports whether path is one of the long-lived SSE endpoints.
func isStreamEndpoint(path string) bool {
	return strings.HasSuffix(path, "/stream") || strings.HasSuffix(path, "/events")
}

// requireAuth wraps h with JWT validation.
// /api/auth/* and /api/health are exempt.
func (s *Server) requireAuth(h http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		p := r.URL.Path
		if strings.HasPrefix(p, "/api/auth/") || p == "/api/health" {
			h.ServeHTTP(w, r)
			return
		}
		tok := extractToken(r)
		if tok == "" {
			writeErr(w, 401, "未授权")
			return
		}
		if !verifyJWT(tok, s.jwtKey) {
			writeErr(w, 401, "token 无效或已过期")
			return
		}
		h.ServeHTTP(w, r)
	})
}

// writeAuthInternalErr answers a failed auth request with a generic 500 and keeps
// the underlying error in the server log. The auth endpoints are the ones a
// caller reaches WITHOUT a token (init/login) or before any trust is established
// (change-password validates only the token it was handed), so a driver message
// such as "database is closed", a SQL fragment or a filesystem path must never
// be echoed back. writeErr still records the 500 itself; this only adds the
// detail the client is not allowed to see.
func writeAuthInternalErr(w http.ResponseWriter, publicMsg string, err error) {
	log.Printf("[auth] %s: %v", publicMsg, err)
	writeErr(w, http.StatusInternalServerError, publicMsg)
}

// GET /api/auth/status — reports whether the admin password has been initialised.
func (s *Server) authStatus(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	hash, _, _ := pg.GetSetting(authPassKey)
	writeJSON(w, 200, map[string]any{"initialized": hash != ""})
}

// POST /api/auth/init — sets the password for the first time; rejected if already set.
func (s *Server) authInit(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	existing, _, _ := pg.GetSetting(authPassKey)
	if existing != "" {
		writeErr(w, 403, "密码已设置")
		return
	}
	var req struct {
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil || req.Password == "" {
		writeErr(w, 400, "密码不能为空")
		return
	}
	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, "密码加密失败")
		return
	}
	if err := pg.SetSetting(authPassKey, string(hash)); err != nil {
		writeAuthInternalErr(w, "保存失败，请查看服务端日志", err)
		return
	}
	tok, err := signJWT(s.jwtKey)
	if err != nil {
		writeErr(w, 500, "token 生成失败")
		return
	}
	writeJSON(w, 200, map[string]any{"token": tok})
}

// POST /api/auth/change-password — changes the admin password. Requires a valid
// token (this route is under /api/auth/* which requireAuth exempts, so the token
// is validated here) AND the current password.
func (s *Server) authChangePassword(w http.ResponseWriter, r *http.Request) {
	pg := s.pg(w)
	if pg == nil {
		return
	}
	if !verifyJWT(extractToken(r), s.jwtKey) {
		writeErr(w, 401, "未授权")
		return
	}
	var req struct {
		OldPassword string `json:"old_password"`
		NewPassword string `json:"new_password"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	if req.NewPassword == "" {
		writeErr(w, 400, "新密码不能为空")
		return
	}
	hash, ok, _ := pg.GetSetting(authPassKey)
	if !ok || hash == "" {
		writeErr(w, 403, "密码未初始化，请先设置密码")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.OldPassword)); err != nil {
		writeErr(w, 401, "当前密码错误")
		return
	}
	newHash, err := bcrypt.GenerateFromPassword([]byte(req.NewPassword), bcrypt.DefaultCost)
	if err != nil {
		writeErr(w, 500, "密码加密失败")
		return
	}
	if err := pg.SetSetting(authPassKey, string(newHash)); err != nil {
		writeAuthInternalErr(w, "保存失败，请查看服务端日志", err)
		return
	}
	writeJSON(w, 200, map[string]any{"ok": true})
}

// Login throttling is intentionally process-local. Liora is deployed as a
// single instance and the auth endpoint must not pull in Redis or another
// dependency just to count failures; a mutex-guarded map is enough to make
// online guessing of the fixed admin account impractical. The trade-off is
// that a restart (or a second replica, should one ever exist) forgets the
// counters and the window starts over — acceptable for a brute-force speed
// bump, but not a durable audit/ban list. Persistent lockouts would need
// storage and an explicit unlock path, which this endpoint deliberately lacks.
const (
	defaultLoginWindow       = 5 * time.Minute
	defaultLoginMaxFails     = 5
	loginFailsSweepThreshold = 1024
)

// loginAttempt is one client IP's failure record. The window is anchored to the
// first failure: once first+loginWindow has passed, the record expires and the
// IP gets a fresh budget.
type loginAttempt struct {
	fails int
	first time.Time
}

func (s *Server) loginWindowOrDefault() time.Duration {
	if s.loginWindow > 0 {
		return s.loginWindow
	}
	return defaultLoginWindow
}

func (s *Server) loginMaxFailsOrDefault() int {
	if s.loginMaxFails > 0 {
		return s.loginMaxFails
	}
	return defaultLoginMaxFails
}

// loginClientKey identifies the caller for throttling. RemoteAddr is host:port;
// the port changes on every connection, so only the host is stable. A malformed
// value (some tests and custom transports omit the port) is used verbatim.
func loginClientKey(r *http.Request) string {
	if host, _, err := net.SplitHostPort(r.RemoteAddr); err == nil && host != "" {
		return host
	}
	return r.RemoteAddr
}

// loginBlocked reports whether key is over the failure limit and, if so, how
// long remains in the current window. Expired records are dropped on access so
// idle IPs do not need a background sweeper.
func (s *Server) loginBlocked(key string) (time.Duration, bool) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	a, ok := s.loginFails[key]
	if !ok {
		return 0, false
	}
	now := time.Now()
	window := s.loginWindowOrDefault()
	if now.Sub(a.first) >= window {
		delete(s.loginFails, key)
		return 0, false
	}
	if a.fails < s.loginMaxFailsOrDefault() {
		return 0, false
	}
	return a.first.Add(window).Sub(now), true
}

// recordLoginFailure counts one failed attempt for key. When the map has grown
// past loginFailsSweepThreshold it also sweeps every expired entry, so a stream
// of distinct source IPs cannot grow it without bound.
func (s *Server) recordLoginFailure(key string) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	if s.loginFails == nil {
		s.loginFails = map[string]loginAttempt{}
	}
	now := time.Now()
	window := s.loginWindowOrDefault()
	if len(s.loginFails) > loginFailsSweepThreshold {
		for k, a := range s.loginFails {
			if now.Sub(a.first) >= window {
				delete(s.loginFails, k)
			}
		}
	}
	a, ok := s.loginFails[key]
	if !ok || now.Sub(a.first) >= window {
		s.loginFails[key] = loginAttempt{fails: 1, first: now}
		return
	}
	a.fails++
	s.loginFails[key] = a
}

// clearLoginFailures forgets key after a successful login.
func (s *Server) clearLoginFailures(key string) {
	s.loginMu.Lock()
	defer s.loginMu.Unlock()
	delete(s.loginFails, key)
}

// POST /api/auth/login — validates username/password and returns a JWT.
func (s *Server) authLogin(w http.ResponseWriter, r *http.Request) {
	clientKey := loginClientKey(r)
	if retryAfter, blocked := s.loginBlocked(clientKey); blocked {
		// Retry-After is in whole seconds and must round up, otherwise a client
		// could retry while the window is still open.
		w.Header().Set("Retry-After", strconv.Itoa(int(math.Ceil(retryAfter.Seconds()))))
		writeErr(w, http.StatusTooManyRequests, "登录尝试过于频繁，请稍后再试")
		return
	}
	pg := s.pg(w)
	if pg == nil {
		return
	}
	var req struct {
		Username string `json:"username"`
		Password string `json:"password"`
	}
	if err := decode(r, &req); err != nil {
		writeErr(w, 400, "请求格式错误")
		return
	}
	if req.Username != defaultAdminUsername {
		s.recordLoginFailure(clientKey)
		writeErr(w, 401, "用户名或密码错误")
		return
	}
	hash, ok, err := pg.GetSetting(authPassKey)
	if err != nil {
		// A read failure is an outage, not a bad credential: report it as such and
		// deliberately do NOT count it against the per-IP throttle, so a database
		// hiccup cannot burn a legitimate client's login budget.
		writeAuthInternalErr(w, "读取登录配置失败", err)
		return
	}
	if !ok || hash == "" {
		s.recordLoginFailure(clientKey)
		writeErr(w, 403, "密码未初始化，请先设置密码")
		return
	}
	if err := bcrypt.CompareHashAndPassword([]byte(hash), []byte(req.Password)); err != nil {
		s.recordLoginFailure(clientKey)
		writeErr(w, 401, "用户名或密码错误")
		return
	}
	tok, err := signJWT(s.jwtKey)
	if err != nil {
		writeErr(w, 500, "token 生成失败")
		return
	}
	s.clearLoginFailures(clientKey)
	writeJSON(w, 200, map[string]any{"token": tok})
}
