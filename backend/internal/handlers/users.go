package handlers

import (
	"encoding/json"
	"net/http"
	"strings"

	"app/backend/internal/middleware"
	"app/backend/internal/repository"
	"app/backend/internal/storage"
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
