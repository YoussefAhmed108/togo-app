package middleware

import (
	"context"
	"fmt"
	"log"
	"math/rand/v2"
	"net/http"
	"time"
)

type reqIDKey struct{}

// uidSlot carries a pointer Auth writes the authenticated user id into.
//
// Logger runs BEFORE Auth, so the request it holds never sees the userID that
// Auth adds downstream — reading GetUserID there always gave 0. The slot is
// written by Auth and read by Logger after ServeHTTP returns, both on the
// request's own goroutine, so no lock is needed.
type uidSlot struct{}

// ReqID returns the id Logger assigned to this request, or "-" outside it
// (tests, and the local-upload routes that sit outside the /api/v1 chain).
func ReqID(r *http.Request) string {
	id, _ := r.Context().Value(reqIDKey{}).(string)
	if id == "" {
		return "-"
	}
	return id
}

// errBodyMax is how much of a 4xx/5xx response body to log. Long enough for
// any writeError message, short enough that a validation dump cannot flood
// the log.
const errBodyMax = 256

// respWriter records what actually went back to the client. Without it every
// response looks the same in the log — a 500 and a 200 were indistinguishable.
type respWriter struct {
	http.ResponseWriter
	status  int
	written int
	errBody []byte
}

func (w *respWriter) WriteHeader(code int) {
	w.status = code
	w.ResponseWriter.WriteHeader(code)
}

func (w *respWriter) Write(b []byte) (int, error) {
	if w.status == 0 {
		w.status = http.StatusOK
	}
	// Capturing the body on failures is what makes every handler's writeError
	// visible without touching its ~100 call sites: the message the client got
	// IS the diagnosis, and none of them logged it.
	if w.status >= 400 && len(w.errBody) < errBodyMax {
		w.errBody = append(w.errBody, b[:min(len(b), errBodyMax-len(w.errBody))]...)
	}
	n, err := w.ResponseWriter.Write(b)
	w.written += n
	return n, err
}

// Logger assigns each request an id, logs its outcome, and puts the id in the
// context so slower pipelines (extraction) can tag their own lines with it.
func Logger(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := fmt.Sprintf("%08x", rand.Uint32())
		var uid uint64
		ctx := context.WithValue(r.Context(), reqIDKey{}, id)
		ctx = context.WithValue(ctx, uidSlot{}, &uid)
		r = r.WithContext(ctx)

		start := time.Now()
		rw := &respWriter{ResponseWriter: w}
		next.ServeHTTP(rw, r)
		if rw.status == 0 {
			rw.status = http.StatusOK // handler wrote nothing at all
		}

		line := fmt.Sprintf("req[%s] %s %s %d %dB %v uid=%d",
			id, r.Method, r.RequestURI, rw.status, rw.written,
			time.Since(start).Round(time.Millisecond), uid)
		if len(rw.errBody) > 0 {
			line += " <- " + string(rw.errBody)
		}
		log.Print(line)
	})
}

func JSON(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		w.Header().Set("X-Content-Type-Options", "nosniff")
		next.ServeHTTP(w, r)
	})
}

// maxBody caps every API request body. The largest legitimate one is a place
// with its tags — a few KB. Without a cap one request could make the decoder
// buffer gigabytes, or send a million tags that each become a DB write.
const maxBody = 1 << 20

func BodyLimit(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		r.Body = http.MaxBytesReader(w, r.Body, maxBody)
		next.ServeHTTP(w, r)
	})
}
