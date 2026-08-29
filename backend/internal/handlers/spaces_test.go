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

func spaceRequest(t *testing.T, method, path string, body any, userID uint64, vars map[string]string) (*httptest.ResponseRecorder, *http.Request) {
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

func stubSpace(id uint64) *models.Space {
	return &models.Space{ID: id, Name: "Road Trip", Icon: "🌍", OwnerID: 1, CreatedAt: time.Now(), UpdatedAt: time.Now()}
}

func newSpaceHandler(spaces *mockSpaceStore, places *mockPlaceStore) *handlers.SpaceHandler {
	return handlers.NewSpaceHandler(spaces, places, noopStorage())
}

// --- List Spaces ---

func TestListSpaces_Success(t *testing.T) {
	store := &mockSpaceStore{
		listSpacesByMember: func(_ context.Context, _ uint64) ([]*models.Space, error) {
			return []*models.Space{stubSpace(1), stubSpace(2)}, nil
		},
	}
	rr, req := spaceRequest(t, http.MethodGet, "/spaces", nil, 1, nil)
	newSpaceHandler(store, &mockPlaceStore{}).ListSpaces(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — %s", rr.Code, rr.Body.String())
	}
	var resp map[string][]any
	json.NewDecoder(rr.Body).Decode(&resp)
	if len(resp["data"]) != 2 {
		t.Errorf("expected 2 spaces, got %d", len(resp["data"]))
	}
}

// --- Create Space ---

func TestCreateSpace_Success(t *testing.T) {
	store := &mockSpaceStore{
		createSpace: func(_ context.Context, _, _ string, _ uint64) (uint64, error) { return 10, nil },
		getSpace:    func(_ context.Context, id uint64) (*models.Space, error) { return stubSpace(id), nil },
	}
	rr, req := spaceRequest(t, http.MethodPost, "/spaces", map[string]string{"name": "Road Trip"}, 1, nil)
	newSpaceHandler(store, &mockPlaceStore{}).CreateSpace(rr, req)
	if rr.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d — %s", rr.Code, rr.Body.String())
	}
}

func TestCreateSpace_MissingName(t *testing.T) {
	rr, req := spaceRequest(t, http.MethodPost, "/spaces", map[string]string{"name": ""}, 1, nil)
	newSpaceHandler(&mockSpaceStore{}, &mockPlaceStore{}).CreateSpace(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// --- Get Space ---

func TestGetSpace_Success(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceMember: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
		getSpace:      func(_ context.Context, id uint64) (*models.Space, error) { return stubSpace(id), nil },
	}
	rr, req := spaceRequest(t, http.MethodGet, "/spaces/1", nil, 1, map[string]string{"id": "1"})
	newSpaceHandler(store, &mockPlaceStore{}).GetSpace(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — %s", rr.Code, rr.Body.String())
	}
}

func TestGetSpace_NotMember(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceMember: func(_ context.Context, _, _ uint64) (bool, error) { return false, nil },
		getSpace:      func(_ context.Context, id uint64) (*models.Space, error) { return stubSpace(id), nil },
	}
	rr, req := spaceRequest(t, http.MethodGet, "/spaces/1", nil, 99, map[string]string{"id": "1"})
	newSpaceHandler(store, &mockPlaceStore{}).GetSpace(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

func TestGetSpace_NotFound(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceMember: func(_ context.Context, _, _ uint64) (bool, error) { return false, nil },
		getSpace:      func(_ context.Context, _ uint64) (*models.Space, error) { return nil, sql.ErrNoRows },
	}
	rr, req := spaceRequest(t, http.MethodGet, "/spaces/99", nil, 1, map[string]string{"id": "99"})
	newSpaceHandler(store, &mockPlaceStore{}).GetSpace(rr, req)
	if rr.Code != http.StatusNotFound {
		t.Errorf("expected 404, got %d", rr.Code)
	}
}

// --- Add Member ---

func TestAddMember_Success(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
		addMember:    func(_ context.Context, _, _ uint64) error { return nil },
		listMembers: func(_ context.Context, _ uint64) ([]*models.SpaceMember, error) {
			return []*models.SpaceMember{
				{SpaceID: 1, UserID: 1, Role: "owner"},
				{SpaceID: 1, UserID: 2, Role: "member"},
			}, nil
		},
	}
	rr, req := spaceRequest(t, http.MethodPost, "/spaces/1/members",
		map[string]uint64{"user_id": 2}, 1, map[string]string{"id": "1"})
	newSpaceHandler(store, &mockPlaceStore{}).AddMember(rr, req)
	if rr.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d — %s", rr.Code, rr.Body.String())
	}
}

func TestAddMember_NotOwner(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return false, nil },
		getSpace:     func(_ context.Context, id uint64) (*models.Space, error) { return stubSpace(id), nil },
	}
	rr, req := spaceRequest(t, http.MethodPost, "/spaces/1/members",
		map[string]uint64{"user_id": 2}, 99, map[string]string{"id": "1"})
	newSpaceHandler(store, &mockPlaceStore{}).AddMember(rr, req)
	if rr.Code != http.StatusForbidden {
		t.Errorf("expected 403, got %d", rr.Code)
	}
}

// --- Remove Member (owner cannot remove themselves) ---

func TestRemoveMember_OwnerRemovesSelf(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
	}
	rr, req := spaceRequest(t, http.MethodDelete, "/spaces/1/members/1", nil,
		1, map[string]string{"id": "1", "userId": "1"}) // callerID == targetID
	newSpaceHandler(store, &mockPlaceStore{}).RemoveMember(rr, req)
	if rr.Code != http.StatusBadRequest {
		t.Errorf("expected 400, got %d", rr.Code)
	}
}

// --- Delete Space ---

func TestDeleteSpace_Success(t *testing.T) {
	store := &mockSpaceStore{
		isSpaceOwner: func(_ context.Context, _, _ uint64) (bool, error) { return true, nil },
		deleteSpace:  func(_ context.Context, _ uint64) error { return nil },
	}
	rr, req := spaceRequest(t, http.MethodDelete, "/spaces/1", nil, 1, map[string]string{"id": "1"})
	newSpaceHandler(store, &mockPlaceStore{}).DeleteSpace(rr, req)
	if rr.Code != http.StatusNoContent {
		t.Errorf("expected 204, got %d", rr.Code)
	}
}
