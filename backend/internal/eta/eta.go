// Package eta answers "how long to drive there right now" from the Google
// Routes API route matrix.
//
// Traffic-aware lookups are the priciest Google call in the app ($10 / 1,000)
// and the only one that scales with how often people OPEN a Space. So a list
// never pays for traffic. It is estimated instead:
//
//		estimate = no-traffic drive time × traffic factor
//
//	  - No-traffic time (TRAFFIC_UNAWARE, $5 / 1,000, 10,000 free a month) does
//	    not change, so it is kept 30 days in eta_static and shared by everyone
//	    in the origin cell.
//	  - The traffic factor is learned per hour of the week, from the real
//	    traffic lookups made when someone opens a place (Google returns both
//	    durations in that one call at no extra cost). It is kept per trip
//	    (~5 km origin area → ~5 km destination area), per origin area, and for
//	    the whole city, and the most specific one with enough samples wins:
//	    from one origin, one direction can be 30% slower than free flow while
//	    another is faster.
//	  - A real traffic lookup (live) is kept 5 minutes in eta_cache, and any
//	    list shown in that window uses it instead of the estimate.
//
// Every answer is shared as widely as it honestly can be: the origin is
// snapped to a ~500 m cell and Google is asked from the cell centre, and the
// destination is its coordinates, not a place id, so one venue saved by fifty
// users is one row. Rows live in the DB, not process memory: Cloud Run scales
// to zero and runs up to three instances.
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
	_ "time/tzdata" // the Cloud Run image has no zoneinfo
)

const (
	// Cell is the origin grid in degrees: ~550 m N-S, ~480 m E-W at Cairo.
	Cell = 0.005
	// area is the grid a traffic factor is learned on (~5 km): fine enough to
	// tell Zamalek from New Cairo, coarse enough to fill up with samples.
	area = 0.05
	// TTL is how long a live traffic reading is served.
	TTL = 5 * time.Minute
	// staticTTL: a no-traffic drive time only moves when a road does.
	staticTTL = 30 * 24 * time.Hour
	// minSamples before a learned factor is trusted over a wider one.
	minSamples = 3
	// batch is the route matrix's element cap (origins × destinations).
	batch = 625
	// unroutable is cached for destinations Google cannot reach, so a pin in
	// the sea is paid for once.
	unroutable = -1
)

// cairo sets the hour of the week traffic is learned against.
//
// ponytail: one zone for every origin. Derive it from the coordinates when a
// second city launches in a different zone.
var cairo, _ = time.LoadLocation("Africa/Cairo")

// endpoint is a var so the test can point it at a fake Google.
var endpoint = "https://routes.googleapis.com/distanceMatrix/v2:computeRouteMatrix"

// now is a var so the test can pin the hour of the week.
var now = time.Now

type Dest struct {
	ID       uint64
	Lat, Lng float64
}

// Result is one drive time. Live is true for a real traffic reading, false
// for an estimate from the no-traffic time and the learned factor.
type Result struct {
	Seconds int  `json:"seconds"`
	Live    bool `json:"live"`
}

// Snap moves a coordinate to the centre of its cell. Idempotent, so a client
// that already snapped (and never sent its exact position) lands in the same
// cell.
func Snap(v float64) float64 { return (math.Floor(v/Cell) + 0.5) * Cell }

func coord(lat, lng float64) string { return fmt.Sprintf("%.5f,%.5f", lat, lng) }

func areaKey(lat, lng float64) string {
	return fmt.Sprintf("%.2f,%.2f", math.Floor(lat/area)*area, math.Floor(lng/area)*area)
}

func tripKey(from string, d Dest) string { return from + ">" + areaKey(d.Lat, d.Lng) }

func hourOfWeek(t time.Time) int {
	t = t.In(cairo)
	return int(t.Weekday())*24 + t.Hour()
}

