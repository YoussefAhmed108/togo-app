package handlers_test

import (
	"context"
	"time"

	"app/backend/internal/models"
)

// ---- mockUserStore ----

type mockUserStore struct {
	createUser         func(context.Context, string, string, *string) (uint64, error)
	findByEmail        func(context.Context, string) (*models.User, error)
	findByID           func(context.Context, uint64) (*models.User, error)
	findByUsername     func(context.Context, string) (*models.User, error)
	updateProfile      func(context.Context, uint64, string, string, *string) error
	updateMe           func(context.Context, uint64, string, *string) error
	storeRefreshToken  func(context.Context, uint64, string, time.Time) error
	findRefreshToken   func(context.Context, string) (uint64, time.Time, error)
	deleteRefreshToken func(context.Context, string) error
	saveInterests      func(context.Context, uint64, []string) error
	getInterests       func(context.Context, uint64) ([]string, error)
}

func (m *mockUserStore) CreateUser(ctx context.Context, email, hash string, phone *string) (uint64, error) {
	return m.createUser(ctx, email, hash, phone)
}
func (m *mockUserStore) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	return m.findByEmail(ctx, email)
}
func (m *mockUserStore) FindByID(ctx context.Context, id uint64) (*models.User, error) {
	return m.findByID(ctx, id)
}
func (m *mockUserStore) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	return m.findByUsername(ctx, username)
}
func (m *mockUserStore) UpdateProfile(ctx context.Context, id uint64, name, username string, avatarKey *string) error {
	return m.updateProfile(ctx, id, name, username, avatarKey)
}
func (m *mockUserStore) UpdateMe(ctx context.Context, id uint64, name string, avatarKey *string) error {
	return m.updateMe(ctx, id, name, avatarKey)
}
func (m *mockUserStore) StoreRefreshToken(ctx context.Context, userID uint64, hash string, exp time.Time) error {
	return m.storeRefreshToken(ctx, userID, hash, exp)
}
func (m *mockUserStore) FindRefreshToken(ctx context.Context, hash string) (uint64, time.Time, error) {
	return m.findRefreshToken(ctx, hash)
}
func (m *mockUserStore) DeleteRefreshToken(ctx context.Context, hash string) error {
	return m.deleteRefreshToken(ctx, hash)
}
func (m *mockUserStore) SaveInterests(ctx context.Context, userID uint64, categories []string) error {
	return m.saveInterests(ctx, userID, categories)
}
func (m *mockUserStore) GetInterests(ctx context.Context, userID uint64) ([]string, error) {
	return m.getInterests(ctx, userID)
}

// ---- mockPlaceStore ----

type mockPlaceStore struct {
	findByGoogleID      func(context.Context, uint64, string) (uint64, error)
	createPlace         func(context.Context, uint64, string, *string, float64, float64, bool) (uint64, error)
	getPlace            func(context.Context, uint64) (*models.Place, error)
	listPlacesByOwner   func(context.Context, uint64) ([]*models.Place, error)
	updatePlace         func(context.Context, uint64, string, *string, float64, float64) error
	deletePlace         func(context.Context, uint64) error
	setVisited          func(context.Context, uint64, bool) error
	isPlaceOwner        func(context.Context, uint64, uint64) (bool, error)
	hasPlaceAccess      func(context.Context, uint64, uint64) (bool, error)
	upsertTag           func(context.Context, string) (uint64, error)
	addTagToPlace       func(context.Context, uint64, uint64) error
	removeTagFromPlace  func(context.Context, uint64, string) error
	getPlaceTags        func(context.Context, uint64) ([]string, error)
	createMemory        func(context.Context, uint64, uint64, string, *string, *uint64) (uint64, error)
	listMemories        func(context.Context, uint64) ([]*models.Memory, error)
	getMemory           func(context.Context, uint64) (*models.Memory, error)
	deleteMemory        func(context.Context, uint64, uint64) error
	placeExistsForOwner func(context.Context, uint64, uint64) (bool, error)
	listByIDs           func(context.Context, []uint64) ([]*models.Place, error)
	getUserTagProfile   func(context.Context, uint64, int) ([]string, error)
}

