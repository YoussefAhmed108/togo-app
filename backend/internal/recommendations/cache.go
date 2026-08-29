package recommendations

import (
	"context"
	"database/sql"
	"encoding/json"
	"time"
)

const cacheTTL = 48 * time.Hour

// GetCached retrieves Google Places results from the shared grid cache.
// Returns nil (not an error) on cache miss or when the entry is stale.
func GetCached(ctx context.Context, db *sql.DB, gridLat, gridLng float64, category string) ([]GooglePlace, error) {
	var resultsJSON string
	var cachedAt time.Time

	err := db.QueryRowContext(ctx,
		`SELECT results_json, cached_at FROM recommendations_cache
		 WHERE grid_lat = ? AND grid_lng = ? AND category = ?`,
		gridLat, gridLng, category,
	).Scan(&resultsJSON, &cachedAt)

	if err == sql.ErrNoRows {
		return nil, nil // cache miss
	}
	if err != nil {
		return nil, err
	}
	if time.Since(cachedAt) > cacheTTL {
		return nil, nil // stale
	}

	var places []GooglePlace
	if err := json.Unmarshal([]byte(resultsJSON), &places); err != nil {
		return nil, err
	}
	return places, nil
}

// SetCached upserts Google Places results into the shared grid cache.
func SetCached(ctx context.Context, db *sql.DB, gridLat, gridLng float64, category string, places []GooglePlace) error {
	b, err := json.Marshal(places)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx,
		`INSERT INTO recommendations_cache (grid_lat, grid_lng, category, results_json, cached_at)
		 VALUES (?, ?, ?, ?, NOW())
		 ON DUPLICATE KEY UPDATE results_json = VALUES(results_json), cached_at = NOW()`,
		gridLat, gridLng, category, string(b),
	)
	return err
}
