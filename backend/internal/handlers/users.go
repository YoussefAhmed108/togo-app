package handlers

import (
	"encoding/json"
	"net/http"
	"strconv"
	"strings"

	"app/backend/internal/middleware"
	"app/backend/internal/models"
	"app/backend/internal/repository"
	"app/backend/internal/storage"

	"github.com/gorilla/mux"
)

// valid interest category slugs (must match tags_map.go CategoryMap keys)
var validInterests = map[string]bool{
	"food": true, "coffee": true, "outdoors": true, "arts": true,
	"shopping": true, "nightlife": true, "wellness": true, "entertainment": true,
}

type UserHandler struct {
	users   repository.UserStore
	storage *storage.Client
}

func NewUserHandler(users repository.UserStore, storage *storage.Client) *UserHandler {
	return &UserHandler{users: users, storage: storage}
}

// GET /api/v1/users/me
func (h *UserHandler) GetMe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	user, err := h.users.FindByID(r.Context(), userID)
	if err != nil {
		serverError(w, err)
		return
	}

	resp := map[string]any{
		"id":           user.ID,
		"email":        user.Email,
		"phone_number": user.PhoneNumber,
		"name":         user.Name,
		"username":     user.Username,
	}
	if user.AvatarKey != nil {
		resp["avatar_url"] = h.storage.CDNUrl(*user.AvatarKey)
	} else {
		resp["avatar_url"] = nil
	}

	writeJSON(w, http.StatusOK, resp)
}

// PUT /api/v1/users/me
func (h *UserHandler) UpdateMe(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Name      string  `json:"name"`
		AvatarKey *string `json:"avatar_key"`
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
	if req.AvatarKey != nil && !ownKey("avatar", userID, *req.AvatarKey) {
		writeError(w, http.StatusBadRequest, "invalid avatar_key")
		return
	}

	if err := h.users.UpdateMe(r.Context(), userID, req.Name, req.AvatarKey); err != nil {
		serverError(w, err)
		return
	}

	user, err := h.users.FindByID(r.Context(), userID)
	if err != nil {
		serverError(w, err)
		return
	}

	resp := map[string]any{
		"id":           user.ID,
		"email":        user.Email,
		"phone_number": user.PhoneNumber,
		"name":         user.Name,
		"username":     user.Username,
	}
	if user.AvatarKey != nil {
		resp["avatar_url"] = h.storage.CDNUrl(*user.AvatarKey)
	} else {
		resp["avatar_url"] = nil
	}

	writeJSON(w, http.StatusOK, resp)
}

// POST /api/v1/users/me/interests
// Saves (replaces) the user's onboarding interest categories.
// Accepts an empty array to clear all interests (skip case).
func (h *UserHandler) SaveInterests(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Interests []string `json:"interests"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	// Validate and deduplicate
	seen := map[string]bool{}
	var valid []string
	for _, cat := range req.Interests {
		cat = strings.ToLower(strings.TrimSpace(cat))
		if validInterests[cat] && !seen[cat] {
			seen[cat] = true
			valid = append(valid, cat)
		}
	}
	if valid == nil {
		valid = []string{}
	}

	if err := h.users.SaveInterests(r.Context(), userID, valid); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{"interests": valid})
}

// ── Saved starting points ───────────────────────────────────────────────────

// Enough for home / work / partner's place / gym without letting one user
// fill the table.
const maxSavedLocations = 20

func locationJSON(l *models.SavedLocation) map[string]any {
	return map[string]any{"id": l.ID, "label": l.Label, "address": l.Address, "lat": l.Lat, "lng": l.Lng}
}

// GET /api/v1/users/me/locations
func (h *UserHandler) ListLocations(w http.ResponseWriter, r *http.Request) {
	locs, err := h.users.ListLocations(r.Context(), middleware.GetUserID(r))
	if err != nil {
		serverError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(locs))
	for _, l := range locs {
		out = append(out, locationJSON(l))
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /api/v1/users/me/locations
func (h *UserHandler) CreateLocation(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Label   string  `json:"label"`
		Address string  `json:"address"`
		Lat     float64 `json:"lat"`
		Lng     float64 `json:"lng"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Label = strings.TrimSpace(req.Label)
	req.Address = strings.TrimSpace(req.Address)
	if req.Label == "" {
		writeError(w, http.StatusBadRequest, "label required")
		return
	}
	if len([]rune(req.Label)) > 60 {
		writeError(w, http.StatusBadRequest, "label too long")
		return
	}
	if req.Address == "" {
		writeError(w, http.StatusBadRequest, "address required")
		return
	}
	if len([]rune(req.Address)) > 512 {
		req.Address = string([]rune(req.Address)[:512])
	}
	if req.Lat < -90 || req.Lat > 90 || req.Lng < -180 || req.Lng > 180 {
		writeError(w, http.StatusBadRequest, "invalid coordinates")
		return
	}

	existing, err := h.users.ListLocations(r.Context(), userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if len(existing) >= maxSavedLocations {
		writeError(w, http.StatusBadRequest, "saved location limit reached")
		return
	}

	id, err := h.users.CreateLocation(r.Context(), userID, req.Label, req.Address, req.Lat, req.Lng)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, locationJSON(&models.SavedLocation{
		ID: id, Label: req.Label, Address: req.Address, Lat: req.Lat, Lng: req.Lng,
	}))
}

// DELETE /api/v1/users/me/locations/{id}
func (h *UserHandler) DeleteLocation(w http.ResponseWriter, r *http.Request) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid location id")
		return
	}
	ok, err := h.users.DeleteLocation(r.Context(), middleware.GetUserID(r), id)
	if err != nil {
		serverError(w, err)
		return
	}
	if !ok {
		writeError(w, http.StatusNotFound, "location not found")
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// DELETE /api/v1/users/me — App Store guideline 5.1.1(v) requires in-app deletion.
// ponytail: uploaded images stay in object storage; sweep orphaned keys if that matters.
func (h *UserHandler) DeleteMe(w http.ResponseWriter, r *http.Request) {
	if err := h.users.DeleteUser(r.Context(), middleware.GetUserID(r)); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}
