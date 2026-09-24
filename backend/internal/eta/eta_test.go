package eta

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type latLng struct{ Latitude, Longitude float64 }

type fakeReq struct {
	Origins, Destinations []struct {
		Waypoint struct{ Location struct{ LatLng latLng } }
	}
	RoutingPreference string
	mask              string
}

// fakeGoogle answers every call with body and records what it was asked.
func fakeGoogle(t *testing.T, body string) *[]fakeReq {
	t.Helper()
	var got []fakeReq
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost || r.Header.Get("X-Goog-Api-Key") != "k" {
			t.Errorf("want POST with key header, got %s", r.Method)
		}
		var req fakeReq
		json.NewDecoder(r.Body).Decode(&req)
		req.mask = r.Header.Get("X-Goog-FieldMask")
		got = append(got, req)
		w.Write([]byte(body))
	}))
	t.Cleanup(srv.Close)
	old := endpoint
	endpoint = srv.URL
	t.Cleanup(func() { endpoint = old })
	return &got
}

func TestEstimateNeverPaysForTraffic(t *testing.T) {
	// Out of order, index 0 omitted as the real API does.
	calls := fakeGoogle(t, `[
		{"destinationIndex":1,"status":{},"condition":"ROUTE_NOT_FOUND"},
		{"status":{},"condition":"ROUTE_EXISTS","duration":"900s"}]`)

	got := Estimate(context.Background(), nil, "k", 30.04441, 31.23571, []Dest{
		{ID: 1, Lat: 30.06, Lng: 31.22},
		{ID: 2, Lat: 30.06, Lng: 31.22}, // same venue saved by someone else
		{ID: 3, Lat: 29.9, Lng: 32.9},   // unroutable
	})
	if len(*calls) != 1 {
		t.Fatalf("calls = %d, want 1", len(*calls))
	}
	c := (*calls)[0]
	if c.RoutingPreference != "TRAFFIC_UNAWARE" || strings.Contains(c.mask, "staticDuration") {
		t.Errorf("list must use the no-traffic SKU, got %q mask %q", c.RoutingPreference, c.mask)
	}
	if n := len(c.Destinations); n != 2 {
		t.Errorf("sent %d destinations, want 2 (duplicate coords must merge)", n)
	}
	// No learned factor without a DB: the estimate is the no-traffic time.
	want := Result{Seconds: 900}
	if got[1] != want || got[2] != want {
		t.Errorf("want estimate %v for both copies, got %v", want, got)
	}
	if _, ok := got[3]; ok {
		t.Errorf("unroutable place must be absent, got %v", got)
	}
	// The exact position never reaches Google — only the cell centre.
	if o := c.Origins[0].Waypoint.Location.LatLng; o != (latLng{30.0425, 31.2375}) {
		t.Errorf("origin = %v, want snapped cell centre", o)
	}
}

func TestLiveReadsBothDurations(t *testing.T) {
	calls := fakeGoogle(t, `[{"status":{},"condition":"ROUTE_EXISTS","duration":"1080s","staticDuration":"900s"}]`)

	got, ok := Live(context.Background(), nil, "k", 30.0444, 31.2357, Dest{ID: 7, Lat: 30.06, Lng: 31.22})
	if !ok || got != (Result{Seconds: 1080, Live: true}) {
		t.Fatalf("got %v %v, want 1080s live", got, ok)
	}
	c := (*calls)[0]
	if c.RoutingPreference != "TRAFFIC_AWARE" || !strings.Contains(c.mask, "staticDuration") {
		t.Errorf("live must ask for traffic and the no-traffic time in one call, got %q mask %q", c.RoutingPreference, c.mask)
	}
	d := matrix(context.Background(), "k", "30.04250,31.23750", []string{"30.06000,31.22000"}, true)
	if d["30.06000,31.22000"] != (durations{live: 1080, static: 900}) {
		t.Errorf("durations = %v", d)
	}
}

func TestSnapAndHourOfWeek(t *testing.T) {
	if Snap(Snap(30.04441)) != Snap(30.04441) {
		t.Error("Snap must be idempotent so client- and server-snapped origins share a cell")
	}
	// Friday 18:30 in Cairo (UTC+3 in summer): day 5, hour 18.
	fri := time.Date(2026, 9, 25, 15, 30, 0, 0, time.UTC)
	if h := hourOfWeek(fri); h != 5*24+18 {
		t.Errorf("hourOfWeek = %d, want %d", h, 5*24+18)
	}
	if a := areaKey(30.0425, 31.2375); a != "30.00,31.20" {
		t.Errorf("areaKey = %q", a)
	}
}

func TestMostSpecificFactorWins(t *testing.T) {
	from, heliopolis, maadi := "30.00,31.20", Dest{Lat: 30.0911, Lng: 31.3228}, Dest{Lat: 29.9602, Lng: 31.2569}
	learned := map[string]float64{"*": 1.1, from: 1.2, tripKey(from, heliopolis): 1.3}
	if f := pick(learned, from, heliopolis); f != 1.3 {
		t.Errorf("trip factor = %v, want 1.3", f)
	}
	if f := pick(learned, from, maadi); f != 1.2 {
		t.Errorf("unlearned trip falls back to its origin area: %v, want 1.2", f)
	}
	if f := pick(map[string]float64{"*": 1.1}, "31.00,30.00", maadi); f != 1.1 {
		t.Errorf("unlearned area falls back to the city: %v", f)
	}
	if f := pick(nil, from, maadi); f != 1 {
		t.Errorf("nothing learned = no-traffic time: %v", f)
	}
	if k := tripKey(from, heliopolis); k != "30.00,31.20>30.05,31.30" || len(k) > 48 {
		t.Errorf("tripKey = %q", k)
	}
}
