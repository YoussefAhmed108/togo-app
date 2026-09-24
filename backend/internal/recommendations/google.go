package recommendations

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"log"
	"net/http"
)

// GooglePlace is a single result from Google Places Nearby Search. The JSON
// names are what recommendations_cache stores, so they outlive the API that
// filled them: rows written from the legacy endpoint still decode.
type GooglePlace struct {
	Name     string  `json:"name"`
	Vicinity string  `json:"vicinity"`
	PlaceID  string  `json:"place_id"`
	Lat      float64 `json:"lat"`
	Lng      float64 `json:"lng"`
}

// nearbyURL is the Places API (New) endpoint, the same API extraction's Text
// Search already uses. The legacy maps.googleapis.com/place/nearbysearch
// endpoint is closed to new projects. A var so a test can point it elsewhere.
var nearbyURL = "https://places.googleapis.com/v1/places:searchNearby"

// nearbyFieldMask stays inside the Pro SKU ($32 / 1,000, the same as legacy
// Nearby Search). Rating, hours or price level would move it to Enterprise.
const nearbyFieldMask = "places.id,places.displayName,places.shortFormattedAddress,places.location"

// NearbySearch returns up to 20 places of one type around a point, most
// popular first. No results is an empty slice, not an error.
func NearbySearch(ctx context.Context, apiKey string, lat, lng float64, radiusM int, gq GoogleQuery) ([]GooglePlace, error) {
	body, _ := json.Marshal(map[string]any{
		"includedTypes":  []string{gq.Type},
		"maxResultCount": 20,
		"locationRestriction": map[string]any{"circle": map[string]any{
			"center": map[string]float64{"latitude": lat, "longitude": lng},
			"radius": float64(radiusM),
		}},
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, nearbyURL, bytes.NewReader(body))
	if err != nil {
		return nil, fmt.Errorf("nearbysearch request: %w", err)
	}
	// The key rides in a header now, so it can no longer leak through a
	// logged *url.Error the way the legacy query-string key could.
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	req.Header.Set("X-Goog-FieldMask", nearbyFieldMask)

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nearbysearch http: %w", err)
	}
	defer resp.Body.Close()

	var out struct {
		Places []struct {
			ID          string `json:"id"`
			DisplayName struct {
				Text string `json:"text"`
			} `json:"displayName"`
			ShortFormattedAddress string `json:"shortFormattedAddress"`
			Location              struct {
				Latitude  float64 `json:"latitude"`
				Longitude float64 `json:"longitude"`
			} `json:"location"`
		} `json:"places"`
		Error *struct {
			Status  string `json:"status"`
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&out); err != nil {
		return nil, fmt.Errorf("nearbysearch decode (HTTP %d): %w", resp.StatusCode, err)
	}
	if resp.StatusCode != http.StatusOK || out.Error != nil {
		// PERMISSION_DENIED (API not enabled, key restricted) and
		// RESOURCE_EXHAUSTED (quota) are the two worth recognising in the log.
		status := ""
		if out.Error != nil {
			status = out.Error.Status
		}
		log.Printf("recs: nearby HTTP %d, google status %q", resp.StatusCode, status)
		return nil, fmt.Errorf("google places status: %d %s", resp.StatusCode, status)
	}

	places := make([]GooglePlace, 0, len(out.Places))
	for _, p := range out.Places {
		places = append(places, GooglePlace{
			Name:     p.DisplayName.Text,
			Vicinity: p.ShortFormattedAddress,
			PlaceID:  p.ID,
			Lat:      p.Location.Latitude,
			Lng:      p.Location.Longitude,
		})
	}
	return places, nil
}
