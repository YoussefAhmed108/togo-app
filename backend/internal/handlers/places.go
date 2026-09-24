package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"unicode/utf8"

	"app/backend/internal/middleware"
	"app/backend/internal/models"
	"app/backend/internal/repository"
	"app/backend/internal/storage"

	"github.com/gorilla/mux"
)

type PlaceHandler struct {
	places  repository.PlaceStore
	spaces  repository.SpaceStore
	storage *storage.Client
}

func NewPlaceHandler(places repository.PlaceStore, spaces repository.SpaceStore, storage *storage.Client) *PlaceHandler {
	return &PlaceHandler{places: places, spaces: spaces, storage: storage}
}

// GET /api/v1/places
func (h *PlaceHandler) ListPlaces(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	places, err := h.places.ListPlacesByOwner(r.Context(), userID)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, placesResponse(places, h.storage))
}

// POST /api/v1/places
func (h *PlaceHandler) CreatePlace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Name    string   `json:"name"`
		Address *string  `json:"address"`
		Lat     float64  `json:"lat"`
		Lng     float64  `json:"lng"`
		Tags    []string `json:"tags"`
		Saved   *bool    `json:"saved"` // optional; defaults to true
		// GooglePlaceID identifies the venue. Sent when the place came from a
		// Places lookup (TikTok extraction or autocomplete); absent for a pin
		// the user dropped by hand.
		GooglePlaceID *string `json:"google_place_id"`
		// SourceURL is the TikTok the place was extracted from.
		SourceURL *string `json:"source_url"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name required")
		return
	}

	if !validTags(req.Tags) {
		writeError(w, http.StatusBadRequest, "invalid tags")
		return
	}

	// Only http(s) links: the app opens this URL, so nothing else gets stored.
	if req.SourceURL != nil {
		u := strings.TrimSpace(*req.SourceURL)
		if u == "" {
			req.SourceURL = nil
		} else if len(u) > 2048 || !(strings.HasPrefix(u, "https://") || strings.HasPrefix(u, "http://")) {
			writeError(w, http.StatusBadRequest, "invalid source_url")
			return
		} else {
			req.SourceURL = &u
		}
	}

	saved := true
	if req.Saved != nil {
		saved = *req.Saved
	}

	// Same venue, already saved: reuse the row rather than making a duplicate
	// the user has to reconcile. Two TikToks about one restaurant are the
	// common case, not an edge case.
	var placeID uint64
	if req.GooglePlaceID != nil && *req.GooglePlaceID != "" {
		existing, err := h.places.FindByGoogleID(r.Context(), userID, *req.GooglePlaceID)
		if err != nil {
			serverError(w, err)
			return
		}
		placeID = existing
		if placeID != 0 && req.SourceURL != nil {
			if err := h.places.SetSourceURLIfEmpty(r.Context(), placeID, *req.SourceURL); err != nil {
				serverError(w, err)
				return
			}
		}
	}
	if placeID == 0 {
		var err error
		placeID, err = h.places.CreatePlace(r.Context(), userID, req.Name, req.Address, req.Lat, req.Lng, saved, req.GooglePlaceID, req.SourceURL)
		if err != nil {
			serverError(w, err)
			return
		}
	}

	for _, tagName := range req.Tags {
		tagID, err := h.places.UpsertTag(r.Context(), tagName)
		if err != nil {
			serverError(w, err)
			return
		}
		if err := h.places.AddTagToPlace(r.Context(), placeID, tagID); err != nil {
			serverError(w, err)
			return
		}
	}

	place, err := h.places.GetPlace(r.Context(), placeID)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, placeResponse(place, h.storage))
}

// GET /api/v1/places/{id}
func (h *PlaceHandler) GetPlace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	place, err := h.places.GetPlace(r.Context(), placeID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "place not found")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	ok2, err := h.places.HasPlaceAccess(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !ok2 {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	memories, err := h.places.ListMemories(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return
	}

	resp := placeResponse(place, h.storage)
	resp["memories"] = memoriesResponse(memories, h.storage)
	writeJSON(w, http.StatusOK, resp)
}

// PUT /api/v1/places/{id}
func (h *PlaceHandler) UpdatePlace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, placeID, userID); err != nil || !ok {
		return
	}

	var req struct {
		Name    string  `json:"name"`
		Address *string `json:"address"`
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name required")
		return
	}

	if err := h.places.UpdatePlace(r.Context(), placeID, req.Name, req.Address, req.Lat, req.Lng); err != nil {
		serverError(w, err)
		return
	}

	place, err := h.places.GetPlace(r.Context(), placeID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, placeResponse(place, h.storage))
}

// DELETE /api/v1/places/{id}
func (h *PlaceHandler) DeletePlace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, placeID, userID); err != nil || !ok {
		return
	}

	if err := h.places.DeletePlace(r.Context(), placeID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// PATCH /api/v1/places/{id}/visited
func (h *PlaceHandler) SetVisited(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	ok2, err := h.places.HasPlaceAccess(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !ok2 {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	var req struct {
		Visited bool `json:"visited"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	if err := h.places.SetVisited(r.Context(), placeID, req.Visited); err != nil {
		serverError(w, err)
		return
	}

	place, err := h.places.GetPlace(r.Context(), placeID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, placeResponse(place, h.storage))
}

