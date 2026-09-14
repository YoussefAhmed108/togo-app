package handlers

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"strconv"
	"time"

	"app/backend/internal/middleware"
	"app/backend/internal/recommendations"
	"app/backend/internal/repository"

	"github.com/gorilla/mux"
)

// RecommendationHandler serves place suggestions for the home screen and per-space.
type RecommendationHandler struct {
	users  repository.UserStore
	places repository.PlaceStore
	spaces repository.SpaceStore
	db     *sql.DB
	apiKey string // Google Places API key; empty = no external recs
}

func NewRecommendationHandler(
	users repository.UserStore,
	places repository.PlaceStore,
	spaces repository.SpaceStore,
	db *sql.DB,
	apiKey string,
) *RecommendationHandler {
	return &RecommendationHandler{users: users, places: places, spaces: spaces, db: db, apiKey: apiKey}
}

type recResponse struct {
	Name          string  `json:"name"`
	Address       string  `json:"address"`
	Lat           float64 `json:"lat"`
	Lng           float64 `json:"lng"`
	GooglePlaceID string  `json:"google_place_id"`
	Category      string  `json:"category"`
	Emoji         string  `json:"emoji"`
	ReasonType    string  `json:"reason_type"`
	ReasonLabel   string  `json:"reason_label"`
}

// fetchCategory returns the cached or freshly-searched places for one category.
//
// Every error here is deliberately non-fatal — one dead category must not empty
// the whole shelf — but they used to be dropped without a trace, so a wrong API
// key and a genuinely quiet neighbourhood both rendered as an empty list.
func (h *RecommendationHandler) fetchCategory(
	ctx context.Context, r *http.Request, cat string, gq recommendations.GoogleQuery,
	gridLat, gridLng, lat, lng float64,
) []recommendations.GooglePlace {
	id := middleware.ReqID(r)

	places, err := recommendations.GetCached(ctx, h.db, gridLat, gridLng, cat)
	if err != nil {
		log.Printf("req[%s] recs: cache read %s: %v", id, cat, err)
	}
	if err == nil && places != nil {
		log.Printf("req[%s] recs: %s cache hit (%d)", id, cat, len(places))
		return places
	}
	if h.apiKey == "" {
		log.Printf("req[%s] recs: %s cache miss and no Places key configured", id, cat)
		return nil
	}

	t0 := time.Now()
	places, err = recommendations.NearbySearch(ctx, h.apiKey, lat, lng, 2000, gq)
	log.Printf("req[%s] recs: %s nearby %v (%d results, err=%v)",
		id, cat, time.Since(t0).Round(time.Millisecond), len(places), err)
	if err != nil || len(places) == 0 {
		return places
	}
	if err := recommendations.SetCached(ctx, h.db, gridLat, gridLng, cat, places); err != nil {
		log.Printf("req[%s] recs: cache write %s: %v", id, cat, err)
	}
	return places
}

// GET /api/v1/recommendations
// Returns up to 10 recommendations personalised to the current user.
// Derives categories from onboarding interests or saved-place tags.
// Uses the centroid of all the user's places (saved + spaces) to locate results.
func (h *RecommendationHandler) GetGlobal(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	ctx := r.Context()

	// 1. Determine interest categories
	cats, err := h.users.GetInterests(ctx, userID)
	if err != nil {
		serverError(w, err)
		return
	}

	// Fallback: derive from tag profile when no onboarding interests recorded
	if len(cats) == 0 {
		tags, err := h.places.GetUserTagProfile(ctx, userID, 20)
		if err != nil {
			serverError(w, err)
			return
		}
		cats = recommendations.TopCategories(tags, 3)
	}

	// 2. Build centroid from saved places + all spaces the user is in
	savedPlaces, err := h.places.ListPlacesByOwner(ctx, userID)
	if err != nil {
		serverError(w, err)
		return
	}

	var points [][2]float64
	for _, p := range savedPlaces {
		points = append(points, [2]float64{p.Lat, p.Lng})
	}

	// Pull coords from all space places too
	spacePlacePoints, _ := h.allSpacePlaceCoords(ctx, userID)
	points = append(points, spacePlacePoints...)

	// No location data or no categories → nothing to recommend
	if len(points) == 0 || len(cats) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"data": []recResponse{}})
		return
	}

	lat, lng := recommendations.Centroid(points)
	gridLat, gridLng := recommendations.GridCell(lat, lng)
	log.Printf("req[%s] recs: uid=%d cats=%v centroid=%.2f,%.2f from %d place(s)",
		middleware.ReqID(r), userID, cats, lat, lng, len(points))

	// 3. Fetch & cache Google Places results per category
	var results []recResponse
	seen := map[string]bool{}

	for _, cat := range cats {
		if len(results) >= 10 {
			break
		}
		gq, ok := recommendations.CategoryMap[cat]
		if !ok {
			continue
		}

		places := h.fetchCategory(ctx, r, cat, gq, gridLat, gridLng, lat, lng)

		for _, p := range places {
			if seen[p.PlaceID] {
				continue
			}
			seen[p.PlaceID] = true
			results = append(results, recResponse{
				Name:          p.Name,
				Address:       p.Vicinity,
				Lat:           p.Lat,
				Lng:           p.Lng,
				GooglePlaceID: p.PlaceID,
				Category:      cat,
				Emoji:         recommendations.CategoryEmoji[cat],
				ReasonType:    "interests",
				ReasonLabel:   "Based on your interests",
			})
			if len(results) >= 10 {
				break
			}
		}
	}

	log.Printf("req[%s] recs: returning %d", middleware.ReqID(r), len(results))
	writeJSON(w, http.StatusOK, map[string]any{"data": results})
}