func (m *mockPlaceStore) CreatePlace(ctx context.Context, ownerID uint64, name string, address *string, lat, lng float64, saved bool, googlePlaceID *string) (uint64, error) {
	return m.createPlace(ctx, ownerID, name, address, lat, lng, saved)
}
func (m *mockPlaceStore) FindByGoogleID(ctx context.Context, ownerID uint64, googlePlaceID string) (uint64, error) {
	if m.findByGoogleID == nil {
		return 0, nil // no venue identity: every create is a new place
	}
	return m.findByGoogleID(ctx, ownerID, googlePlaceID)
}
func (m *mockPlaceStore) GetPlace(ctx context.Context, id uint64) (*models.Place, error) {
	return m.getPlace(ctx, id)
}
func (m *mockPlaceStore) ListPlacesByOwner(ctx context.Context, ownerID uint64) ([]*models.Place, error) {
	return m.listPlacesByOwner(ctx, ownerID)
}
func (m *mockPlaceStore) UpdatePlace(ctx context.Context, id uint64, name string, address *string, lat, lng float64) error {
	return m.updatePlace(ctx, id, name, address, lat, lng)
}
func (m *mockPlaceStore) DeletePlace(ctx context.Context, id uint64) error {
	return m.deletePlace(ctx, id)
}
func (m *mockPlaceStore) SetVisited(ctx context.Context, id uint64, visited bool) error {
	return m.setVisited(ctx, id, visited)
}
func (m *mockPlaceStore) IsPlaceOwner(ctx context.Context, placeID, userID uint64) (bool, error) {
	return m.isPlaceOwner(ctx, placeID, userID)
}
func (m *mockPlaceStore) HasPlaceAccess(ctx context.Context, placeID, userID uint64) (bool, error) {
	return m.hasPlaceAccess(ctx, placeID, userID)
}
func (m *mockPlaceStore) UpsertTag(ctx context.Context, name string) (uint64, error) {
	return m.upsertTag(ctx, name)
}
func (m *mockPlaceStore) AddTagToPlace(ctx context.Context, placeID, tagID uint64) error {
	return m.addTagToPlace(ctx, placeID, tagID)
}
func (m *mockPlaceStore) RemoveTagFromPlace(ctx context.Context, placeID uint64, tagName string) error {
	return m.removeTagFromPlace(ctx, placeID, tagName)
}
func (m *mockPlaceStore) GetPlaceTags(ctx context.Context, placeID uint64) ([]string, error) {
	return m.getPlaceTags(ctx, placeID)
}
func (m *mockPlaceStore) CreateMemory(ctx context.Context, placeID, uploaderID uint64, imageKey string, caption *string, spaceID *uint64) (uint64, error) {
	return m.createMemory(ctx, placeID, uploaderID, imageKey, caption, spaceID)
}
func (m *mockPlaceStore) ListMemories(ctx context.Context, placeID uint64) ([]*models.Memory, error) {
	return m.listMemories(ctx, placeID)
}
func (m *mockPlaceStore) GetMemory(ctx context.Context, memoryID uint64) (*models.Memory, error) {
	return m.getMemory(ctx, memoryID)
}
func (m *mockPlaceStore) DeleteMemory(ctx context.Context, memoryID, placeID uint64) error {
	return m.deleteMemory(ctx, memoryID, placeID)
}
func (m *mockPlaceStore) PlaceExistsForOwner(ctx context.Context, placeID, ownerID uint64) (bool, error) {
	return m.placeExistsForOwner(ctx, placeID, ownerID)
}
func (m *mockPlaceStore) ListByIDs(ctx context.Context, ids []uint64) ([]*models.Place, error) {
	return m.listByIDs(ctx, ids)
}
func (m *mockPlaceStore) GetUserTagProfile(ctx context.Context, userID uint64, limit int) ([]string, error) {
	return m.getUserTagProfile(ctx, userID, limit)
}

// ---- mockSpaceStore ----

type mockSpaceStore struct {
	createSpace            func(context.Context, string, string, uint64) (uint64, error)
	getSpace               func(context.Context, uint64) (*models.Space, error)
	listSpacesByMember     func(context.Context, uint64) ([]*models.Space, error)
	listSpacesSummary      func(context.Context, uint64) ([]*models.SpaceSummary, error)
	listMembersWithNames   func(context.Context, uint64) ([]*models.MemberWithName, error)
	listSpaceMemories      func(context.Context, uint64) ([]*models.SpaceMemory, error)
	updateSpace            func(context.Context, uint64, string, *string, *string) error
	deleteSpace            func(context.Context, uint64) error
	addMember              func(context.Context, uint64, uint64) error
	removeMember           func(context.Context, uint64, uint64) error
	getMember              func(context.Context, uint64, uint64) (*models.SpaceMember, error)
	listMembers            func(context.Context, uint64) ([]*models.SpaceMember, error)
	isSpaceMember          func(context.Context, uint64, uint64) (bool, error)
	isSpaceOwner           func(context.Context, uint64, uint64) (bool, error)
	addPlaceToSpace        func(context.Context, uint64, uint64, uint64) error
	removePlaceFromSpace   func(context.Context, uint64, uint64) error
	listSpacePlaceIDs      func(context.Context, uint64) ([]uint64, error)
	isPlaceInSpace         func(context.Context, uint64, uint64) (bool, error)
	getOrCreateInviteToken func(context.Context, uint64, uint64) (string, error)
	findSpaceByInviteToken func(context.Context, string) (*models.Space, error)
}

