package extract

// Extraction caching.
//
// One uncached extraction is ~$0.041 and ~9-13s: ~$0.032 Google Places Text
// Search, ~$0.009 Claude vision, and a video download that dominates the wall
// clock. Two independent caches, because they catch different things:
//
//	URL cache    — the same video shared again. Skips everything. Only
//	               served once a user confirmed the answer was right.
//	Query cache  — the same VENUE, from a different video. Skips Google.
//
// The query cache is the one that compounds. Any city has a bounded set of
// venues worth filming and TikTok concentrates hard on whichever are having a
// moment, so one restaurant arrives from dozens of unrelated videos. The URL
// cache misses every one of those; the query cache turns them into a single
// paid lookup. Nothing here is tuned to one city — the key is whatever the
// model read, so each market warms its own working set independently.
//
// A cache error is never fatal. Every function here degrades to "not cached",
// and the caller does the real work.

import (
	"context"
	"crypto/sha256"
	"database/sql"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"math"
	"net/url"
	"regexp"
	"strings"
	"time"
	"unicode"
)

const (
	// urlTTL is short: a re-shared video should pick up an improved extraction
	// prompt within a day.
	urlTTL = 24 * time.Hour
	// queryTTL is long because the answer barely moves — a venue's coordinates
	// and Google place ID are stable for months. Closures and renames
	// self-correct within the month, which is the same staleness a user would
	// get from Google's own index anyway.
	queryTTL = 30 * 24 * time.Hour
)

// videoID pulls TikTok's numeric video ID out of a long-form share URL.
// Short links (vm./vt./t/) do not carry it — those are keyed on the URL until
// yt-dlp resolves them, at which point StoreURL writes the ID key too.
var videoID = regexp.MustCompile(`/video/(\d+)`)

// normalizeURL strips what varies between shares of the same video. TikTok
// appends per-share tracking params (?_t=&_r=&is_from_webapp=...), so hashing
// the raw URL would give a near-zero hit rate — every share of one video is a
// different string.
func normalizeURL(raw string) string {
	if m := videoID.FindStringSubmatch(raw); m != nil {
		return "tiktok:" + m[1] // canonical: same video, any account path or host
	}
	u, err := url.Parse(raw)
	if err != nil {
		return strings.TrimSpace(raw)
	}
	u.RawQuery, u.Fragment = "", ""
	u.Host = strings.TrimPrefix(strings.ToLower(u.Host), "www.")
	u.Path = strings.TrimSuffix(u.Path, "/")
	return u.String()
}

// urlCacheVersion is bumped whenever a cached extraction payload would read
// back wrong under the current response shape. v2: responses carry every
// venue in `places`; a v1 entry would unmarshal fine with only one of them.
const urlCacheVersion = "v2|"

// VideoKey is the URL cache key for a resolved video ID, so a short link and
// the long link it redirects to share one cache entry.
func VideoKey(id string) string { return hashKey(urlCacheVersion + "tiktok:" + id) }

// URLKey is the URL cache key for a raw share link.
func URLKey(raw string) string { return hashKey(urlCacheVersion + normalizeURL(raw)) }

func hashKey(s string) string {
	sum := sha256.Sum256([]byte(s))
	return hex.EncodeToString(sum[:])
}

// AreaKey scopes a cache key to the sharer's area. Candidates are ranked
// around the sharer, so an answer cached in Cairo must not be served in Paris;
// sharers in the same city still share entries. nil (no location) keeps the
// key global, as before.
//
// ponytail: 0.5° cells (~55 km) — a metro area. Two cells can split one city at
// a boundary; that costs a duplicate lookup, never a wrong answer.
func AreaKey(key string, near *LatLng) string {
	if near == nil {
		return key
	}
	cell := fmt.Sprintf("%.1f,%.1f", math.Round(near.Lat*2)/2, math.Round(near.Lng*2)/2)
	return hashKey(key + "|" + cell)
}

// LookupURL returns a cached extraction payload, or ok=false when absent,
// stale, unreadable, or not yet confirmed by a user. An unconfirmed answer is
// never served: a wrong pin shared from the cache would reach every re-sharer.
func LookupURL(ctx context.Context, db *sql.DB, key string, out any) bool {
	if db == nil {
		return false
	}
	var body string
	var createdAt time.Time
	err := db.QueryRowContext(ctx,
		`SELECT result_json, created_at FROM url_extractions WHERE url_hash = ? AND confirmed`,
		key,
	).Scan(&body, &createdAt)
	if err != nil || time.Since(createdAt) > urlTTL {
		return false
	}
	// A stored payload that no longer matches the struct is a miss, not an
	// error — the shape changes whenever extractResponse gains a field.
	return json.Unmarshal([]byte(body), out) == nil
}

