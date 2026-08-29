package recommendations

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
)

// GooglePlace is a single result from the Google Places Nearby Search API.
type GooglePlace struct {
	Name    string  `json:"name"`
	Vicinity string `json:"vicinity"`
	PlaceID string  `json:"place_id"`
	Lat     float64 `json:"lat"`
	Lng     float64 `json:"lng"`
}

type nearbySearchResponse struct {
	Results []struct {
		Name     string `json:"name"`
		Vicinity string `json:"vicinity"`
		PlaceID  string `json:"place_id"`
		Geometry struct {
			Location struct {
				Lat float64 `json:"lat"`
				Lng float64 `json:"lng"`
			} `json:"location"`
		} `json:"geometry"`
	} `json:"results"`
	Status string `json:"status"`
}

// NearbySearch calls the Google Places Legacy Nearby Search endpoint and
// returns up to 20 results. Only basic fields (name, vicinity, geometry,
// place_id) are requested, keeping billing at the lowest tier.
//
// Returns an empty slice (not an error) when the API returns ZERO_RESULTS.
func NearbySearch(ctx context.Context, apiKey string, lat, lng float64, radiusM int, gq GoogleQuery) ([]GooglePlace, error) {
	params := url.Values{}
	params.Set("location", fmt.Sprintf("%f,%f", lat, lng))
	params.Set("radius", fmt.Sprintf("%d", radiusM))
	params.Set("type", gq.Type)
	if gq.Keyword != "" {
		params.Set("keyword", gq.Keyword)
	}
	params.Set("key", apiKey)
	params.Set("fields", "name,vicinity,geometry,place_id")

	endpoint := "https://maps.googleapis.com/maps/api/place/nearbysearch/json?" + params.Encode()

	req, err := http.NewRequestWithContext(ctx, http.MethodGet, endpoint, nil)
	if err != nil {
		return nil, fmt.Errorf("nearbysearch request: %w", err)
	}

	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, fmt.Errorf("nearbysearch http: %w", err)
	}
	defer resp.Body.Close()

	var body nearbySearchResponse
	if err := json.NewDecoder(resp.Body).Decode(&body); err != nil {
		return nil, fmt.Errorf("nearbysearch decode: %w", err)
	}

	if body.Status == "ZERO_RESULTS" {
		return nil, nil
	}
	if body.Status != "OK" {
		return nil, fmt.Errorf("google places status: %s", body.Status)
	}

	places := make([]GooglePlace, 0, len(body.Results))
	for _, r := range body.Results {
		places = append(places, GooglePlace{
			Name:     r.Name,
			Vicinity: r.Vicinity,
			PlaceID:  r.PlaceID,
			Lat:      r.Geometry.Location.Lat,
			Lng:      r.Geometry.Location.Lng,
		})
	}
	return places, nil
}
