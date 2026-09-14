package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"slices"
	"sync"
	"time"

	"app/backend/internal/extract"
	"app/backend/internal/middleware"
)

// ExtractHandler turns a shared TikTok link into a pre-filled place.
type ExtractHandler struct {
	anthropicKey string
	placesKey    string
	db           *sql.DB // caches only; nil disables them, the pipeline still runs
}

func NewExtractHandler(anthropicKey, placesKey string, db *sql.DB) *ExtractHandler {
	return &ExtractHandler{anthropicKey: anthropicKey, placesKey: placesKey, db: db}
}

// minConfidence orders results and drives the UI, but it does NOT gate the
// Places lookup. A live run returned a correct branch name with confidence 0
// and no evidence — gating on confidence threw a good read away. Having read a
// name is the signal; an empty name is the only real miss.
const minConfidence = 0.3

// extractedPlace is one venue read off the video and its Google matches.
type extractedPlace struct {
	Name       string              `json:"name"` // canonical (Google) name the form binds to
	Selected   *extract.Candidate  `json:"selected"`
	Candidates []extract.Candidate `json:"candidates"`
	Confidence float64             `json:"confidence"`
	Area       string              `json:"area"` // read but not searched on yet — for multi-branch later
	Evidence   string              `json:"evidence"`
	Note       string              `json:"note,omitempty"`
}

// extractResponse lists every venue in Places. The embedded top-level fields
// repeat the first MATCHED venue (else the first read) so app builds that
// predate multi-place keep working unchanged.
type extractResponse struct {
	extractedPlace
	Places  []extractedPlace `json:"places"`
	Caption string           `json:"caption"`
}