// StoreURL writes the payload under every key that identifies this video. The
// caller passes both the request-URL key and, once yt-dlp has resolved the
// video, the video-ID key — that is what lets a vm.tiktok.com link and the
// canonical link hit each other.
//
// confirmed=false stores it pending: LookupURL skips it until ConfirmURL.
func StoreURL(ctx context.Context, db *sql.DB, keys []string, raw string, payload any, confirmed bool) error {
	if db == nil || len(keys) == 0 {
		return nil
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	for _, k := range keys {
		if k == "" {
			continue
		}
		if _, err := db.ExecContext(ctx,
			`INSERT INTO url_extractions (url_hash, url, result_json, confirmed)
			 VALUES (?, ?, ?, ?)
			 ON DUPLICATE KEY UPDATE result_json = VALUES(result_json), confirmed = VALUES(confirmed), created_at = CURRENT_TIMESTAMP`,
			k, truncate(raw, 2048), string(body), confirmed,
		); err != nil {
			return err
		}
	}
	return nil
}

// ConfirmURL makes a stored extraction servable — a user said it was right.
func ConfirmURL(ctx context.Context, db *sql.DB, keys []string) error {
	return execKeys(ctx, db, `UPDATE url_extractions SET confirmed = TRUE WHERE url_hash = ?`, keys)
}

// ForgetURL drops a stored extraction — a user said it was wrong, so the next
// share of that video is read afresh instead of repeating the mistake.
func ForgetURL(ctx context.Context, db *sql.DB, keys []string) error {
	return execKeys(ctx, db, `DELETE FROM url_extractions WHERE url_hash = ?`, keys)
}

func execKeys(ctx context.Context, db *sql.DB, stmt string, keys []string) error {
	if db == nil {
		return nil
	}
	for _, k := range keys {
		if _, err := db.ExecContext(ctx, stmt, k); err != nil {
			return err
		}
	}
	return nil
}

// nonWord matches everything that is not a letter or a digit, in any script.
var nonWord = regexp.MustCompile(`[^\p{L}\p{N}]+`)

// normalizeQuery folds the spelling variance that would otherwise split one
// venue across many cache entries: casing, punctuation, spacing, and standalone
// combining marks — which covers Arabic tashkeel, where the diacritic is
// already its own code point.
//
// ponytail: no Unicode NFD pass, so a precomposed "é" and a decomposed one
// stay different keys, and "Zooba" never folds onto "زوبا". Both need
// golang.org/x/text (or a transliterator) for one dependency's worth of extra
// hit rate — add it if the measured hit rate says the misses are real.
func normalizeQuery(s string) string {
	var b strings.Builder
	for _, r := range s {
		if unicode.Is(unicode.Mn, r) { // combining mark
			continue
		}
		b.WriteRune(unicode.ToLower(r))
	}
	return strings.Trim(nonWord.ReplaceAllString(b.String(), " "), " ")
}

// QueryKey identifies one Places text search. Language is part of the key
// because Google returns localized names for the same venue.
func QueryKey(query, languageCode string) string {
	return hashKey(normalizeQuery(query) + "|" + languageCode)
}

// LookupQuery returns cached Places candidates. The second return value
// distinguishes a cached empty list from a miss: a query that matched nothing
// cost the same $0.032 as one that matched, and unpinnable videos get
// re-shared like any other, so misses are worth caching.
func LookupQuery(ctx context.Context, db *sql.DB, key string) ([]Candidate, bool) {
	if db == nil {
		return nil, false
	}
	var body string
	var createdAt time.Time
	err := db.QueryRowContext(ctx,
		`SELECT results_json, created_at FROM place_lookups WHERE query_hash = ?`,
		key,
	).Scan(&body, &createdAt)
	if err != nil || time.Since(createdAt) > queryTTL {
		return nil, false
	}
	var cands []Candidate
	if json.Unmarshal([]byte(body), &cands) != nil {
		return nil, false
	}
	return cands, true
}

// StoreQuery caches candidates for a query, empty lists included.
func StoreQuery(ctx context.Context, db *sql.DB, key, query string, cands []Candidate) error {
	if db == nil {
		return nil
	}
	if cands == nil {
		cands = []Candidate{}
	}
	body, err := json.Marshal(cands)
	if err != nil {
		return err
	}
	_, err = db.ExecContext(ctx,
		`INSERT INTO place_lookups (query_hash, query, results_json)
		 VALUES (?, ?, ?)
		 ON DUPLICATE KEY UPDATE results_json = VALUES(results_json), created_at = CURRENT_TIMESTAMP`,
		key, truncate(query, 512), string(body),
	)
	return err
}
