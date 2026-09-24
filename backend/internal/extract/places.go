package extract

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"sync"
	"time"
)

// Candidate is one Google Places match, flattened to what the create-place
// form binds to. GooglePlaceID is the dedupe key — the same venue shared from
// several TikToks must not create several rows. Name is filled by the caller
// from the video read (see SearchText).
type Candidate struct {
	GooglePlaceID string  `json:"google_place_id"`
	Name          string  `json:"name"`
	Address       string  `json:"address"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	MapsURL       string  `json:"maps_url"`
}

// Venue search is two Places API (New) calls, both chosen for price:
//
//   - Text Search with only place IDs in the field mask is the "Essentials
//     (IDs Only)" SKU, which Google does not charge for at all.
//   - Place Details for each candidate asks only for address and location,
//     the Essentials SKU: $5 / 1,000 with 10,000 free a month.
//
// The single Text Search Pro call this replaced was $32 / 1,000. What it
// gave up is Google's own display name and Maps link (both Pro fields): the
// name is what the model read off the video, which the caller fills in, and
// the link is built from the place ID. Chain branches share a name anyway;
// the address is what tells them apart in the picker.
//
// URLs are vars so tests can point them at a fake Google.
var (
	searchTextURL = "https://places.googleapis.com/v1/places:searchText"
	detailsURL    = "https://places.googleapis.com/v1/places/"
)

// maxCandidates is how many branches the picker shows. Each one is a paid
// Details call, so it is also the per-search cost multiplier.
const maxCandidates = 3

// DetailsUSD is the Place Details Essentials list price per call. Google
// returns no cost with the response, and this ignores the 10,000 free a
// month, so at low volume the real bill is lower — Cloud Billing is the
// source of truth for totals.
const DetailsUSD = 0.005

// LatLng is where the sharer is. It biases the search, it never restricts it:
// a video filmed in another city must still resolve there.
type LatLng struct {
	Lat float64
	Lng float64
}

// biasRadiusM is the Places API (New) maximum for a circle bias — city scale.
const biasRadiusM = 50000.0

// SearchText returns up to 3 candidates with address and location, and no
// name: the caller names them. Candidates whose details fail are dropped; an
// error means Google could not be reached at all, so nothing is cached.
//
// near, when set, ranks results around the sharer. Without it "Fresh Noodles"
// resolves to whichever branches Google ranks first worldwide (NYC, Paris…).
func SearchText(ctx context.Context, apiKey, query, languageCode string, near *LatLng) ([]Candidate, error) {
	payload := map[string]any{
		"textQuery":      query,
		"maxResultCount": maxCandidates,
	}
	if near != nil {
		payload["locationBias"] = map[string]any{
			"circle": map[string]any{
				"center": map[string]float64{"latitude": near.Lat, "longitude": near.Lng},
				"radius": biasRadiusM,
			},
		}
	}
	// Omit rather than guess: with no languageCode Google infers one from the
	// query script, which beats sending a code the model was unsure about.
	if languageCode != "" {
		payload["languageCode"] = languageCode
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return nil, err
	}

	logf(ctx, "places: query=%q lang=%q biased=%t", query, languageCode, near != nil)
	var found struct {
		Places []struct {
			ID string `json:"id"`
		} `json:"places"`
	}
	// IDs only: anything more in this mask moves the search off the free SKU.
	if err := placesCall(ctx, apiKey, http.MethodPost, searchTextURL, "places.id", body, &found); err != nil {
		return nil, err
	}
	logf(ctx, "places: %d result(s)", len(found.Places))

	cands := make([]Candidate, len(found.Places))
	ok := make([]bool, len(found.Places))
	var wg sync.WaitGroup
	for i, p := range found.Places {
		wg.Add(1)
		go func() {
			defer wg.Done()
			u := detailsURL + url.PathEscape(p.ID)
			if languageCode != "" {
				u += "?languageCode=" + url.QueryEscape(languageCode)
			}
			var d struct {
				Address  string `json:"formattedAddress"`
				Location struct {
					Lat float64 `json:"latitude"`
					Lng float64 `json:"longitude"`
				} `json:"location"`
			}
			if err := placesCall(ctx, apiKey, http.MethodGet, u, "formattedAddress,location", nil, &d); err != nil {
				logf(ctx, "places: details %s: %v", p.ID, err)
				return
			}
			cands[i] = Candidate{GooglePlaceID: p.ID, Address: d.Address, Lat: d.Location.Lat, Lng: d.Location.Lng, MapsURL: mapsURL(p.ID, "")}
			ok[i] = true
		}()
	}
	wg.Wait()

	// Keep Google's ranking; the first is what the form pre-selects.
	out := make([]Candidate, 0, len(cands))
	for i, c := range cands {
		if ok[i] {
			out = append(out, c)
		}
	}
	if len(found.Places) > 0 && len(out) == 0 {
		return nil, fmt.Errorf("places: every details call failed")
	}
	return out, nil
}

// placesCall sends one Places API (New) request and decodes the answer into
// out. The field mask decides the SKU, so every caller states it explicitly.
func placesCall(ctx context.Context, apiKey, method, u, fieldMask string, body []byte, out any) error {
	var rd io.Reader
	if body != nil {
		rd = bytes.NewReader(body)
	}
	req, err := http.NewRequestWithContext(ctx, method, u, rd)
	if err != nil {
		return err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)
	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return fmt.Errorf("places: %w", err)
	}
	defer resp.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(resp.Body, 1<<20))
	if err != nil {
		return fmt.Errorf("places read: %w", err)
	}
	var e struct {
		Error *struct {
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	if json.Unmarshal(raw, &e) == nil && e.Error != nil {
		return fmt.Errorf("places %s: %s", e.Error.Status, e.Error.Message)
	}
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("places: HTTP %d", resp.StatusCode)
	}
	if err := json.Unmarshal(raw, out); err != nil {
		return fmt.Errorf("places decode: %w", err)
	}
	return nil
}

func mapsURL(id, uri string) string {
	if uri != "" {
		return uri
	}
	return "https://www.google.com/maps/place/?q=place_id:" + id
}