// Estimate returns drive times for a list: a live reading where one is fresh,
// otherwise the no-traffic time times the learned factor. It never pays for
// traffic. Destinations Google cannot route are absent.
//
// ponytail: two members opening the same Space in the same second both miss
// and both pay. Add singleflight when the logs show that happening.
func Estimate(ctx context.Context, db *sql.DB, apiKey string, lat, lng float64, dests []Dest) map[uint64]Result {
	olat, olng := Snap(lat), Snap(lng)
	origin := coord(olat, olng)
	live := load(ctx, db, "eta_cache", origin, dests, TTL)
	static := load(ctx, db, "eta_static", origin, dests, staticTTL)

	var miss []string
	seen := map[string]bool{}
	for _, d := range dests {
		k := coord(d.Lat, d.Lng)
		_, isLive := live[k]
		_, isStatic := static[k]
		if !isLive && !isStatic && !seen[k] {
			seen[k] = true
			miss = append(miss, k)
		}
	}
	if apiKey != "" {
		for i := 0; i < len(miss); i += batch {
			staticOf := map[string]int{}
			for k, d := range matrix(ctx, apiKey, origin, miss[i:min(i+batch, len(miss))], false) {
				staticOf[k] = d.static
				static[k] = d.static
			}
			store(ctx, db, "eta_static", origin, staticOf)
		}
	}

	from := areaKey(olat, olng)
	factor := trafficFactors(ctx, db, from, dests, hourOfWeek(now()))
	out := make(map[uint64]Result, len(dests))
	for _, d := range dests {
		k := coord(d.Lat, d.Lng)
		if s, ok := live[k]; ok {
			if s != unroutable {
				out[d.ID] = Result{Seconds: s, Live: true}
			}
			continue
		}
		if s, ok := static[k]; ok && s != unroutable {
			out[d.ID] = Result{Seconds: int(math.Round(float64(s) * factor(d)))}
		}
	}
	return out
}

// Live pays for one real traffic reading. It also refreshes the no-traffic
// time and teaches the area's traffic factor, which is what keeps every
// Estimate honest.
func Live(ctx context.Context, db *sql.DB, apiKey string, lat, lng float64, d Dest) (Result, bool) {
	olat, olng := Snap(lat), Snap(lng)
	origin, k := coord(olat, olng), coord(d.Lat, d.Lng)
	if s, ok := load(ctx, db, "eta_cache", origin, []Dest{d}, TTL)[k]; ok {
		return Result{Seconds: s, Live: true}, s != unroutable
	}
	if apiKey == "" {
		return Result{}, false
	}
	got, ok := matrix(ctx, apiKey, origin, []string{k}, true)[k]
	if !ok {
		return Result{}, false
	}
	store(ctx, db, "eta_cache", origin, map[string]int{k: got.live})
	store(ctx, db, "eta_static", origin, map[string]int{k: got.static})
	if got.live == unroutable {
		return Result{}, false
	}
	learn(ctx, db, areaKey(olat, olng), d, hourOfWeek(now()), got)
	return Result{Seconds: got.live, Live: true}, true
}

func load(ctx context.Context, db *sql.DB, table, origin string, dests []Dest, ttl time.Duration) map[string]int {
	out := map[string]int{}
	if db == nil || len(dests) == 0 {
		return out
	}
	args := []any{origin}
	for _, d := range dests {
		args = append(args, coord(d.Lat, d.Lng))
	}
	rows, err := db.QueryContext(ctx,
		`SELECT dest, seconds, cached_at FROM `+table+` WHERE origin_cell = ? AND dest IN (?`+
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
		if rows.Scan(&dest, &s, &at) == nil && time.Since(at) < ttl {
			out[dest] = s
		}
	}
	return out
}

// store upserts in one statement. Rows are overwritten, never deleted, so a
// table is bounded by distinct (cell, venue) pairs, ~60 bytes each.
//
// ponytail: no purge. A million pairs is ~60 MB; add a nightly
// DELETE ... WHERE cached_at < NOW() - INTERVAL 31 DAY when it gets there.
func store(ctx context.Context, db *sql.DB, table, origin string, secs map[string]int) {
	if db == nil || len(secs) == 0 {
		return
	}
	args := make([]any, 0, 3*len(secs))
	for k, s := range secs {
		args = append(args, origin, k, s)
	}
	db.ExecContext(ctx,
		`INSERT INTO `+table+` (origin_cell, dest, seconds) VALUES (?,?,?)`+
			strings.Repeat(",(?,?,?)", len(secs)-1)+
			` ON DUPLICATE KEY UPDATE seconds = VALUES(seconds), cached_at = CURRENT_TIMESTAMP`,
		args...)
}

