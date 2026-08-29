package extract

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"time"
)

// Candidate is one Google Places match, flattened to what the create-place
// form binds to. GooglePlaceID is the dedupe key — the same venue shared from
// several TikToks must not create several rows.
type Candidate struct {
	GooglePlaceID string  `json:"google_place_id"`
	Name          string  `json:"name"`
	Address       string  `json:"address"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	MapsURL       string  `json:"maps_url"`
}

// searchTextURL is the Places API (New) endpoint. The legacy
// maps.googleapis.com/place/textsearch endpoint used elsewhere in this repo is
// deprecated and closed to new projects.
const searchTextURL = "https://places.googleapis.com/v1/places:searchText"

// fieldMask keeps the request in the cheaper Pro SKU. Adding rating,
// opening hours or phone moves it to Enterprise — only do that if the
// create-place form actually shows those fields.
const fieldMask = "places.id,places.displayName,places.formattedAddress,places.location,places.googleMapsUri"

// SearchText returns up to 5 candidates. Billing is per request, not per
// result, so extra candidates are free — the form shows a picker when the top
// hit is wrong, which matters for chains with many branches.
func SearchText(ctx context.Context, apiKey, query, languageCode string) ([]Candidate, error) {
	payload := map[string]any{
		"textQuery":      query,
		"maxResultCount": 5,
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

	req, err := http.NewRequestWithContext(ctx, http.MethodPost, searchTextURL, bytes.NewReader(body))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", fieldMask)

	resp, err := (&http.Client{Timeout: 15 * time.Second}).Do(req)
	if err != nil {
		return nil, fmt.Errorf("places: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		Places []struct {
			ID          string                `json:"id"`
			DisplayName struct{ Text string } `json:"displayName"`
			Address     string                `json:"formattedAddress"`
			Location    struct {
				Lat float64 `json:"latitude"`
				Lng float64 `json:"longitude"`
			} `json:"location"`
			GoogleMapsURI string `json:"googleMapsUri"`
		} `json:"places"`
		Error *struct {
			Message string `json:"message"`
			Status  string `json:"status"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("places decode: %w", err)
	}
	if out.Error != nil {
		return nil, fmt.Errorf("places %s: %s", out.Error.Status, out.Error.Message)
	}

	cands := make([]Candidate, 0, len(out.Places))
	for _, p := range out.Places {
		cands = append(cands, Candidate{
			GooglePlaceID: p.ID,
			Name:          p.DisplayName.Text,
			Address:       p.Address,
			Lat:           p.Location.Lat,
			Lng:           p.Location.Lng,
			MapsURL:       mapsURL(p.ID, p.GoogleMapsURI),
		})
	}
	return cands, nil
}

func mapsURL(id, uri string) string {
	if uri != "" {
		return uri
	}
	return "https://www.google.com/maps/place/?q=place_id:" + id
}
