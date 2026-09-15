// Package analytics sends server-side events to PostHog.
//
// The app sends its own events (screens, sessions, country); the server only
// sends what the app cannot see — what an extraction cost and which cache
// answered it. Both use the user id as distinct_id, so they join on one person.
package analytics

import (
	"bytes"
	"encoding/json"
	"log"
	"net/http"
	"strings"
	"time"
)

var (
	apiKey string
	host   string
	client = &http.Client{Timeout: 5 * time.Second}
)

// Init enables Capture. An empty key leaves Capture a no-op, so local dev and
// tests send nothing.
func Init(key, apiHost string) {
	apiKey, host = key, strings.TrimSuffix(apiHost, "/")
}

// Capture sends one event in the background. Analytics must never slow down or
// fail a request, so errors are logged and dropped.
//
// ponytail: one POST per event, no batching or retry — fine at one event per
// extraction. Swap for github.com/posthog/posthog-go if volume grows.
func Capture(distinctID, event string, props map[string]any) {
	if apiKey == "" {
		return
	}
	if props == nil {
		props = map[string]any{}
	}
	// Without this PostHog geolocates the Fly server and overwrites the user's
	// real country (which the app's events set) with the datacenter's.
	props["$geoip_disable"] = true

	body, err := json.Marshal(map[string]any{
		"api_key":     apiKey,
		"event":       event,
		"distinct_id": distinctID,
		"properties":  props,
		"timestamp":   time.Now().UTC().Format(time.RFC3339Nano),
	})
	if err != nil {
		log.Printf("analytics: marshal %s: %v", event, err)
		return
	}
	go func() {
		resp, err := client.Post(host+"/i/v0/e/", "application/json", bytes.NewReader(body))
		if err != nil {
			log.Printf("analytics: send %s: %v", event, err)
			return
		}
		resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			log.Printf("analytics: send %s: HTTP %d", event, resp.StatusCode)
		}
	}()
}