// GET /api/v1/spaces/{id}/recommendations
// Returns up to 8 recommendations for a specific space, based on the space's
// place collection (its centroid + dominant tags).
func (h *RecommendationHandler) GetSpaceRecs(w http.ResponseWriter, r *http.Request) {
	spaceID, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid space id")
		return
	}
	userID := middleware.GetUserID(r)
	ctx := r.Context()

	// Auth: must be a member
	isMember, err := h.spaces.IsSpaceMember(ctx, spaceID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !isMember {
		writeError(w, http.StatusForbidden, "not a member of this space")
		return
	}

	// Get all places in the space
	placeIDs, err := h.spaces.ListSpacePlaceIDs(ctx, spaceID)
	if err != nil || len(placeIDs) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"data": []recResponse{}})
		return
	}

	spacePlaces, err := h.places.ListByIDs(ctx, placeIDs)
	if err != nil {
		serverError(w, err)
		return
	}

	// Build centroid + tag profile from space places
	var points [][2]float64
	var allTags []string
	existingNames := map[string]bool{}
	for _, p := range spacePlaces {
		points = append(points, [2]float64{p.Lat, p.Lng})
		allTags = append(allTags, p.Tags...)
		existingNames[p.Name] = true
	}

	lat, lng := recommendations.Centroid(points)
	gridLat, gridLng := recommendations.GridCell(lat, lng)

	// Top 2 categories from space tags; fallback to user interests
	cats := recommendations.TopCategories(allTags, 2)
	if len(cats) == 0 {
		cats, _ = h.users.GetInterests(ctx, userID)
	}
	if len(cats) == 0 {
		writeJSON(w, http.StatusOK, map[string]any{"data": []recResponse{}})
		return
	}

	log.Printf("req[%s] recs: space=%d cats=%v centroid=%.2f,%.2f from %d place(s)",
		middleware.ReqID(r), spaceID, cats, lat, lng, len(spacePlaces))

	var results []recResponse
	seen := map[string]bool{}

	for _, cat := range cats {
		if len(results) >= 8 {
			break
		}
		gq, ok := recommendations.CategoryMap[cat]
		if !ok {
			continue
		}

		places := h.fetchCategory(ctx, r, cat, gq, gridLat, gridLng, lat, lng)

		for _, p := range places {
			// Skip places already in the space (by name dedup)
			if seen[p.PlaceID] || existingNames[p.Name] {
				continue
			}
			seen[p.PlaceID] = true
			results = append(results, recResponse{
				Name:          p.Name,
				Address:       p.Vicinity,
				Lat:           p.Lat,
				Lng:           p.Lng,
				GooglePlaceID: p.PlaceID,
				Category:      cat,
				Emoji:         recommendations.CategoryEmoji[cat],
				ReasonType:    "space_area",
				ReasonLabel:   "Near this space's area",
			})
			if len(results) >= 8 {
				break
			}
		}
	}

	log.Printf("req[%s] recs: space returning %d", middleware.ReqID(r), len(results))
	writeJSON(w, http.StatusOK, map[string]any{"data": results})
}

// allSpacePlaceCoords collects [lat, lng] for every place across all spaces the
// user is a member of. Errors are silently ignored so a single broken space
// doesn't break the whole recommendation request.
func (h *RecommendationHandler) allSpacePlaceCoords(ctx context.Context, userID uint64) ([][2]float64, error) {
	spaces, err := h.spaces.ListSpacesByMember(ctx, userID)
	if err != nil {
		return nil, err
	}

	var coords [][2]float64
	for _, s := range spaces {
		ids, err := h.spaces.ListSpacePlaceIDs(ctx, s.ID)
		if err != nil || len(ids) == 0 {
			continue
		}
		places, err := h.places.ListByIDs(ctx, ids)
		if err != nil {
			continue
		}
		for _, p := range places {
			coords = append(coords, [2]float64{p.Lat, p.Lng})
		}
	}
	return coords, nil
}
