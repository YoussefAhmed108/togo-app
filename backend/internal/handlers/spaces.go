package handlers

import (
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"app/backend/internal/middleware"
	"app/backend/internal/models"
	"app/backend/internal/repository"
	"app/backend/internal/storage"

	"github.com/gorilla/mux"
)

type SpaceHandler struct {
	spaces  repository.SpaceStore
	places  repository.PlaceStore
	storage *storage.Client
}

func NewSpaceHandler(spaces repository.SpaceStore, places repository.PlaceStore, storage *storage.Client) *SpaceHandler {
	return &SpaceHandler{spaces: spaces, places: places, storage: storage}
}

// GET /api/v1/spaces
func (h *SpaceHandler) ListSpaces(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	summaries, err := h.spaces.ListSpacesSummary(r.Context(), userID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, spacesSummaryResponse(summaries, h.storage))
}

// POST /api/v1/spaces
func (h *SpaceHandler) CreateSpace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Name      string  `json:"name"`
		Icon      string  `json:"icon"`
		BannerKey *string `json:"banner_key"` // optional — set when image was pre-uploaded
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
	if strings.TrimSpace(req.Icon) == "" {
		req.Icon = "🌍"
	}

	spaceID, err := h.spaces.CreateSpace(r.Context(), req.Name, req.Icon, userID)
	if err != nil {
		serverError(w, err)
		return
	}

	// If a banner image was uploaded before create, persist it now.
	if req.BannerKey != nil && strings.TrimSpace(*req.BannerKey) != "" {
		if err := h.spaces.UpdateSpace(r.Context(), spaceID, req.Name, &req.Icon, req.BannerKey); err != nil {
			serverError(w, err)
			return
		}
	}

	space, err := h.spaces.GetSpace(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusCreated, spaceResponse(space, h.storage))
}

// GET /api/v1/spaces/{id}
func (h *SpaceHandler) GetSpace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertMember(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	space, err := h.spaces.GetSpace(r.Context(), spaceID)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "space not found")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, spaceResponse(space, h.storage))
}

// PUT /api/v1/spaces/{id}
func (h *SpaceHandler) UpdateSpace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	var req struct {
		Name      string  `json:"name"`
		Icon      *string `json:"icon"`
		BannerKey *string `json:"banner_key"`
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

	if err := h.spaces.UpdateSpace(r.Context(), spaceID, req.Name, req.Icon, req.BannerKey); err != nil {
		serverError(w, err)
		return
	}

	space, err := h.spaces.GetSpace(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, spaceResponse(space, h.storage))
}

