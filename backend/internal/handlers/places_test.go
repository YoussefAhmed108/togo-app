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

	"github.com/gorilla/mux"
)

func placeRequest(t *testing.T, method, path string, body any, userID uint64, vars map[string]string) (*httptest.ResponseRecorder, *http.Request) {
	t.Helper()
	var b []byte
	if body != nil {
		b, _ = json.Marshal(body)
	}
	req := httptest.NewRequest(method, path, bytes.NewReader(b))
	req = injectUser(req, userID, true)
	if vars != nil {
		req = mux.SetURLVars(req, vars)
	}
	return httptest.NewRecorder(), req
}

func stubPlace(id uint64) *models.Place {
	addr := "123 Main St"
	return &models.Place{
		ID: id, OwnerID: 1, Name: "Coffee Shop",
		Address: &addr, Lat: 40.7128, Lng: -74.0060,
		Tags: []string{"coffee"}, CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
}

// --- List Places ---

func TestListPlaces_Success(t *testing.T) {
	store := &mockPlaceStore{
		listPlacesByOwner: func(_ context.Context, ownerID uint64) ([]*models.Place, error) {
			return []*models.Place{stubPlace(1), stubPlace(2)}, nil
		},
	}
	rr, req := placeRequest(t, http.MethodGet, "/places", nil, 1, nil)
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).ListPlaces(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — %s", rr.Code, rr.Body.String())
	}
	var resp map[string][]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp["data"]) != 2 {
		t.Errorf("expected 2 places, got %d", len(resp["data"]))
	}
}

// --- Create Place ---

func TestCreatePlace_Success(t *testing.T) {
	store := &mockPlaceStore{
		createPlace: func(_ context.Context, _ uint64, _ string, _ *string, _, _ float64) (uint64, error) {
			return 10, nil
		},
		upsertTag:     func(_ context.Context, _ string) (uint64, error) { return 1, nil },
		addTagToPlace: func(_ context.Context, _, _ uint64) error { return nil },
		getPlace:      func(_ context.Context, id uint64) (*models.Place, error) { return stubPlace(id), nil },
	}
	rr, req := placeRequest(t, http.MethodPost, "/places", map[string]any{
		"name": "Coffee Shop", "lat": 40.7128, "lng": -74.0060, "tags": []string{"coffee"},
	}, 1, nil)
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).CreatePlace(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d — %s", rr.Code, rr.Body.String())
	}
}

func TestCreatePlace_MissingName(t *testing.T) {
	rr, req := placeRequest(t, http.MethodPost, "/places", map[string]any{
		"lat": 40.7, "lng": -74.0,
	}, 1, nil)
	handlers.NewPlaceHandler(&mockPlaceStore{}, &mockSpaceStore{}, noopStorage()).CreatePlace(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// --- Get Place ---

func TestGetPlace_Success(t *testing.T) {
	store := &mockPlaceStore{
		getPlace:     func(_ context.Context, id uint64) (*models.Place, error) { return stubPlace(id), nil },
		listMemories: func(_ context.Context, _ uint64) ([]*models.Memory, error) { return nil, nil },
	}
	rr, req := placeRequest(t, http.MethodGet, "/places/1", nil, 1, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).GetPlace(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — %s", rr.Code, rr.Body.String())
	}
}

func TestGetPlace_NotFound(t *testing.T) {
	store := &mockPlaceStore{
		getPlace: func(_ context.Context, _ uint64) (*models.Place, error) { return nil, sql.ErrNoRows },
	}
	rr, req := placeRequest(t, http.MethodGet, "/places/99", nil, 1, map[string]string{"id": "99"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).GetPlace(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

func TestGetPlace_Forbidden(t *testing.T) {
	store := &mockPlaceStore{
		getPlace: func(_ context.Context, id uint64) (*models.Place, error) {
			p := stubPlace(id)
			p.OwnerID = 999 // different owner
			return p, nil
		},
		listMemories: func(_ context.Context, _ uint64) ([]*models.Memory, error) { return nil, nil },
	}
	rr, req := placeRequest(t, http.MethodGet, "/places/1", nil, 1, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).GetPlace(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

// --- Delete Place ---

func TestDeletePlace_Success(t *testing.T) {
	store := &mockPlaceStore{
		isPlaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
		deletePlace:  func(_ context.Context, _ uint64) error { return nil },
	}
	rr, req := placeRequest(t, http.MethodDelete, "/places/1", nil, 1, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).DeletePlace(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}

func TestDeletePlace_NotOwner(t *testing.T) {
	store := &mockPlaceStore{
		isPlaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return false, nil },
		getPlace:     func(_ context.Context, id uint64) (*models.Place, error) { return stubPlace(id), nil },
	}
	rr, req := placeRequest(t, http.MethodDelete, "/places/1", nil, 2, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).DeletePlace(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

// --- Add Tags ---

func TestAddTags_Success(t *testing.T) {
	store := &mockPlaceStore{
		isPlaceOwner:  func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
		upsertTag:     func(_ context.Context, _ string) (uint64, error) { return 1, nil },
		addTagToPlace: func(_ context.Context, _, _ uint64) error { return nil },
		getPlaceTags:  func(_ context.Context, _ uint64) ([]string, error) { return []string{"coffee", "cozy"}, nil },
	}
	rr, req := placeRequest(t, http.MethodPost, "/places/1/tags",
		map[string][]string{"tags": {"coffee", "cozy"}}, 1, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).AddTags(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — %s", rr.Code, rr.Body.String())
	}
}

// --- Add Memory ---

func TestAddMemory_Success(t *testing.T) {
	store := &mockPlaceStore{
		isPlaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
		createMemory: func(_ context.Context, _, _ uint64, _ string, _ *string) (uint64, error) { return 5, nil },
		getMemory: func(_ context.Context, id uint64) (*models.Memory, error) {
			return &models.Memory{ID: id, PlaceID: 1, UploaderID: 1, ImageKey: "memory/1/abc", CreatedAt: time.Now()}, nil
		},
	}
	rr, req := placeRequest(t, http.MethodPost, "/places/1/memories",
		map[string]string{"image_key": "memory/1/abc"}, 1, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).AddMemory(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d — %s", rr.Code, rr.Body.String())
	}
}

func TestAddMemory_MissingKey(t *testing.T) {
	store := &mockPlaceStore{
		isPlaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
	}
	rr, req := placeRequest(t, http.MethodPost, "/places/1/memories",
		map[string]string{}, 1, map[string]string{"id": "1"})
	handlers.NewPlaceHandler(store, &mockSpaceStore{}, noopStorage()).AddMemory(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}
