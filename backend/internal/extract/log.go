package extract

import (
	"context"
	"log"
)

// Per-extraction logging. Every line from one share carries the same id: a
// handful of extractions run concurrently and each spans ~13s of yt-dlp
// retries, so without an id the lines from different videos interleave into
// something unreadable.
//
// ponytail: stdlib log, not slog. Fly's log view is grep, not a structured
// query engine — swap it if that changes.

type ctxKey struct{}

// WithID tags ctx so logf lines from this extraction share a prefix.
func WithID(ctx context.Context, id string) context.Context {
	return context.WithValue(ctx, ctxKey{}, id)
}

func logf(ctx context.Context, format string, args ...any) {
	id, _ := ctx.Value(ctxKey{}).(string)
	log.Printf("extract["+id+"] "+format, args...)
}
