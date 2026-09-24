// Package eta answers "how long to drive there right now" from the Google
// Routes API route matrix, in current traffic.
//
// Routes replaced the legacy Distance Matrix API (closed to new projects, and
// its traffic price stops falling at $8 / 1,000). Traffic-aware elements start
// at $10 per 1,000 and drop to $3 past 1M a month: the priciest Google call in the
// app, and the only one that scales with how often people OPEN a Space rather
// than with how much they add. So every answer is shared as widely as it can
// honestly be:
//
//   - The origin is snapped to a ~500 m cell and Google is asked from the cell
//     centre, so everyone standing in it — a group deciding together, one
//     campus, one compound — gets one answer. That is a minute or two of error
//     in Cairo traffic.
//   - The destination is its coordinates, not a place id: one venue saved by
//     fifty users is one row.
//   - Rows live in the DB, not process memory. Cloud Run scales to zero and
//     runs up to three instances; an in-memory cache would be emptied by the
//     first and split three ways by the second.
//
// A cache error is never fatal — it degrades to asking Google.
package eta

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"fmt"
	"math"
	"net/http"
	"strings"
	"time"
)

const (
	// Cell is the origin grid in degrees: ~550 m N-S, ~480 m E-W at Cairo.
	Cell = 0.005
	// TTL is how long a traffic reading is served: the same freshness the app
	// had when each phone cached its own answers, now shared by everyone in
	// the cell. Traffic moves too fast for longer.
	TTL = 5 * time.Minute
	// batch is the route matrix's element cap (origins × destinations).
	batch = 625
	// unroutable is cached for destinations Google cannot reach, so a pin in
	// the sea is paid for once, not on every open.
	unroutable = -1
)

// endpoint is a var so the test can point it at a fake Google.
var endpoint = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"

type Dest struct {
	ID       uint64
	Lat, Lng float64
}

// Snap moves a coordinate to the centre of its cell. Idempotent, so a client
// that already snapped (and never sent its exact position) lands in the same
// cell.
func Snap(v float64) float64 { return (math.Floor(v/Cell) + 0.5) * Cell }

func coord(lat, lng float64) string { return fmt.Sprintf("%.5f,%.5f", lat, lng) }

// Lookup returns driving seconds keyed by Dest.ID. Destinations Google could
// not route, or that failed, are absent.
//
// ponytail: two members opening the same Space in the same second both miss
// and both pay. Add singleflight when the logs show that happening.
func Lookup(ctx context.Context, db *sql.DB, apiKey string, lat, lng float64, dests []Dest) map[uint64]int {
	origin := coord(Snap(lat), Snap(lng))
	secs := load(ctx, db, origin, dests)

	var miss []string
	seen := map[string]bool{}
	for _, d := range dests {
		k := coord(d.Lat, d.Lng)
		if _, ok := secs[k]; !ok && !seen[k] {
			seen[k] = true
			miss = append(miss, k)
		}
	}
	if apiKey != "" {
		for i := 0; i < len(miss); i += batch {
			got := matrix(ctx, apiKey, origin, miss[i:min(i+batch, len(miss))])
			store(ctx, db, origin, got)
			for k, s := range got {
				secs[k] = s
			}
		}
	}

	out := make(map[uint64]int, len(dests))
	for _, d := range dests {
		if s, ok := secs[coord(d.Lat, d.Lng)]; ok && s != unroutable {
			out[d.ID] = s
		}
	}
	return out
}

func load(ctx context.Context, db *sql.DB, origin string, dests []Dest) map[string]int {
	out := map[string]int{}
	if db == nil || len(dests) == 0 {
		return out
	}
	args := []any{origin}
	for _, d := range dests {
		args = append(args, coord(d.Lat, d.Lng))
	}
	rows, err := db.QueryContext(ctx,
		`SELECT dest, seconds, cached_at FROM eta_cache WHERE origin_cell = ? AND dest IN (?`+
			strings.Repeat(",?", len(dests)-1)+`)`, args...)
	if err != nil {
		return out
	}
	defer rows.Close()
	for rows.Next() {
		var dest string
		var s int
		var at time.Time
		// Age is checked in Go, like the extraction caches: no reliance on the
		// DB and the process agreeing on a clock or a zone.
		if rows.Scan(&dest, &s, &at) == nil && time.Since(at) < TTL {
			out[dest] = s
		}
	}
	return out
}

// store upserts in one statement. Rows are overwritten, never deleted, so the
// table is bounded by distinct (cell, venue) pairs, ~60 bytes each.
//
// ponytail: no purge. A million pairs is ~60 MB; add a nightly
// DELETE ... WHERE cached_at < NOW() - INTERVAL 1 DAY when it gets there.
func store(ctx context.Context, db *sql.DB, origin string, secs map[string]int) {
	if db == nil || len(secs) == 0 {
		return
	}
	args := make([]any, 0, 3*len(secs))
	for k, s := range secs {
		args = append(args, origin, k, s)
	}
	db.ExecContext(ctx,
		`INSERT INTO eta_cache (origin_cell, dest, seconds) VALUES (?,?,?)`+
			strings.Repeat(",(?,?,?)", len(secs)-1)+
			` ON DUPLICATE KEY UPDATE seconds = VALUES(seconds), cached_at = CURRENT_TIMESTAMP`,
		args...)
}

// matrix asks Google for one origin and up to 625 destinations. A failed call
// returns nothing, so nothing is cached and the next open retries.
func matrix(ctx context.Context, apiKey, origin string, dests []string) map[string]int {
	waypoint := func(c string) map[string]any {
		var lat, lng float64
		fmt.Sscanf(c, "%f,%f", &lat, &lng)
		return map[string]any{"waypoint": map[string]any{"location": map[string]any{
			"latLng": map[string]float64{"latitude": lat, "longitude": lng}}}}
	}
	ds := make([]map[string]any, len(dests))
	for i, d := range dests {
		ds[i] = waypoint(d)
	}
	body, _ := json.Marshal(map[string]any{
		"origins":      []map[string]any{waypoint(origin)},
		"destinations": ds,
		"travelMode":   "DRIVE",
		// TRAFFIC_AWARE is the traffic SKU the pricing assumes. _OPTIMAL is
		// slower, caps at 100 elements, and bills higher.
		"routingPreference": "TRAFFIC_AWARE",
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	// Required: without a field mask the API rejects the call.
	req.Header.Set("X-Goog-FieldMask", "originIndex,destinationIndex,status,condition,duration")
	resp, err := (&http.Client{Timeout: 10 * time.Second}).Do(req)
	if err != nil {
		return nil
	}
	defer resp.Body.Close()

	// One element per destination, in any order. Zero indexes are omitted
	// from the JSON, which decodes to 0 — correct. A whole-request failure is
	// an error object, not an array, so it fails the decode and returns nil.
	var els []struct {
		DestinationIndex int `json:"destinationIndex"`
		Status           *struct {
			Code int `json:"code"`
		} `json:"status"`
		Condition string `json:"condition"`
		Duration  string `json:"duration"` // "1080s"
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&els) != nil {
		return nil
	}

	out := map[string]int{}
	for _, el := range els {
		if el.DestinationIndex < 0 || el.DestinationIndex >= len(dests) || (el.Status != nil && el.Status.Code != 0) {
			continue
		}
		k := dests[el.DestinationIndex]
		if el.Condition == "ROUTE_NOT_FOUND" {
			out[k] = unroutable
			continue
		}
		if d, err := time.ParseDuration(el.Duration); err == nil {
			out[k] = int(d.Seconds())
		}
	}
	return out
}
