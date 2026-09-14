package handlers

import (
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"regexp"
	"strings"
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

// keyTail is the random part of a key Presign issued (a uuid). Tests use short ids.
var keyTail = regexp.MustCompile(`^[A-Za-z0-9-]{1,64}$`)

// ownKey reports whether key is one Presign issued to userID for kind.
// Client-sent keys are otherwise stored verbatim, and CDNUrl returns a bare key
// as-is when no CDN base is set — so an unchecked key could point other users'
// clients at an arbitrary URL, or at someone else's upload.
func ownKey(kind string, userID uint64, key string) bool {
	tail, ok := strings.CutPrefix(key, fmt.Sprintf("%s/%d/", kind, userID))
	return ok && keyTail.MatchString(tail)
}

// localKey is exactly the shape Presign produces. Anything else — "..",
// absolute paths, extra segments — would let this unauthenticated route write
// outside the upload directory.
var localKey = regexp.MustCompile(`^(memory|space_banner|avatar)/[0-9]+/[0-9a-f-]{36}$`)

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
	if err != nil || !localKey.MatchString(key) {
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
