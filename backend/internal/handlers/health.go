package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"net/http"
	"sync"
	"time"

	"app/backend/internal/storage"
)

// checkTimeout caps each dependency probe. The whole endpoint answers in
// roughly this long even when everything is hanging, because probes run
// concurrently.
const checkTimeout = 5 * time.Second

type checkResult struct {
	OK        bool   `json:"ok"`
	LatencyMS int64  `json:"latency_ms"`
	Detail    string `json:"detail,omitempty"`
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
				res.Detail = err.Error()
			}
			mu.Lock()
			checks[name] = res
			mu.Unlock()
		}()
	}

	run("db", func(ctx context.Context) error { return h.db.PingContext(ctx) })
	run("r2", h.storage.Ping)
	run("maps", func(ctx context.Context) error { return checkGoogleMaps(ctx, h.mapsKey) })
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

// checkGoogleMaps validates the key without spending quota: a Places request
// with no location returns INVALID_REQUEST when the key is good and
// REQUEST_DENIED when it is not. Google does not bill either outcome.
func checkGoogleMaps(ctx context.Context, key string) error {
	if key == "" {
		return fmt.Errorf("GOOGLE_MAPS_API_KEY not set")
	}
	req, _ := http.NewRequestWithContext(ctx, http.MethodGet,
		"https://maps.googleapis.com/maps/api/place/nearbysearch/json?key="+key, nil)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return fmt.Errorf("unreachable: %w", err)
	}
	defer resp.Body.Close()

	var body struct {
		Status string `json:"status"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return fmt.Errorf("bad response: %w", err)
	}
	if body.Status == "REQUEST_DENIED" {
		return fmt.Errorf("key rejected")
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
