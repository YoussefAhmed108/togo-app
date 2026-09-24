package extract

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestSearchTextStaysOnCheapSKUs(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mask := r.Header.Get("X-Goog-FieldMask")
		// Any Pro field (displayName, googleMapsUri, ...) would bill the Pro SKU.
		for _, pro := range []string{"displayName", "googleMapsUri", "rating"} {
			if strings.Contains(mask, pro) {
				t.Errorf("%s %s asks for Pro field %s", r.Method, r.URL.Path, pro)
			}
		}
		switch {
		case r.Method == http.MethodPost:
			if mask != "places.id" {
				t.Errorf("search mask = %q, want IDs only (free SKU)", mask)
			}
			w.Write([]byte(`{"places":[{"id":"A"},{"id":"B"},{"id":"C"}]}`))
		case strings.HasSuffix(r.URL.Path, "/B"):
			w.WriteHeader(http.StatusInternalServerError)
			w.Write([]byte(`{"error":{"status":"INTERNAL","message":"boom"}}`))
		default:
			id := r.URL.Path[strings.LastIndex(r.URL.Path, "/")+1:]
			w.Write([]byte(`{"formattedAddress":"` + id + ` St, Cairo","location":{"latitude":30.1,"longitude":31.2}}`))
		}
	}))
	defer srv.Close()
	oldS, oldD := searchTextURL, detailsURL
	searchTextURL, detailsURL = srv.URL+"/v1/places:searchText", srv.URL+"/v1/places/"
	defer func() { searchTextURL, detailsURL = oldS, oldD }()

	got, err := SearchText(context.Background(), "k", "Sushimi Cairo", "", nil)
	if err != nil {
		t.Fatal(err)
	}
	// B's details failed: dropped, and Google's ranking kept for the rest.
	if len(got) != 2 || got[0].GooglePlaceID != "A" || got[1].GooglePlaceID != "C" {
		t.Fatalf("got %+v, want A then C", got)
	}
	if got[0].Name != "" || got[0].Address != "A St, Cairo" || got[0].Lat != 30.1 {
		t.Errorf("candidate = %+v: want address and location, name left to the caller", got[0])
	}
	if got[0].MapsURL != "https://www.google.com/maps/place/?q=place_id:A" {
		t.Errorf("maps url = %q", got[0].MapsURL)
	}
}
