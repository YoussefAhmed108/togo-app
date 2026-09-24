package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"app/backend/internal/storage"
)

// checkTimeout caps each dependency probe. The whole endpoint answers in
// roughly this long even when everything is hanging, because probes run
// concurrently.
const checkTimeout = 5 * time.Second

type checkResult struct {
	OK        bool  `json:"ok"`
	LatencyMS int64 `json:"latency_ms"`
}

type HealthHandler struct {
	db        *sql.DB
	storage   *storage.Client
	mapsKey   string
	claudeKey string
}

func NewHealthHandler(db *sql.DB, st *storage.Client, mapsKey, claudeKey string) *HealthHandler {
	return &HealthHandler{db: db, storage: st, mapsKey: mapsKey, claudeKey: claudeKey}
}

// Deep probes every external dependency and reports each one separately.
//
// Returns 200 when all checks pass, 503 when any fails, so a monitor can watch
// the status code alone. Detail strings describe the failure without echoing
// credentials.
//
// ponytail: probes are fixed and few, so they are listed literally rather than
// registered through a plugin interface. Add a case when a dependency appears.
func (h *HealthHandler) Deep(w http.ResponseWriter, r *http.Request) {
	ctx, cancel := context.WithTimeout(r.Context(), checkTimeout)
	defer cancel()

	checks := map[string]checkResult{}
	var mu sync.Mutex
	var wg sync.WaitGroup

	run := func(name string, fn func(context.Context) error) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			start := time.Now()
			err := fn(ctx)
			res := checkResult{OK: err == nil, LatencyMS: time.Since(start).Milliseconds()}
			if err != nil {
				// This endpoint is public: raw errors carried the Maps key (it
				// rides in the request URL) and DB host names. Log, don't return.
				var ue *url.Error
				if errors.As(err, &ue) {
					ue.URL = "(redacted)"
				}
				log.Printf("health/deep: %s: %v", name, err)
			}
			mu.Lock()
			checks[name] = res
			mu.Unlock()
		}()
	}

	run("db", func(ctx context.Context) error { return h.db.PingContext(ctx) })
	run("r2", h.storage.Ping)
	// Places (extraction, recommendations) and Routes (live ETA) are enabled
	// separately on the Google project, so each gets its own probe.
	run("maps", func(ctx context.Context) error {
		return checkGoogle(ctx, h.mapsKey, "https://places.googleapis.com/v1/places:searchNearby")
	})
	run("routes", func(ctx context.Context) error {
		return checkGoogle(ctx, h.mapsKey, "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix")
	})
	run("claude", func(ctx context.Context) error { return checkAnthropic(ctx, h.claudeKey) })

	wg.Wait()

	status := "ok"
	code := http.StatusOK
	for _, c := range checks {
		if !c.OK {
			status = "degraded"
			code = http.StatusServiceUnavailable
			break
		}
	}

	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(code)
	json.NewEncoder(w).Encode(map[string]any{"status": status, "checks": checks})
}

// checkGoogle validates the key against one Google API without spending
// quota: an empty POST is a 400 INVALID_ARGUMENT when the key works for that
// API, and a 403 (API not enabled, key restricted) or API_KEY_INVALID when it
// does not. Google bills neither.
func checkGoogle(ctx context.Context, key, endpoint string) error {
	if key == "" {
		return fmt.Errorf("GOOGLE_MAPS_API_KEY not set")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, strings.NewReader("{}"))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", key)
	req.Header.Set("X-Goog-FieldMask", "*")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("unreachable: %w", err)
	}
	defer resp.Body.Close()
	body, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode == http.StatusForbidden || resp.StatusCode == http.StatusUnauthorized ||
		strings.Contains(string(body), "API_KEY_INVALID") {
		return fmt.Errorf("key rejected (HTTP %d)", resp.StatusCode)
	}
	return nil
}

// checkAnthropic validates the key against /v1/models, which is free and
// performs no inference.
func checkAnthropic(ctx context.Context, key string) error {
	if key == "" {
		return fmt.Errorf("ANTHROPIC_API_KEY not set")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet, "https://api.anthropic.com/v1/models", nil)
	req.Header.Set("x-api-key", key)
	req.Header.Set("anthropic-version", "2023-06-01")

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("unreachable: %w", err)
	}
	defer resp.Body.Close()

	if resp.StatusCode == http.StatusUnauthorized || resp.StatusCode == http.StatusForbidden {
		return fmt.Errorf("key rejected")
	}
	if resp.StatusCode >= 400 {
		return fmt.Errorf("http %d", resp.StatusCode)
	}
	return nil
}
