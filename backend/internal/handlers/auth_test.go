package handlers_test

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"app/backend/internal/handlers"
	"app/backend/internal/models"

	"golang.org/x/crypto/bcrypt"
)

// bcryptPassword is computed once at init time to keep test setup fast.
var bcryptPassword string

func init() {
	h, err := bcrypt.GenerateFromPassword([]byte("password"), bcrypt.MinCost)
	if err != nil {
		panic(err)
	}
	bcryptPassword = string(h)
}

func newAuthHandler(store *mockUserStore) *handlers.AuthHandler {
	return handlers.NewAuthHandler(store, testJWTSecret, 15*time.Minute, 7*24*time.Hour)
}

func postJSON(t *testing.T, handler http.HandlerFunc, body any) *httptest.ResponseRecorder {
	t.Helper()
	b, _ := json.Marshal(body)
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	rr := httptest.NewRecorder()
	handler(rr, req)
	return rr
}

// --- Register ---

func TestRegister_Success(t *testing.T) {
	store := &mockUserStore{
		findByEmail: func(_ context.Context, _ string) (*models.User, error) {
			return nil, sql.ErrNoRows
		},
		createUser: func(_ context.Context, _, _ string, _ *string) (uint64, error) {
			return 1, nil
		},
		storeRefreshToken: func(_ context.Context, _ uint64, _ string, _ time.Time) error {
			return nil
		},
	}
	rr := postJSON(t, newAuthHandler(store).Register,
		map[string]string{"email": "user@example.com", "password": "password123", "phone_number": "+1234567890"})

	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d — body: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]map[string]string
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["data"]["access_token"] == "" {
		t.Error("expected access_token in response")
	}
}

func TestRegister_DuplicateEmail(t *testing.T) {
	store := &mockUserStore{
		findByEmail: func(_ context.Context, _ string) (*models.User, error) {
			return &models.User{ID: 1, Email: "user@example.com"}, nil
		},
	}
	rr := postJSON(t, newAuthHandler(store).Register,
		map[string]string{"email": "user@example.com", "password": "password123", "phone_number": "+1234567890"})
	if rr.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rr.Code)
	}
}

func TestRegister_InvalidEmail(t *testing.T) {
	rr := postJSON(t, newAuthHandler(&mockUserStore{}).Register,
		map[string]string{"email": "notanemail", "password": "password123", "phone_number": "+1234567890"})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

func TestRegister_ShortPassword(t *testing.T) {
	rr := postJSON(t, newAuthHandler(&mockUserStore{}).Register,
		map[string]string{"email": "a@b.com", "password": "short", "phone_number": "+1234567890"})
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// --- Login ---

func TestLogin_Success(t *testing.T) {
	store := &mockUserStore{
		findByEmail: func(_ context.Context, _ string) (*models.User, error) {
			return &models.User{ID: 1, Email: "a@b.com", PasswordHash: bcryptPassword, ProfileComplete: true}, nil
		},
		storeRefreshToken: func(_ context.Context, _ uint64, _ string, _ time.Time) error { return nil },
	}
	rr := postJSON(t, newAuthHandler(store).Login,
		map[string]string{"email": "a@b.com", "password": "password"})
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]map[string]string
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["data"]["access_token"] == "" {
		t.Error("expected access_token in response")
	}
}

func TestLogin_WrongPassword(t *testing.T) {
	store := &mockUserStore{
		findByEmail: func(_ context.Context, _ string) (*models.User, error) {
			return &models.User{ID: 1, PasswordHash: bcryptPassword}, nil
		},
	}
	rr := postJSON(t, newAuthHandler(store).Login,
		map[string]string{"email": "a@b.com", "password": "wrongpassword"})
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestLogin_UserNotFound(t *testing.T) {
	store := &mockUserStore{
		findByEmail: func(_ context.Context, _ string) (*models.User, error) {
			return nil, sql.ErrNoRows
		},
	}
	rr := postJSON(t, newAuthHandler(store).Login,
		map[string]string{"email": "ghost@example.com", "password": "password123"})
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

// --- Refresh ---

func TestRefresh_Success(t *testing.T) {
	store := &mockUserStore{
		findRefreshToken: func(_ context.Context, _ string) (uint64, time.Time, error) {
			return 5, time.Now().Add(time.Hour), nil
		},
		findByID: func(_ context.Context, id uint64) (*models.User, error) {
			return &models.User{ID: id, ProfileComplete: true}, nil
		},
		storeRefreshToken: func(_ context.Context, _ uint64, _ string, _ time.Time) error { return nil },
	}
	rr := postJSON(t, newAuthHandler(store).Refresh,
		map[string]string{"refresh_token": "some-valid-token"})
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

func TestRefresh_InvalidToken(t *testing.T) {
	store := &mockUserStore{
		findRefreshToken: func(_ context.Context, _ string) (uint64, time.Time, error) {
			return 0, time.Time{}, sql.ErrNoRows
		},
	}
	rr := postJSON(t, newAuthHandler(store).Refresh,
		map[string]string{"refresh_token": "bad-token"})
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

func TestRefresh_ExpiredToken(t *testing.T) {
	store := &mockUserStore{
		findRefreshToken: func(_ context.Context, _ string) (uint64, time.Time, error) {
			return 1, time.Now().Add(-time.Hour), nil // already expired
		},
	}
	rr := postJSON(t, newAuthHandler(store).Refresh,
		map[string]string{"refresh_token": "expired-token"})
	if rr.Code != http.StatusUnauthorized {
		t.Errorf("expected 401, got %d", rr.Code)
	}
}

// --- Profile Setup ---

func TestProfileSetup_Success(t *testing.T) {
	store := &mockUserStore{
		findByUsername:    func(_ context.Context, _ string) (*models.User, error) { return nil, sql.ErrNoRows },
		updateProfile:     func(_ context.Context, _ uint64, _, _ string, _ *string) error { return nil },
		storeRefreshToken: func(_ context.Context, _ uint64, _ string, _ time.Time) error { return nil },
	}
	b, _ := json.Marshal(map[string]string{"name": "Alice", "username": "alice_99"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req.Header.Set("Content-Type", "application/json")
	req = injectUser(req, 7, false)
	rr := httptest.NewRecorder()
	newAuthHandler(store).ProfileSetup(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

func TestProfileSetup_TakenUsername(t *testing.T) {
	store := &mockUserStore{
		findByUsername: func(_ context.Context, _ string) (*models.User, error) {
			return &models.User{ID: 99}, nil
		},
	}
	b, _ := json.Marshal(map[string]string{"name": "Bob", "username": "alice_99"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req = injectUser(req, 8, false)
	rr := httptest.NewRecorder()
	newAuthHandler(store).ProfileSetup(rr, req)
	if rr.Code != http.StatusConflict {
		t.Errorf("expected 409, got %d", rr.Code)
	}
}

func TestProfileSetup_InvalidUsername(t *testing.T) {
	b, _ := json.Marshal(map[string]string{"name": "Bob", "username": "ab"})
	req := httptest.NewRequest(http.MethodPost, "/", bytes.NewReader(b))
	req = injectUser(req, 8, false)
	rr := httptest.NewRecorder()
	newAuthHandler(&mockUserStore{}).ProfileSetup(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}
