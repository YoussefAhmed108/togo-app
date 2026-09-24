package eta

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestLookup(t *testing.T) {
	type latLng struct{ Latitude, Longitude float64 }
	type wp struct {
		Waypoint struct{ Location struct{ LatLng latLng } }
	}
	var calls int
	var origin latLng
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		if r.Method != http.MethodPost || r.Header.Get("X-Goog-Api-Key") != "k" || r.Header.Get("X-Goog-FieldMask") == "" {
			t.Errorf("want POST with key and field mask headers, got %s %v", r.Method, r.Header)
		}
		var req struct {
			Origins, Destinations []wp
			RoutingPreference     string
		}
		json.NewDecoder(r.Body).Decode(&req)
		if n := len(req.Destinations); n != 2 {
			t.Errorf("sent %d destinations, want 2 (duplicate coords must merge)", n)
		}
		if req.RoutingPreference != "TRAFFIC_AWARE" {
			t.Errorf("routingPreference = %q", req.RoutingPreference)
		}
		origin = req.Origins[0].Waypoint.Location.LatLng
		// Out of order, index 0 omitted as the real API does.
		w.Write([]byte(`[
			{"destinationIndex":1,"status":{},"condition":"ROUTE_NOT_FOUND"},
			{"status":{},"condition":"ROUTE_EXISTS","duration":"1080s"}]`))
	}))
	defer srv.Close()
	endpoint = srv.URL

	got := Lookup(context.Background(), nil, "k", 30.04441, 31.23571, []Dest{
		{ID: 1, Lat: 30.06, Lng: 31.22},
		{ID: 2, Lat: 30.06, Lng: 31.22}, // same venue saved by someone else
		{ID: 3, Lat: 29.9, Lng: 32.9},   // unroutable
	})
	if calls != 1 {
		t.Fatalf("calls = %d, want 1", calls)
	}
	if got[1] != 1080 || got[2] != 1080 {
		t.Errorf("want traffic duration for both copies, got %v", got)
	}
	if _, ok := got[3]; ok {
		t.Errorf("unroutable place must be absent, got %v", got)
	}
	// The exact position never reaches Google — only the cell centre.
	if origin != (latLng{30.0425, 31.2375}) {
		t.Errorf("origin = %v, want snapped cell centre", origin)
	}
	if Snap(Snap(30.04441)) != Snap(30.04441) {
		t.Error("Snap must be idempotent so client- and server-snapped origins share a cell")
	}
}
