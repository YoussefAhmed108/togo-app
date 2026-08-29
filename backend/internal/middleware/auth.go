package middleware

import (
	"context"
	"net/http"
	"strings"

	"github.com/golang-jwt/jwt/v5"
)

type contextKey string

const (
	userIDKey          contextKey = "userID"
	profileCompleteKey contextKey = "profileComplete"
)

// Exported keys allow test packages to inject auth context directly.
var (
	ExportedUserIDKey          = userIDKey
	ExportedProfileCompleteKey = profileCompleteKey
)

type Claims struct {
	UserID          uint64 `json:"uid"`
	ProfileComplete bool   `json:"pc"`
	jwt.RegisteredClaims
}

// Auth validates the Bearer JWT and injects userID + profileComplete into the request context.
func Auth(jwtSecret string) func(http.Handler) http.Handler {
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			header := r.Header.Get("Authorization")
			if !strings.HasPrefix(header, "Bearer ") {
				writeUnauthorized(w)
				return
			}
			tokenStr := strings.TrimPrefix(header, "Bearer ")

			claims := &Claims{}
			token, err := jwt.ParseWithClaims(tokenStr, claims, func(t *jwt.Token) (interface{}, error) {
				if _, ok := t.Method.(*jwt.SigningMethodHMAC); !ok {
					return nil, jwt.ErrSignatureInvalid
				}
				return []byte(jwtSecret), nil
			})
			if err != nil || !token.Valid {
				writeUnauthorized(w)
				return
			}

			ctx := context.WithValue(r.Context(), userIDKey, claims.UserID)
			ctx = context.WithValue(ctx, profileCompleteKey, claims.ProfileComplete)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}
}

// RequireProfile rejects requests where the user has not completed profile setup.
func RequireProfile(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if !GetProfileComplete(r) {
			w.Header().Set("Content-Type", "application/json")
			w.WriteHeader(http.StatusForbidden)
			w.Write([]byte(`{"error":"profile setup required"}`))
			return
		}
		next.ServeHTTP(w, r)
	})
}

// GetUserID extracts the authenticated user ID from the request context.
func GetUserID(r *http.Request) uint64 {
	v, _ := r.Context().Value(userIDKey).(uint64)
	return v
}

// GetProfileComplete extracts the profileComplete flag from the request context.
func GetProfileComplete(r *http.Request) bool {
	v, _ := r.Context().Value(profileCompleteKey).(bool)
	return v
}

func writeUnauthorized(w http.ResponseWriter) {
	w.Header().Set("Content-Type", "application/json")
	w.WriteHeader(http.StatusUnauthorized)
	w.Write([]byte(`{"error":"unauthorized"}`))
}