// POST /api/v1/places/{id}/tags
func (h *PlaceHandler) AddTags(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, placeID, userID); err != nil || !ok {
		return
	}

	var req struct {
		Tags []string `json:"tags"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !validTags(req.Tags) {
		writeError(w, http.StatusBadRequest, "invalid tags")
		return
	}

	for _, tagName := range req.Tags {
		tagID, err := h.places.UpsertTag(r.Context(), tagName)
		if err != nil {
			serverError(w, err)
			return
		}
		if err := h.places.AddTagToPlace(r.Context(), placeID, tagID); err != nil {
			serverError(w, err)
			return
		}
	}

	tags, err := h.places.GetPlaceTags(r.Context(), placeID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

// DELETE /api/v1/places/{id}/tags
func (h *PlaceHandler) RemoveTag(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, placeID, userID); err != nil || !ok {
		return
	}

	var req struct {
		Tag string `json:"tag"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.Tag == "" {
		writeError(w, http.StatusBadRequest, "tag required")
		return
	}

	if err := h.places.RemoveTagFromPlace(r.Context(), placeID, req.Tag); err != nil {
		serverError(w, err)
		return
	}

	tags, err := h.places.GetPlaceTags(r.Context(), placeID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, map[string]any{"tags": tags})
}

// GET /api/v1/places/{id}/memories
func (h *PlaceHandler) ListMemories(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	ok2, err := h.places.HasPlaceAccess(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !ok2 {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	memories, err := h.places.ListMemories(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, memoriesResponse(memories, h.storage))
}

// POST /api/v1/places/{id}/memories
func (h *PlaceHandler) AddMemory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	var req struct {
		ImageKey string  `json:"image_key"`
		Caption  *string `json:"caption"`
		SpaceID  *uint64 `json:"space_id"` // optional: memory is attributed to this space
		Dishes   []struct {
			Name   string `json:"name"`
			Rating uint8  `json:"rating"`
		} `json:"dishes"` // optional: dishes eaten, each rated 1-5
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if !ownKey("memory", userID, req.ImageKey) {
		writeError(w, http.StatusBadRequest, "invalid image_key")
		return
	}

	if len(req.Dishes) > maxDishesPerMemory {
		writeError(w, http.StatusBadRequest, "too many dishes")
		return
	}
	dishes := make([]models.Dish, 0, len(req.Dishes))
	for _, d := range req.Dishes {
		name := strings.TrimSpace(d.Name)
		if name == "" {
			writeError(w, http.StatusBadRequest, "dish name required")
			return
		}
		if len([]rune(name)) > 120 {
			writeError(w, http.StatusBadRequest, "dish name too long")
			return
		}
		if d.Rating < 1 || d.Rating > 5 {
			writeError(w, http.StatusBadRequest, "dish rating must be 1-5")
			return
		}
		dishes = append(dishes, models.Dish{Name: name, Rating: d.Rating})
	}

	// Authorization: if space_id provided, user must be a space member and place must
	// belong to that space. Otherwise user must be the place owner.
	if req.SpaceID != nil {
		isMember, err := h.spaces.IsSpaceMember(r.Context(), *req.SpaceID, userID)
		if err != nil {
			serverError(w, err)
			return
		}
		if !isMember {
			writeError(w, http.StatusForbidden, "not a member of that space")
			return
		}
		inSpace, err := h.spaces.IsPlaceInSpace(r.Context(), *req.SpaceID, placeID)
		if err != nil {
			serverError(w, err)
			return
		}
		if !inSpace {
			writeError(w, http.StatusForbidden, "place not in that space")
			return
		}
	} else {
		if ok, err := h.assertOwner(w, r, placeID, userID); err != nil || !ok {
			return
		}
	}

	memoryID, err := h.places.CreateMemory(r.Context(), placeID, userID, req.ImageKey, req.Caption, req.SpaceID)
	if err != nil {
		serverError(w, err)
		return
	}

	if err := h.places.AddDishes(r.Context(), memoryID, dishes); err != nil {
		serverError(w, err)
		return
	}

	memory, err := h.places.GetMemory(r.Context(), memoryID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, memoryResponse(memory, h.storage))
}

// DELETE /api/v1/places/{id}/memories/{memoryId}
func (h *PlaceHandler) DeleteMemory(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	placeID, ok := parsePlaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, placeID, userID); err != nil || !ok {
		return
	}

	vars := mux.Vars(r)
	memoryID, err := strconv.ParseUint(vars["memoryId"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid memory id")
		return
	}

	if err := h.places.DeleteMemory(r.Context(), memoryID, placeID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// --- helpers ---

func (h *PlaceHandler) assertOwner(w http.ResponseWriter, r *http.Request, placeID, userID uint64) (bool, error) {
	isOwner, err := h.places.IsPlaceOwner(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return false, err
	}
	if !isOwner {
		// Check if place exists at all for a better error
		_, getErr := h.places.GetPlace(r.Context(), placeID)
		if errors.Is(getErr, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "place not found")
		} else {
			writeError(w, http.StatusForbidden, "forbidden")
		}
		return false, nil
	}
	return true, nil
}

func parsePlaceID(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid place id")
		return 0, false
	}
	return id, true
}

func placeResponse(p *models.Place, s *storage.Client) map[string]any {
	tags := p.Tags
	if tags == nil {
		tags = []string{}
	}
	return map[string]any{
		"id":              p.ID,
		"owner_id":        p.OwnerID,
		"saved":           p.Saved,
		"visited":         p.Visited,
		"name":            p.Name,
		"address":         p.Address,
		"lat":             p.Lat,
		"lng":             p.Lng,
		"google_place_id": p.GooglePlaceID,
		"source_url":      p.SourceURL,
		"tags":            tags,
		"created_at":      p.CreatedAt,
		"updated_at":      p.UpdatedAt,
	}
}

func placesResponse(places []*models.Place, s *storage.Client) []map[string]any {
	out := make([]map[string]any, 0, len(places))
	for _, p := range places {
		out = append(out, placeResponse(p, s))
	}
	return out
}

// Each tag is a DB write, so the count is capped; 64 is the tags.name column.
const maxTags = 20

func validTags(tags []string) bool {
	if len(tags) > maxTags {
		return false
	}
	for _, t := range tags {
		t = strings.TrimSpace(t)
		if t == "" || utf8.RuneCountInString(t) > 64 {
			return false
		}
	}
	return true
}

// One memory is one sitting — 20 dishes is already generous.
const maxDishesPerMemory = 20

func memoryResponse(m *models.Memory, s *storage.Client) map[string]any {
	dishes := make([]map[string]any, 0, len(m.Dishes))
	for _, d := range m.Dishes {
		dishes = append(dishes, map[string]any{"id": d.ID, "name": d.Name, "rating": d.Rating})
	}
	return map[string]any{
		"dishes":      dishes,
		"id":          m.ID,
		"place_id":    m.PlaceID,
		"space_id":    m.SpaceID,
		"space_name":  m.SpaceName,
		"uploader_id": m.UploaderID,
		"image_url":   s.CDNUrl(m.ImageKey),
		"caption":     m.Caption,
		"created_at":  m.CreatedAt,
	}
}

func memoriesResponse(memories []*models.Memory, s *storage.Client) []map[string]any {
	out := make([]map[string]any, 0, len(memories))
	for _, m := range memories {
		out = append(out, memoryResponse(m, s))
	}
	return out
}
