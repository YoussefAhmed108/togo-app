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

	"github.com/gorilla/mux"
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

// One user must never see or delete another user's saved starting points.
func TestSavedLocations_ScopedToUser(t *testing.T) {
	store := &mockUserStore{}
	h := handlers.NewUserHandler(store, noopStorage())

	create := func(userID uint64, body string) *httptest.ResponseRecorder {
		req := injectUser(httptest.NewRequest(http.MethodPost, "/users/me/locations", bytes.NewBufferString(body)), userID, true)
		rr := httptest.NewRecorder()
		h.CreateLocation(rr, req)
		return rr
	}

	if rr := create(1, `{"label":"Home","address":"1 Nile St","lat":30.0,"lng":31.2}`); rr.Code != http.StatusCreated {
		t.Fatalf("create: expected 201, got %d — %s", rr.Code, rr.Body.String())
	}
	if rr := create(2, `{"label":"Work","address":"2 Nile St","lat":30.1,"lng":31.3}`); rr.Code != http.StatusCreated {
		t.Fatalf("create other user: expected 201, got %d", rr.Code)
	}
	if rr := create(1, `{"label":"","address":"x","lat":1,"lng":1}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("blank label: expected 400, got %d", rr.Code)
	}
	if rr := create(1, `{"label":"Moon","address":"x","lat":999,"lng":1}`); rr.Code != http.StatusBadRequest {
		t.Fatalf("bad coords: expected 400, got %d", rr.Code)
	}

	// User 1 sees only their own.
	rr := httptest.NewRecorder()
	h.ListLocations(rr, injectUser(httptest.NewRequest(http.MethodGet, "/users/me/locations", nil), 1, true))
	var listResp struct {
		Data []struct {
			Label string `json:"label"`
		} `json:"data"`
	}
	json.Unmarshal(rr.Body.Bytes(), &listResp)
	if len(listResp.Data) != 1 || listResp.Data[0].Label != "Home" {
		t.Fatalf("expected only Home, got %+v", listResp.Data)
	}

	// User 1 cannot delete user 2's location (id 2).
	rr = httptest.NewRecorder()
	del := mux.SetURLVars(httptest.NewRequest(http.MethodDelete, "/users/me/locations/2", nil), map[string]string{"id": "2"})
	h.DeleteLocation(rr, injectUser(del, 1, true))
	if rr.Code != http.StatusNotFound {
		t.Fatalf("cross-user delete: expected 404, got %d", rr.Code)
	}

	// ...but can delete their own.
	rr = httptest.NewRecorder()
	del = mux.SetURLVars(httptest.NewRequest(http.MethodDelete, "/users/me/locations/1", nil), map[string]string{"id": "1"})
	h.DeleteLocation(rr, injectUser(del, 1, true))
	if rr.Code != http.StatusNoContent {
		t.Fatalf("own delete: expected 204, got %d", rr.Code)
	}
}

func TestDeleteMe_DeletesCaller(t *testing.T) {
	var deleted uint64
	store := &mockUserStore{deleteUser: func(id uint64) error { deleted = id; return nil }}
	req := injectUser(httptest.NewRequest(http.MethodDelete, "/users/me", nil), 7, true)
	rr := httptest.NewRecorder()
	handlers.NewUserHandler(store, noopStorage()).DeleteMe(rr, req)

	if rr.Code != http.StatusNoContent || deleted != 7 {
		t.Fatalf("expected 204 deleting user 7, got %d deleting %d", rr.Code, deleted)
	}
}
