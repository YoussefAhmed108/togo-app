package handlers

import (
	"context"
	"testing"

	"app/backend/internal/extract"
)

func TestResolveFallsBackToNearbySpot(t *testing.T) {
	mall := extract.Candidate{GooglePlaceID: "mall1", Name: "City Stars", Address: "Nasr City", Lat: 30.07, Lng: 31.34}
	var asked []string
	searchText = func(_ context.Context, _, query, _ string, _ *extract.LatLng) ([]extract.Candidate, error) {
		asked = append(asked, query)
		if query == "City Stars Mall, Nasr City, Cairo" {
			return []extract.Candidate{mall}, nil
		}
		return nil, nil
	}
	defer func() { searchText = extract.SearchText }()

	h := &ExtractHandler{}
	run := &extractRun{}
	nop := func(string, ...any) {}
	p, ok := h.resolve(context.Background(), nop, extract.Result{
		PlaceName: "Tiny Kiosk", City: "Cairo",
		Fallbacks: []string{"", "Unknown Street, Cairo", "City Stars Mall, Nasr City, Cairo", "Nasr City, Cairo"},
	}, nil, run)

	if !ok || p.Selected == nil {
		t.Fatalf("want a fallback pin, got ok=%v %+v", ok, p)
	}
	if p.Selected.Name != "Tiny Kiosk" || p.Selected.GooglePlaceID != "" || p.Selected.Lat != mall.Lat {
		t.Errorf("pin = %+v, want the venue's name at the mall, no place id", *p.Selected)
	}
	if p.Fallback != "City Stars" || run.fallbacks.Load() != 1 {
		t.Errorf("fallback = %q (%d), want City Stars", p.Fallback, run.fallbacks.Load())
	}
	// Venue, the blank skipped, then the two tried in order; stops at the hit.
	if len(asked) != 3 || asked[2] != "City Stars Mall, Nasr City, Cairo" {
		t.Errorf("queries = %q", asked)
	}

	// A venue Google does know never touches its fallbacks.
	asked = nil
	searchText = func(context.Context, string, string, string, *extract.LatLng) ([]extract.Candidate, error) {
		return []extract.Candidate{mall}, nil
	}
	p, _ = h.resolve(context.Background(), nop, extract.Result{PlaceName: "City Stars", Fallbacks: []string{"x"}}, nil, &extractRun{})
	if p.Fallback != "" || p.Selected.GooglePlaceID != "mall1" {
		t.Errorf("direct match took a fallback: %+v", p)
	}
}
