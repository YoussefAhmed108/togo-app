package handlers

import (
	"encoding/json"
	"log"
	"net/http"
	"path/filepath"
	"runtime"
)

func writeJSON(w http.ResponseWriter, status int, v any) {
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(map[string]any{"data": v}); err != nil {
		log.Printf("writeJSON encode error: %v", err)
	}
}

func writeError(w http.ResponseWriter, status int, message string) {
	w.WriteHeader(status)
	json.NewEncoder(w).Encode(map[string]string{"error": message})
}

// serverError logs where the failure came from as well as what it was: it is
// called from ~30 places and the message the client gets is always the same
// opaque "internal server error", so without the caller line a 500 in the log
// named no handler at all.
//
// ponytail: caller line, not a request id — threading one in would mean
// changing every call site. The req[...] line the Logger middleware writes
// immediately after carries the id, method and path.
func serverError(w http.ResponseWriter, err error) {
	if _, file, line, ok := runtime.Caller(1); ok {
		log.Printf("internal error at %s:%d: %v", filepath.Base(file), line, err)
	} else {
		log.Printf("internal error: %v", err)
	}
	writeError(w, http.StatusInternalServerError, "internal server error")
}