// trafficFactors returns how much slower than free flow each trip is at this
// hour of the week: the trip's own factor, else the origin area's, else the
// city's, else 1 (the no-traffic time) until enough opens have taught it.
func trafficFactors(ctx context.Context, db *sql.DB, from string, dests []Dest, how int) func(Dest) float64 {
	learned := map[string]float64{}
	if db != nil {
		keys := []any{from, "*"}
		for _, d := range dests {
			keys = append(keys, tripKey(from, d))
		}
		rows, err := db.QueryContext(ctx,
			`SELECT area, ratio, samples FROM eta_traffic WHERE hour_of_week = ? AND area IN (?`+
				strings.Repeat(",?", len(keys)-1)+`)`, append([]any{how}, keys...)...)
		if err == nil {
			defer rows.Close()
			for rows.Next() {
				var a string
				var ratio float64
				var n int
				if rows.Scan(&a, &ratio, &n) == nil && n >= minSamples {
					learned[a] = ratio
				}
			}
		}
	}
	return func(d Dest) float64 { return pick(learned, from, d) }
}

// pick is the most specific learned factor for a trip: its own, its origin
// area's, the city's, else 1.
func pick(learned map[string]float64, from string, d Dest) float64 {
	for _, k := range []string{tripKey(from, d), from, "*"} {
		if f, ok := learned[k]; ok {
			return f
		}
	}
	return 1
}

// learn folds one reading into the trip's, the origin area's and the city's
// factor for this hour as a moving average, so this week's traffic outweighs
// last month's.
func learn(ctx context.Context, db *sql.DB, from string, d Dest, how int, got durations) {
	// Under a minute the ratio is mostly noise: one traffic light doubles it.
	if db == nil || got.static < 60 || got.live <= 0 {
		return
	}
	r := float64(got.live) / float64(got.static)
	db.ExecContext(ctx,
		`INSERT INTO eta_traffic (area, hour_of_week, ratio, samples) VALUES (?,?,?,1),(?,?,?,1),('*',?,?,1)
		 ON DUPLICATE KEY UPDATE ratio = ratio * 0.8 + VALUES(ratio) * 0.2, samples = samples + 1`,
		tripKey(from, d), how, r, from, how, r, how, r)
}

type durations struct{ live, static int }

// matrix asks Google for one origin and up to 625 destinations. With traffic
// it returns both the traffic and no-traffic duration from one call; without,
// both are the no-traffic duration. A failed call returns nothing, so nothing
// is cached and the next open retries.
func matrix(ctx context.Context, apiKey, origin string, dests []string, traffic bool) map[string]durations {
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
	// TRAFFIC_UNAWARE bills as Essentials ($5 / 1,000); TRAFFIC_AWARE as Pro
	// ($10). _OPTIMAL is slower, caps at 100 elements, and bills higher.
	pref, mask := "TRAFFIC_UNAWARE", "originIndex,destinationIndex,status,condition,duration"
	if traffic {
		pref, mask = "TRAFFIC_AWARE", mask+",staticDuration"
	}
	body, _ := json.Marshal(map[string]any{
		"origins":           []map[string]any{waypoint(origin)},
		"destinations":      ds,
		"travelMode":        "DRIVE",
		"routingPreference": pref,
	})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(body))
	if err != nil {
		return nil
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("X-Goog-Api-Key", apiKey)
	// Required: without a field mask the API rejects the call.
	req.Header.Set("X-Goog-FieldMask", mask)
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
		Condition      string `json:"condition"`
		Duration       string `json:"duration"`       // "1080s"
		StaticDuration string `json:"staticDuration"` // traffic calls only
	}
	if resp.StatusCode != http.StatusOK || json.NewDecoder(resp.Body).Decode(&els) != nil {
		return nil
	}

	out := map[string]durations{}
	for _, el := range els {
		if el.DestinationIndex < 0 || el.DestinationIndex >= len(dests) || (el.Status != nil && el.Status.Code != 0) {
			continue
		}
		k := dests[el.DestinationIndex]
		if el.Condition == "ROUTE_NOT_FOUND" {
			out[k] = durations{unroutable, unroutable}
			continue
		}
		d, err := time.ParseDuration(el.Duration)
		if err != nil {
			continue
		}
		got := durations{int(d.Seconds()), int(d.Seconds())}
		if s, err := time.ParseDuration(el.StaticDuration); err == nil {
			got.static = int(s.Seconds())
		}
		out[k] = got
	}
	return out
}
