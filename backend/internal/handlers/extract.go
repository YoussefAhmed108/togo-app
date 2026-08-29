package handlers

import (
	"context"
	"database/sql"
	"encoding/json"
	"log"
	"net/http"
	"time"

	"app/backend/internal/extract"
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

type extractResponse struct {
	Name       string              `json:"name"` // canonical (Google) name the form binds to
	Selected   *extract.Candidate  `json:"selected"`
	Candidates []extract.Candidate `json:"candidates"`
	Confidence float64             `json:"confidence"`
	Area       string              `json:"area"` // read but not searched on yet — for multi-branch later
	Evidence   string              `json:"evidence"`
	Caption    string              `json:"caption"`
	Note       string              `json:"note,omitempty"`
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
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !extract.ValidURL(req.URL) {
		writeError(w, http.StatusBadRequest, "not a TikTok URL")
		return
	}
	if h.anthropicKey == "" || h.placesKey == "" {
		writeError(w, http.StatusServiceUnavailable, "place extraction is not configured")
		return
	}

	// Bound the whole pipeline: yt-dlp retries + ffmpeg + two API calls.
	ctx, cancel := context.WithTimeout(r.Context(), 150*time.Second)
	defer cancel()

	urlKey := extract.URLKey(req.URL)
	var cached extractResponse
	if extract.LookupURL(ctx, h.db, urlKey, &cached) {
		log.Printf("extract/cache: url hit")
		writeJSON(w, http.StatusOK, cached)
		return
	}

	meta, frames, transcript, err := extract.Fetch(ctx, req.URL)
	if err != nil {
		log.Printf("extract fetch: %v", err)
		writeError(w, http.StatusUnprocessableEntity, "could not read that TikTok")
		return
	}

	// The download resolved a short link to a real video ID — try the cache
	// again before spending anything. Saves the full $0.041, not the latency.
	keys := []string{urlKey}
	if meta.ID != "" {
		if vk := extract.VideoKey(meta.ID); vk != urlKey {
			keys = append(keys, vk)
			if extract.LookupURL(ctx, h.db, vk, &cached) {
				log.Printf("extract/cache: video-id hit")
				writeJSON(w, http.StatusOK, cached)
				return
			}
		}
	}

	tLLM := time.Now()
	result, usage, err := extract.Analyze(ctx, h.anthropicKey, meta, frames, transcript)
	log.Printf("extract/timing: claude %v", time.Since(tLLM).Round(time.Millisecond))
	if err != nil {
		log.Printf("extract analyze: %v", err)
		writeError(w, http.StatusBadGateway, "could not analyse that TikTok")
		return
	}
	if usage != nil {
		log.Printf("extract: %d frames, %d transcript chars, %d in / %d out tokens",
			len(frames), len(transcript), usage.InputTokens, usage.OutputTokens)
	}

	resp := extractResponse{
		Name:       result.PlaceName,
		Candidates: []extract.Candidate{},
		Confidence: result.Confidence,
		Area:       result.Area,
		Evidence:   result.Evidence,
		Caption:    meta.Description,
	}

	if result.PlaceName == "" {
		resp.Note = "no place confidently identified"
		h.cache(ctx, keys, req.URL, resp)
		writeJSON(w, http.StatusOK, resp)
		return
	}

	query, lang := result.Query(), result.LanguageCode()
	queryKey := extract.QueryKey(query, lang)
	cands, hit := extract.LookupQuery(ctx, h.db, queryKey)
	if hit {
		// The expensive part of a re-shared venue: a different video of the
		// same restaurant resolves to the same query, so Google is asked once
		// per venue rather than once per share.
		log.Printf("extract/cache: query hit %q (%d candidates)", query, len(cands))
	} else {
		tPlaces := time.Now()
		var err error
		cands, err = extract.SearchText(ctx, h.placesKey, query, lang)
		log.Printf("extract/timing: places %v", time.Since(tPlaces).Round(time.Millisecond))
		if err != nil {
			// The video read is still useful on its own — seed the name, skip
			// the pin. Not cached: a transport failure is not an answer.
			log.Printf("extract places: %v", err)
			resp.Note = "could not reach Google Places"
			writeJSON(w, http.StatusOK, resp)
			return
		}
		// Empty results are cached too — a video Google cannot match cost the
		// same as one it could, and it will be re-shared like any other.
		if err := extract.StoreQuery(ctx, h.db, queryKey, query, cands); err != nil {
			log.Printf("extract/cache: store query: %v", err)
		}
	}

	resp.Candidates = cands
	if len(cands) > 0 {
		resp.Selected = &cands[0]
		// Google's spelling is canonical; ours is OCR off a video frame.
		resp.Name = cands[0].Name
	} else {
		resp.Note = "no Google Places match"
	}
	h.cache(ctx, keys, req.URL, resp)
	writeJSON(w, http.StatusOK, resp)
}

// cache stores a finished response under every key identifying the video. A
// write failure is logged and swallowed — the user already has their answer.
func (h *ExtractHandler) cache(ctx context.Context, keys []string, url string, resp extractResponse) {
	if err := extract.StoreURL(ctx, h.db, keys, url, resp); err != nil {
		log.Printf("extract/cache: store url: %v", err)
	}
}
