package handlers_test

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"app/backend/internal/handlers"
	"app/backend/internal/models"
)

func TestGetMe_Success(t *testing.T) {
	name := "Alice"
	username := "alice"
	store := &mockUserStore{
		findByID: func(_ context.Context, id uint64) (*models.User, error) {
			return &models.User{ID: id, Email: "alice@example.com", Name: &name, Username: &username}, nil
		},
	}
	req := httptest.NewRequest(http.MethodGet, "/users/me", nil)
	req = injectUser(req, 1, true)
	rr := httptest.NewRecorder()
	handlers.NewUserHandler(store, noopStorage()).GetMe(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}
	var resp map[string]map[string]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if resp["data"]["email"] != "alice@example.com" {
		t.Errorf("unexpected email: %v", resp["data"]["email"])
	}
}

func TestUpdateMe_Success(t *testing.T) {
	newName := "Bob"
	store := &mockUserStore{
		updateMe: func(_ context.Context, _ uint64, _ string, _ *string) error { return nil },
		findByID: func(_ context.Context, id uint64) (*models.User, error) {
			return &models.User{ID: id, Email: "bob@example.com", Name: &newName}, nil
		},
	}
	b, _ := json.Marshal(map[string]string{"name": "Bob"})
	req := httptest.NewRequest(http.MethodPut, "/users/me", bytes.NewReader(b))
	req = injectUser(req, 2, true)
	rr := httptest.NewRecorder()
	handlers.NewUserHandler(store, noopStorage()).UpdateMe(rr, req)

	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — body: %s", rr.Code, rr.Body.String())
	}
}

func TestUpdateMe_MissingName(t *testing.T) {
	b, _ := json.Marshal(map[string]string{"name": ""})
	req := httptest.NewRequest(http.MethodPut, "/users/me", bytes.NewReader(b))
	req = injectUser(req, 2, true)
	rr := httptest.NewRecorder()
	handlers.NewUserHandler(&mockUserStore{}, noopStorage()).UpdateMe(rr, req)

	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}
