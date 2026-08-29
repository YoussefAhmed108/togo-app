package handlers_test

import (
	"context"
	"net/http"
	"time"

	"app/backend/internal/middleware"
	"app/backend/internal/storage"

	"github.com/golang-jwt/jwt/v5"
)

const testJWTSecret = "test-secret"

// injectUser adds userID and profileComplete into r's context, simulating the
// Auth + RequireProfile middleware without needing a real JWT.
func injectUser(r *http.Request, userID uint64, profileComplete bool) *http.Request {
	ctx := context.WithValue(r.Context(), middleware.ExportedUserIDKey, userID)
	ctx = context.WithValue(ctx, middleware.ExportedProfileCompleteKey, profileComplete)
	return r.WithContext(ctx)
}

// bearerToken generates a signed JWT for use in handler tests that call
// middleware.GetUserID directly (auth handler tests need a real token in
// the header because the auth handler itself reads from the body, not the header).
func bearerToken(userID uint64, profileComplete bool) string {
	claims := middleware.Claims{
		UserID:          userID,
		ProfileComplete: profileComplete,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(time.Hour)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok, _ := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testJWTSecret))
	return tok
}

func noopStorage() *storage.Client {
	return storage.NewNoopClient()
}
