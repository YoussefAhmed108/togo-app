package middleware_test

import (
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/backend/internal/middleware"

	"github.com/golang-jwt/jwt/v5"
)

const testSecret = "test-secret-key"

func makeToken(t *testing.T, userID uint64, profileComplete bool, expiry time.Duration) string {
	t.Helper()
	claims := middleware.Claims{
		UserID:          userID,
		ProfileComplete: profileComplete,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(expiry)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	tok, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	if err != nil {
		t.Fatalf("makeToken: %v", err)
	}
	return tok
}

func okHandler(w http.ResponseWriter, r *http.Request) {
	w.WriteHeader(http.StatusOK)
}

func TestAuth_ValidToken(t *testing.T) {
	token := makeToken(t, 42, true, time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	middleware.Auth(testSecret)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if middleware.GetUserID(r) != 42 {
			t.Errorf("expected userID 42, got %d", middleware.GetUserID(r))
		}
		if !middleware.GetProfileComplete(r) {
			t.Error("expected profileComplete true")
		}
		w.WriteHeader(http.StatusOK)
	})).ServeHTTP(rr, req)

	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestAuth_MissingHeader(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	rr := httptest.NewRecorder()
	middleware.Auth(testSecret)(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuth_InvalidToken(t *testing.T) {
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer not.a.real.token")
	rr := httptest.NewRecorder()
	middleware.Auth(testSecret)(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuth_WrongSecret(t *testing.T) {
	token := makeToken(t, 1, true, time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	middleware.Auth("wrong-secret")(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestAuth_ExpiredToken(t *testing.T) {
	token := makeToken(t, 1, true, -time.Hour) // already expired
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()
	middleware.Auth(testSecret)(http.HandlerFunc(okHandler)).ServeHTTP(rr, req)
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestRequireProfile_Complete(t *testing.T) {
	token := makeToken(t, 1, true, time.Hour)
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	chain := middleware.Auth(testSecret)(middleware.RequireProfile(http.HandlerFunc(okHandler)))
	chain.ServeHTTP(rr, req)
	if rr.Code != http.StatusOK {
		t.Errorf("expected 200, got %d", rr.Code)
	}
}

func TestRequireProfile_Incomplete(t *testing.T) {
	token := makeToken(t, 1, false, time.Hour) // profileComplete = false
	req := httptest.NewRequest(http.MethodGet, "/", nil)
	req.Header.Set("Authorization", "Bearer "+token)
	rr := httptest.NewRecorder()

	chain := middleware.Auth(testSecret)(middleware.RequireProfile(http.HandlerFunc(okHandler)))
	chain.ServeHTTP(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}