// ExtractPlace handles POST /api/v1/places/extract.
//
// Downloading and reading a video takes ~13s, well past a default mobile
// timeout, so the client must show a progress state while this runs.
//
// An uncached run costs ~$0.041, ~78% of it the one Google Places call, so
// there are three chances to avoid paid work before it happens:
//
//  1. URL cache on the request URL      — returns immediately, $0.000
//  2. URL cache on the resolved video ID — after download, skips Claude+Google
//  3. Query cache on the venue name      — skips Google only
//
// Step 2 exists because short share links (vm./vt./t/) carry no video ID, so
// they cannot hit step 1 against the long-form link they redirect to.
func (h *ExtractHandler) ExtractPlace(w http.ResponseWriter, r *http.Request) {
	var req struct {
		URL string `json:"url"`
		// Optional: where the sharer is, so a chain resolves to the nearby branch.
		Lat *float64 `json:"lat"`
		Lng *float64 `json:"lng"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !extract.ValidURL(req.URL) {
		writeError(w, http.StatusBadRequest, "not a TikTok URL")
		return
	}
	var near *extract.LatLng
	if req.Lat != nil && req.Lng != nil &&
		*req.Lat >= -90 && *req.Lat <= 90 && *req.Lng >= -180 && *req.Lng <= 180 {
		near = &extract.LatLng{Lat: *req.Lat, Lng: *req.Lng}
	}
	if h.anthropicKey == "" || h.placesKey == "" {
		writeError(w, http.StatusServiceUnavailable, "place extraction is not configured")
		return
	}

	// Bound the whole pipeline: yt-dlp retries + ffmpeg + two API calls.
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()

	// One id for every line this extraction produces, in the handler and down
	// inside the package — a few of these run at once and each spans ~13s. It
	// is the middleware's request id, so the extraction lines and the req line
	// that closes them out share it.
	id := middleware.ReqID(r)
	ctx = extract.WithID(ctx, id)
	t0 := time.Now()
	logf := func(format string, args ...any) {
		log.Printf("extract["+id+"] "+format, args...)
	}
	defer func() { logf("done in %v", time.Since(t0).Round(time.Millisecond)) }()

	logf("start %s", req.URL)

	// Every cache key carries the sharer's area: results are ranked near them.
	urlKey := extract.AreaKey(extract.URLKey(req.URL), near)
	var cached extractResponse
	if extract.LookupURL(ctx, h.db, urlKey, &cached) {
		logf("cache: url hit")
		writeJSON(w, http.StatusOK, cached)
		return
	}

	meta, frames, transcript, err := extract.Fetch(ctx, req.URL)
	if err != nil {
		logf("fetch: %v", err)
		writeError(w, http.StatusUnprocessableEntity, "could not read that TikTok")
		return
	}

	// The download resolved a short link to a real video ID — try the cache
	// again before spending anything. Saves the full $0.041, not the latency.
	keys := []string{urlKey}
	if meta.ID != "" {
		if vk := extract.AreaKey(extract.VideoKey(meta.ID), near); vk != urlKey {
			keys = append(keys, vk)
			if extract.LookupURL(ctx, h.db, vk, &cached) {
				logf("cache: video-id hit")
				writeJSON(w, http.StatusOK, cached)
				return
			}
		}
	}

	tLLM := time.Now()
	results, _, err := extract.Analyze(ctx, h.anthropicKey, meta, frames, transcript)
	logf("timing: claude %v", time.Since(tLLM).Round(time.Millisecond))
	if err != nil {
		logf("analyze: %v", err)
		writeError(w, http.StatusBadGateway, "could not analyse that TikTok")
		return
	}

	resp := extractResponse{
		extractedPlace: extractedPlace{Candidates: []extract.Candidate{}},
		Places:         []extractedPlace{},
		Caption:        meta.Description,
	}
	if len(results) == 0 {
		logf("result: no name read")
		resp.Note = "no place confidently identified"
		h.cache(ctx, keys, req.URL, resp)
		writeJSON(w, http.StatusOK, resp)
		return
	}

	// One Places lookup per venue, concurrently: a roundup of 8 would
	// otherwise add 8 sequential round trips to an already ~13s request.
	tPlaces := time.Now()
	resp.Places = make([]extractedPlace, len(results))
	answered := make([]bool, len(results))
	var wg sync.WaitGroup
	for i, result := range results {
		wg.Add(1)
		go func() {
			defer wg.Done()
			resp.Places[i], answered[i] = h.resolve(ctx, logf, result, near)
		}()
	}
	wg.Wait()
	logf("timing: places %v (%d lookups)", time.Since(tPlaces).Round(time.Millisecond), len(results))

	resp.extractedPlace = resp.Places[0]
	for _, p := range resp.Places {
		if p.Selected != nil {
			resp.extractedPlace = p
			break
		}
	}
	// A transport failure is not an answer — cache only a fully answered read.
	if !slices.Contains(answered, false) {
		h.cache(ctx, keys, req.URL, resp)
	}
	writeJSON(w, http.StatusOK, resp)
}

// resolve matches one venue read against Google Places. answered is false
// when Google could not be reached, so the caller knows not to cache it.
func (h *ExtractHandler) resolve(ctx context.Context, logf func(string, ...any), result extract.Result, near *extract.LatLng) (p extractedPlace, answered bool) {
	p = extractedPlace{
		Name:       result.PlaceName,
		Candidates: []extract.Candidate{},
		Confidence: result.Confidence,
		Area:       result.Area,
		Evidence:   result.Evidence,
	}

	query, lang := result.Query(), result.LanguageCode()
	queryKey := extract.AreaKey(extract.QueryKey(query, lang), near)
	cands, hit := extract.LookupQuery(ctx, h.db, queryKey)
	if hit {
		// The expensive part of a re-shared venue: a different video of the
		// same restaurant resolves to the same query, so Google is asked once
		// per venue rather than once per share.
		logf("cache: query hit %q (%d candidates)", query, len(cands))
	} else {
		var err error
		cands, err = extract.SearchText(ctx, h.placesKey, query, lang, near)
		if err != nil {
			// The video read is still useful on its own — seed the name, skip
			// the pin.
			logf("places %q: %v", query, err)
			p.Note = "could not reach Google Places"
			return p, false
		}
		// Empty results are cached too — a video Google cannot match cost the
		// same as one it could, and it will be re-shared like any other.
		if err := extract.StoreQuery(ctx, h.db, queryKey, query, cands); err != nil {
			logf("cache: store query: %v", err)
		}
	}

	if cands != nil {
		p.Candidates = cands
	}
	if len(cands) > 0 {
		p.Selected = &cands[0]
		// Google's spelling is canonical; ours is OCR off a video frame.
		p.Name = cands[0].Name
		logf("result: %q -> %q (%s) conf=%.2f", result.PlaceName, cands[0].Name,
			cands[0].GooglePlaceID, result.Confidence)
	} else {
		logf("result: %q matched nothing in Places", query)
		p.Note = "no Google Places match"
	}
	return p, true
}

// cache stores a finished response under every key identifying the video. A
// write failure is logged and swallowed — the user already has their answer.
func (h *ExtractHandler) cache(ctx context.Context, keys []string, url string, resp extractResponse) {
	if err := extract.StoreURL(ctx, h.db, keys, url, resp); err != nil {
		log.Printf("extract/cache: store url: %v", err)
	}
}