// DELETE /api/v1/spaces/{id}
func (h *SpaceHandler) DeleteSpace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	if err := h.spaces.DeleteSpace(r.Context(), spaceID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// POST /api/v1/spaces/{id}/members
func (h *SpaceHandler) AddMember(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	var req struct {
		UserID uint64 `json:"user_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.UserID == 0 {
		writeError(w, http.StatusBadRequest, "user_id required")
		return
	}

	if err := h.spaces.AddMember(r.Context(), spaceID, req.UserID); err != nil {
		serverError(w, err)
		return
	}

	members, err := h.spaces.ListMembers(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, membersResponse(members))
}

// DELETE /api/v1/spaces/{id}/members/{userId}
func (h *SpaceHandler) RemoveMember(w http.ResponseWriter, r *http.Request) {
	callerID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, spaceID, callerID); err != nil || !ok {
		return
	}

	targetUserID, err := strconv.ParseUint(mux.Vars(r)["userId"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid user id")
		return
	}

	if targetUserID == callerID {
		writeError(w, http.StatusBadRequest, "owner cannot remove themselves from the space")
		return
	}

	if err := h.spaces.RemoveMember(r.Context(), spaceID, targetUserID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/v1/spaces/{id}/places
func (h *SpaceHandler) ListSpacePlaces(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertMember(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	placeIDs, err := h.spaces.ListSpacePlaceIDs(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}

	places, err := h.places.ListByIDs(r.Context(), placeIDs)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, placesResponse(places, h.storage))
}

// POST /api/v1/spaces/{id}/places
func (h *SpaceHandler) AddPlaceToSpace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertMember(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	var req struct {
		PlaceID uint64 `json:"place_id"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.PlaceID == 0 {
		writeError(w, http.StatusBadRequest, "place_id required")
		return
	}

	// Caller must own the place
	isOwner, err := h.places.IsPlaceOwner(r.Context(), req.PlaceID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !isOwner {
		writeError(w, http.StatusForbidden, "you can only add places you own")
		return
	}

	if err := h.spaces.AddPlaceToSpace(r.Context(), spaceID, req.PlaceID, userID); err != nil {
		serverError(w, err)
		return
	}

	placeIDs, err := h.spaces.ListSpacePlaceIDs(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	places, err := h.places.ListByIDs(r.Context(), placeIDs)
	if err != nil {
		serverError(w, err)
		return
	}
	writeJSON(w, http.StatusOK, placesResponse(places, h.storage))
}

// DELETE /api/v1/spaces/{id}/places/{placeId}
func (h *SpaceHandler) RemovePlaceFromSpace(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	placeID, err := strconv.ParseUint(mux.Vars(r)["placeId"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid place id")
		return
	}

	// Space owner OR place owner can remove
	isSpaceOwner, err := h.spaces.IsSpaceOwner(r.Context(), spaceID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	isPlaceOwner, err := h.places.IsPlaceOwner(r.Context(), placeID, userID)
	if err != nil {
		serverError(w, err)
		return
	}
	if !isSpaceOwner && !isPlaceOwner {
		writeError(w, http.StatusForbidden, "forbidden")
		return
	}

	if err := h.spaces.RemovePlaceFromSpace(r.Context(), spaceID, placeID); err != nil {
		serverError(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// GET /api/v1/spaces/{id}/members
func (h *SpaceHandler) ListSpaceMembers(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}
	if ok, err := h.assertMember(w, r, spaceID, userID); err != nil || !ok {
		return
	}
	members, err := h.spaces.ListMembersWithNames(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(members))
	for _, m := range members {
		entry := map[string]any{
			"user_id":    m.UserID,
			"name":       m.Name,
			"role":       m.Role,
			"joined_at":  m.JoinedAt,
			"avatar_url": nil,
		}
		if m.AvatarKey != nil {
			entry["avatar_url"] = h.storage.CDNUrl(*m.AvatarKey)
		}
		out = append(out, entry)
	}
	writeJSON(w, http.StatusOK, out)
}

// GET /api/v1/spaces/{id}/memories
func (h *SpaceHandler) ListSpaceMemories(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}
	if ok, err := h.assertMember(w, r, spaceID, userID); err != nil || !ok {
		return
	}
	memories, err := h.spaces.ListSpaceMemories(r.Context(), spaceID)
	if err != nil {
		serverError(w, err)
		return
	}
	out := make([]map[string]any, 0, len(memories))
	for _, m := range memories {
		entry := map[string]any{
			"id":          m.ID,
			"place_id":    m.PlaceID,
			"place_name":  m.PlaceName,
			"uploader_id": m.UploaderID,
			"image_url":   h.storage.CDNUrl(m.ImageKey),
			"caption":     m.Caption,
			"created_at":  m.CreatedAt,
		}
		out = append(out, entry)
	}
	writeJSON(w, http.StatusOK, out)
}

// POST /api/v1/spaces/{id}/invite-link
func (h *SpaceHandler) GenerateInviteLink(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)
	spaceID, ok := parseSpaceID(w, r)
	if !ok {
		return
	}

	if ok, err := h.assertOwner(w, r, spaceID, userID); err != nil || !ok {
		return
	}

	token, err := h.spaces.GetOrCreateInviteToken(r.Context(), spaceID, userID)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]any{
		"token": token,
		"link":  "prism://join/" + token,
	})
}

// POST /api/v1/spaces/join
func (h *SpaceHandler) JoinViaInvite(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Token string `json:"token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Token = strings.TrimSpace(req.Token)
	if req.Token == "" {
		writeError(w, http.StatusBadRequest, "token required")
		return
	}

	space, err := h.spaces.FindSpaceByInviteToken(r.Context(), req.Token)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusNotFound, "invite link not found")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	if err := h.spaces.AddMember(r.Context(), space.ID, userID); err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, spaceResponse(space, h.storage))
}

// --- helpers ---

func (h *SpaceHandler) assertMember(w http.ResponseWriter, r *http.Request, spaceID, userID uint64) (bool, error) {
	isMember, err := h.spaces.IsSpaceMember(r.Context(), spaceID, userID)
	if err != nil {
		serverError(w, err)
		return false, err
	}
	if !isMember {
		_, getErr := h.spaces.GetSpace(r.Context(), spaceID)
		if getErr != nil && !errors.Is(getErr, sql.ErrNoRows) {
			// Unexpected DB error — don't mask it as 403/404
			serverError(w, getErr)
			return false, getErr
		}
		if errors.Is(getErr, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "space not found")
		} else {
			writeError(w, http.StatusForbidden, "forbidden")
		}
		return false, nil
	}
	return true, nil
}

func (h *SpaceHandler) assertOwner(w http.ResponseWriter, r *http.Request, spaceID, userID uint64) (bool, error) {
	isOwner, err := h.spaces.IsSpaceOwner(r.Context(), spaceID, userID)
	if err != nil {
		serverError(w, err)
		return false, err
	}
	if !isOwner {
		_, getErr := h.spaces.GetSpace(r.Context(), spaceID)
		if getErr != nil && !errors.Is(getErr, sql.ErrNoRows) {
			// Unexpected DB error — don't mask it as 403/404
			serverError(w, getErr)
			return false, getErr
		}
		if errors.Is(getErr, sql.ErrNoRows) {
			writeError(w, http.StatusNotFound, "space not found")
		} else {
			writeError(w, http.StatusForbidden, "forbidden")
		}
		return false, nil
	}
	return true, nil
}

func parseSpaceID(w http.ResponseWriter, r *http.Request) (uint64, bool) {
	id, err := strconv.ParseUint(mux.Vars(r)["id"], 10, 64)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid space id")
		return 0, false
	}
	return id, true
}

func spaceResponse(s *models.Space, st *storage.Client) map[string]any {
	resp := map[string]any{
		"id":         s.ID,
		"name":       s.Name,
		"icon":       s.Icon,
		"owner_id":   s.OwnerID,
		"banner_url": nil,
		"created_at": s.CreatedAt,
		"updated_at": s.UpdatedAt,
	}
	if s.BannerKey != nil {
		resp["banner_url"] = st.CDNUrl(*s.BannerKey)
	}
	return resp
}

func spacesResponse(spaces []*models.Space, st *storage.Client) []map[string]any {
	out := make([]map[string]any, 0, len(spaces))
	for _, s := range spaces {
		out = append(out, spaceResponse(s, st))
	}
	return out
}

func spacesSummaryResponse(summaries []*models.SpaceSummary, st *storage.Client) []map[string]any {
	out := make([]map[string]any, 0, len(summaries))
	for _, ss := range summaries {
		r := spaceResponse(&ss.Space, st)
		r["member_count"] = ss.MemberCount
		r["place_count"] = ss.PlaceCount

		previews := make([]map[string]any, 0, len(ss.MemberPreviews))
		for _, mp := range ss.MemberPreviews {
			p := map[string]any{
				"user_id":    mp.UserID,
				"name":       mp.Name,
				"avatar_url": nil,
			}
			if mp.AvatarKey != nil {
				p["avatar_url"] = st.CDNUrl(*mp.AvatarKey)
			}
			previews = append(previews, p)
		}
		r["member_previews"] = previews
		out = append(out, r)
	}
	return out
}

func membersResponse(members []*models.SpaceMember) []map[string]any {
	out := make([]map[string]any, 0, len(members))
	for _, m := range members {
		out = append(out, map[string]any{
			"user_id":   m.UserID,
			"role":      m.Role,
			"joined_at": m.JoinedAt,
		})
	}
	return out
}
