package analytics

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

func TestCapture(t *testing.T) {
	got := make(chan map[string]any, 1)
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		_ = json.NewDecoder(r.Body).Decode(&body)
		got <- body
	}))
	defer srv.Close()

	Init("", srv.URL)
	Capture("1", "disabled", nil) // no key: must not send

	Init("phc_test", srv.URL)
	Capture("42", "tiktok_extract", map[string]any{"cost_usd": 0.01})

	select {
	case b := <-got:
		props, _ := b["properties"].(map[string]any)
		if b["api_key"] != "phc_test" || b["distinct_id"] != "42" || b["event"] != "tiktok_extract" ||
			props["cost_usd"] != 0.01 || props["$geoip_disable"] != true {
			t.Fatalf("unexpected event: %v", b)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("no event sent")
	}
}
