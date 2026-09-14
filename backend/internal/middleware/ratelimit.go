package middleware

import (
	"encoding/json"
	"fmt"
	"log"
	"net"
	"net/http"
	"strconv"
	"strings"
	"sync"
	"time"
)

// RateLimiter caps how often one caller (a user id or a client IP) may hit an
// endpoint.
//
// ponytail: in-memory, so counts reset on restart and are per-process — a
// second instance doubles the effective limit. Move to the DB (or Redis) when
// the API runs more than one replica. For a single server this needs no
// schema, no migration and no dependency.
type RateLimiter struct {
	mu      sync.Mutex
	hits    map[string][]time.Time
	perHour int
	perDay  int
}

// sweepAt is the key count past which idle keys are dropped. IP-keyed limiters
// see callers that never return; without the sweep the map only grows.
const sweepAt = 10000

func NewRateLimiter(perHour, perDay int) *RateLimiter {
	// A zero limit would index past the end of the hit slice and panic the
	// request, so clamp: the floor is "one call, then blocked".
	if perHour < 1 {
		perHour = 1
	}
	if perDay < 1 {
		perDay = 1
	}
	return &RateLimiter{hits: make(map[string][]time.Time), perHour: perHour, perDay: perDay}
}

// Allow records an attempt and reports whether it is permitted. When it is
// not, it returns how long the caller must wait for the offending window to
// free up a slot.
func (rl *RateLimiter) Allow(key string) (bool, time.Duration) {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	if len(rl.hits) > sweepAt {
		for k, ts := range rl.hits {
			if now.Sub(ts[len(ts)-1]) >= 24*time.Hour {
				delete(rl.hits, k)
			}
		}
	}

	// Drop anything outside the longest window; that doubles as the cleanup
	// for this key's slice, so it can never grow past perDay entries.
	kept := rl.hits[key][:0]
	for _, t := range rl.hits[key] {
		if now.Sub(t) < 24*time.Hour {
			kept = append(kept, t)
		}
	}
	rl.hits[key] = kept

	if len(kept) >= rl.perDay {
		return false, retryAfter(kept[len(kept)-rl.perDay], 24*time.Hour, now)
	}

	inHour := 0
	for _, t := range kept {
		if now.Sub(t) < time.Hour {
			inHour++
		}
	}
	if inHour >= rl.perHour {
		return false, retryAfter(kept[len(kept)-inHour], time.Hour, now)
	}

	rl.hits[key] = append(kept, now)
	return true, 0
}

// retryAfter is how long until oldest falls out of window.
func retryAfter(oldest time.Time, window time.Duration, now time.Time) time.Duration {
	d := window - now.Sub(oldest)
	if d < time.Second {
		return time.Second
	}
	return d
}

// Limit wraps a handler, rejecting users over their quota with 429.
func (rl *RateLimiter) Limit(next http.HandlerFunc) http.HandlerFunc {
	return rl.limit(next, func(r *http.Request) string { return strconv.FormatUint(GetUserID(r), 10) })
}

// LimitIP is Limit keyed on the client IP, for unauthenticated routes
// (login, register, refresh) where there is no user id yet.
func (rl *RateLimiter) LimitIP(next http.HandlerFunc) http.HandlerFunc {
	return rl.limit(next, ClientIP)
}

// ClientIP is the caller's address. On Cloud Run, Google's front end APPENDS
// the real client IP to X-Forwarded-For, so only the rightmost entry is
// trustworthy — anything left of it was sent by the client and is spoofable.
//
// ponytail: assumes Cloud Run with nothing in front. Put a Google load
// balancer in front and the rightmost entry becomes the balancer; take the
// second-from-right then.
func ClientIP(r *http.Request) string {
	if xff := r.Header.Get("X-Forwarded-For"); xff != "" {
		return strings.TrimSpace(xff[strings.LastIndex(xff, ",")+1:])
	}
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		return r.RemoteAddr
	}
	return host
}

func (rl *RateLimiter) limit(next http.HandlerFunc, keyOf func(*http.Request) string) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		key := keyOf(r)
		ok, wait := rl.Allow(key)
		if !ok {
			log.Printf("req[%s] ratelimit: %s blocked on %s, retry in %v",
				ReqID(r), key, r.URL.Path, wait.Round(time.Second))
			w.Header().Set("Retry-After", fmt.Sprintf("%d", int(wait.Seconds())))
			w.WriteHeader(http.StatusTooManyRequests)
			json.NewEncoder(w).Encode(map[string]string{
				"error": fmt.Sprintf("too many requests — try again in %s", wait.Round(time.Minute)),
			})
			return
		}
		next(w, r)
	}
}