func (m *mockSpaceStore) CreateSpace(ctx context.Context, name, icon string, ownerID uint64) (uint64, error) {
	return m.createSpace(ctx, name, icon, ownerID)
}
func (m *mockSpaceStore) GetSpace(ctx context.Context, id uint64) (*models.Space, error) {
	return m.getSpace(ctx, id)
}
func (m *mockSpaceStore) ListSpacesByMember(ctx context.Context, userID uint64) ([]*models.Space, error) {
	return m.listSpacesByMember(ctx, userID)
}
func (m *mockSpaceStore) ListSpacesSummary(ctx context.Context, userID uint64) ([]*models.SpaceSummary, error) {
	return m.listSpacesSummary(ctx, userID)
}
func (m *mockSpaceStore) ListMembersWithNames(ctx context.Context, spaceID uint64) ([]*models.MemberWithName, error) {
	return m.listMembersWithNames(ctx, spaceID)
}
func (m *mockSpaceStore) ListSpaceMemories(ctx context.Context, spaceID uint64) ([]*models.SpaceMemory, error) {
	return m.listSpaceMemories(ctx, spaceID)
}
func (m *mockSpaceStore) UpdateSpace(ctx context.Context, id uint64, name string, icon, bannerKey *string) error {
	return m.updateSpace(ctx, id, name, icon, bannerKey)
}
func (m *mockSpaceStore) DeleteSpace(ctx context.Context, id uint64) error {
	return m.deleteSpace(ctx, id)
}
func (m *mockSpaceStore) AddMember(ctx context.Context, spaceID, userID uint64) error {
	return m.addMember(ctx, spaceID, userID)
}
func (m *mockSpaceStore) RemoveMember(ctx context.Context, spaceID, userID uint64) error {
	return m.removeMember(ctx, spaceID, userID)
}
func (m *mockSpaceStore) GetMember(ctx context.Context, spaceID, userID uint64) (*models.SpaceMember, error) {
	return m.getMember(ctx, spaceID, userID)
}
func (m *mockSpaceStore) ListMembers(ctx context.Context, spaceID uint64) ([]*models.SpaceMember, error) {
	return m.listMembers(ctx, spaceID)
}
func (m *mockSpaceStore) IsSpaceMember(ctx context.Context, spaceID, userID uint64) (bool, error) {
	return m.isSpaceMember(ctx, spaceID, userID)
}
func (m *mockSpaceStore) IsSpaceOwner(ctx context.Context, spaceID, userID uint64) (bool, error) {
	return m.isSpaceOwner(ctx, spaceID, userID)
}
func (m *mockSpaceStore) AddPlaceToSpace(ctx context.Context, spaceID, placeID, addedBy uint64) error {
	return m.addPlaceToSpace(ctx, spaceID, placeID, addedBy)
}
func (m *mockSpaceStore) RemovePlaceFromSpace(ctx context.Context, spaceID, placeID uint64) error {
	return m.removePlaceFromSpace(ctx, spaceID, placeID)
}
func (m *mockSpaceStore) ListSpacePlaceIDs(ctx context.Context, spaceID uint64) ([]uint64, error) {
	return m.listSpacePlaceIDs(ctx, spaceID)
}
func (m *mockSpaceStore) IsPlaceInSpace(ctx context.Context, spaceID, placeID uint64) (bool, error) {
	return m.isPlaceInSpace(ctx, spaceID, placeID)
}
func (m *mockSpaceStore) GetOrCreateInviteToken(ctx context.Context, spaceID, createdBy uint64) (string, error) {
	return m.getOrCreateInviteToken(ctx, spaceID, createdBy)
}
func (m *mockSpaceStore) FindSpaceByInviteToken(ctx context.Context, token string) (*models.Space, error) {
	return m.findSpaceByInviteToken(ctx, token)
}
