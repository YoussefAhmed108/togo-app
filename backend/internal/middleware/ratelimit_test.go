package middleware

import (
	"testing"
	"time"
)

func TestAllowsUpToHourlyLimit(t *testing.T) {
	rl := NewRateLimiter(3, 10)
	for i := 0; i < 3; i++ {
		if ok, _ := rl.Allow(1); !ok {
			t.Fatalf("request %d should be allowed", i+1)
		}
	}
	ok, wait := rl.Allow(1)
	if ok {
		t.Fatal("4th request should be blocked by the hourly limit")
	}
	if wait <= 0 || wait > time.Hour {
		t.Errorf("retry-after = %v, want between 0 and 1h", wait)
	}
}

func TestLimitsArePerUser(t *testing.T) {
	rl := NewRateLimiter(1, 10)
	if ok, _ := rl.Allow(1); !ok {
		t.Fatal("user 1 first request should pass")
	}
	if ok, _ := rl.Allow(2); !ok {
		t.Fatal("user 2 must not be blocked by user 1's usage")
	}
	if ok, _ := rl.Allow(1); ok {
		t.Fatal("user 1 second request should be blocked")
	}
}

func TestHourlyWindowRollsOver(t *testing.T) {
	rl := NewRateLimiter(2, 100)
	// Two hits just over an hour old must not count against the hourly window.
	old := time.Now().Add(-61 * time.Minute)
	rl.hits[1] = []time.Time{old, old}

	if ok, _ := rl.Allow(1); !ok {
		t.Fatal("expired hits should no longer block")
	}
}

func TestDailyLimitBlocksBelowHourlyRate(t *testing.T) {
	rl := NewRateLimiter(10, 3)
	// Spread over the day so the hourly window is never the binding limit.
	now := time.Now()
	rl.hits[1] = []time.Time{
		now.Add(-5 * time.Hour), now.Add(-4 * time.Hour), now.Add(-3 * time.Hour),
	}
	ok, wait := rl.Allow(1)
	if ok {
		t.Fatal("should be blocked by the daily limit")
	}
	if wait <= time.Hour {
		t.Errorf("retry-after = %v, want > 1h (daily window)", wait)
	}
}

func TestOldHitsArePruned(t *testing.T) {
	rl := NewRateLimiter(10, 10)
	rl.hits[1] = []time.Time{time.Now().Add(-25 * time.Hour)}
	rl.Allow(1)
	// The 25h-old entry must be dropped, leaving only the new one.
	if got := len(rl.hits[1]); got != 1 {
		t.Errorf("len(hits) = %d, want 1 (stale entry not pruned)", got)
	}
}

func TestZeroLimitDoesNotPanic(t *testing.T) {
	rl := NewRateLimiter(0, 0)
	if ok, _ := rl.Allow(1); !ok {
		t.Fatal("clamped limiter should allow the first call")
	}
	if ok, _ := rl.Allow(1); ok {
		t.Fatal("clamped limiter should block the second call")
	}
}
