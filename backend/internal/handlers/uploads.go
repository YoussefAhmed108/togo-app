package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"time"

	"app/backend/internal/middleware"
	"app/backend/internal/storage"

	"github.com/google/uuid"
	"github.com/gorilla/mux"
)

type UploadHandler struct {
	storage *storage.Client
}

func NewUploadHandler(storage *storage.Client) *UploadHandler {
	return &UploadHandler{storage: storage}
}

// POST /api/v1/uploads/presign
func (h *UploadHandler) Presign(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Context string `json:"context"` // "memory" | "space_banner" | "avatar"
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}

	switch req.Context {
	case "memory", "space_banner", "avatar":
	default:
		writeError(w, http.StatusBadRequest, `context must be one of: memory, space_banner, avatar`)
		return
	}

	key := fmt.Sprintf("%s/%d/%s", req.Context, userID, uuid.New().String())

	presignURL, err := h.storage.PresignPut(r.Context(), key, 15*time.Minute)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"presign_url": presignURL,
		"cdn_url":     h.storage.CDNUrl(key),
		"key":         key,
	})
}

// PUT /local-upload/{key}
//
// Local-mode only. Receives a raw image body from the React Native app
// and saves it to disk. The route is registered by routes.go only when
// the storage client is in local mode.
//
// The key is URL-encoded (slashes escaped) by PresignPut, so we decode it here.
func (h *UploadHandler) LocalUpload(w http.ResponseWriter, r *http.Request) {
	encodedKey := mux.Vars(r)["key"]
	key, err := url.PathUnescape(encodedKey)
	if err != nil {
		writeError(w, http.StatusBadRequest, "invalid key")
		return
	}

	const maxSize = 20 << 20 // 20 MB
	r.Body = http.MaxBytesReader(w, r.Body, maxSize)

	data, err := io.ReadAll(r.Body)
	if err != nil {
		writeError(w, http.StatusRequestEntityTooLarge, "file too large (max 20 MB)")
		return
	}
	if len(data) == 0 {
		writeError(w, http.StatusBadRequest, "empty body")
		return
	}

	if err := h.storage.SaveLocal(key, data); err != nil {
		serverError(w, err)
		return
	}

	w.WriteHeader(http.StatusOK)
}
