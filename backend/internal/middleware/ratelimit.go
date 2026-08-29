package middleware

import (
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"
)

// RateLimiter caps how often one user may hit an expensive endpoint.
//
// ponytail: in-memory, so counts reset on restart and are per-process — a
// second instance doubles the effective limit. Move to the DB (or Redis) when
// the API runs more than one replica. For a single server this needs no
// schema, no migration and no dependency.
type RateLimiter struct {
	mu      sync.Mutex
	hits    map[uint64][]time.Time
	perHour int
	perDay  int
}

func NewRateLimiter(perHour, perDay int) *RateLimiter {
	// A zero limit would index past the end of the hit slice and panic the
	// request, so clamp: the floor is "one call, then blocked".
	if perHour < 1 {
		perHour = 1
	}
	if perDay < 1 {
		perDay = 1
	}
	return &RateLimiter{hits: make(map[uint64][]time.Time), perHour: perHour, perDay: perDay}
}

// Allow records an attempt and reports whether it is permitted. When it is
// not, it returns how long the caller must wait for the offending window to
// free up a slot.
func (rl *RateLimiter) Allow(userID uint64) (bool, time.Duration) {
	now := time.Now()
	rl.mu.Lock()
	defer rl.mu.Unlock()

	// Drop anything outside the longest window; that doubles as the cleanup
	// for this user's slice, so it can never grow past perDay entries.
	kept := rl.hits[userID][:0]
	for _, t := range rl.hits[userID] {
		if now.Sub(t) < 24*time.Hour {
			kept = append(kept, t)
		}
	}
	rl.hits[userID] = kept

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

	rl.hits[userID] = append(kept, now)
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

// Limit wraps a handler, rejecting callers over their quota with 429.
func (rl *RateLimiter) Limit(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		ok, wait := rl.Allow(GetUserID(r))
		if !ok {
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
