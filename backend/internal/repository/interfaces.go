package repository

import (
	"context"
	"time"

	"app/backend/internal/models"
)

// UserStore is the interface satisfied by UserRepository.
type UserStore interface {
	CreateUser(ctx context.Context, email, passwordHash string, phoneNumber *string) (uint64, error)
	FindByEmail(ctx context.Context, email string) (*models.User, error)
	FindByID(ctx context.Context, id uint64) (*models.User, error)
	FindByUsername(ctx context.Context, username string) (*models.User, error)
	UpdateProfile(ctx context.Context, id uint64, name, username string, avatarKey *string) error
	UpdateMe(ctx context.Context, id uint64, name string, avatarKey *string) error
	StoreRefreshToken(ctx context.Context, userID uint64, tokenHash string, expiresAt time.Time) error
	FindRefreshToken(ctx context.Context, tokenHash string) (userID uint64, expiresAt time.Time, err error)
	DeleteRefreshToken(ctx context.Context, tokenHash string) error
	// Interest categories chosen during onboarding.
	SaveInterests(ctx context.Context, userID uint64, categories []string) error
	GetInterests(ctx context.Context, userID uint64) ([]string, error)
}

// PlaceStore is the interface satisfied by PlaceRepository.
type PlaceStore interface {
	CreatePlace(ctx context.Context, ownerID uint64, name string, address *string, lat, lng float64, saved bool, googlePlaceID *string) (uint64, error)
	FindByGoogleID(ctx context.Context, ownerID uint64, googlePlaceID string) (uint64, error)
	GetPlace(ctx context.Context, id uint64) (*models.Place, error)
	ListPlacesByOwner(ctx context.Context, ownerID uint64) ([]*models.Place, error)
	UpdatePlace(ctx context.Context, id uint64, name string, address *string, lat, lng float64) error
	DeletePlace(ctx context.Context, id uint64) error
	SetVisited(ctx context.Context, id uint64, visited bool) error
	IsPlaceOwner(ctx context.Context, placeID, userID uint64) (bool, error)
	// HasPlaceAccess returns true if userID is the owner OR is a member of any space containing the place.
	HasPlaceAccess(ctx context.Context, placeID, userID uint64) (bool, error)
	UpsertTag(ctx context.Context, name string) (uint64, error)
	AddTagToPlace(ctx context.Context, placeID, tagID uint64) error
	RemoveTagFromPlace(ctx context.Context, placeID uint64, tagName string) error
	GetPlaceTags(ctx context.Context, placeID uint64) ([]string, error)
	CreateMemory(ctx context.Context, placeID, uploaderID uint64, imageKey string, caption *string, spaceID *uint64) (uint64, error)
	ListMemories(ctx context.Context, placeID uint64) ([]*models.Memory, error)
	GetMemory(ctx context.Context, memoryID uint64) (*models.Memory, error)
	DeleteMemory(ctx context.Context, memoryID, placeID uint64) error
	PlaceExistsForOwner(ctx context.Context, placeID, ownerID uint64) (bool, error)
	ListByIDs(ctx context.Context, ids []uint64) ([]*models.Place, error)
	// GetUserTagProfile returns the user's most-used tags ranked by frequency.
	GetUserTagProfile(ctx context.Context, userID uint64, limit int) ([]string, error)
}

// SpaceStore is the interface satisfied by SpaceRepository.
type SpaceStore interface {
	CreateSpace(ctx context.Context, name, icon string, ownerID uint64) (uint64, error)
	GetSpace(ctx context.Context, id uint64) (*models.Space, error)
	ListSpacesByMember(ctx context.Context, userID uint64) ([]*models.Space, error)
	ListSpacesSummary(ctx context.Context, userID uint64) ([]*models.SpaceSummary, error)
	UpdateSpace(ctx context.Context, id uint64, name string, icon, bannerKey *string) error
	DeleteSpace(ctx context.Context, id uint64) error
	AddMember(ctx context.Context, spaceID, userID uint64) error
	RemoveMember(ctx context.Context, spaceID, userID uint64) error
	GetMember(ctx context.Context, spaceID, userID uint64) (*models.SpaceMember, error)
	ListMembers(ctx context.Context, spaceID uint64) ([]*models.SpaceMember, error)
	ListMembersWithNames(ctx context.Context, spaceID uint64) ([]*models.MemberWithName, error)
	ListSpaceMemories(ctx context.Context, spaceID uint64) ([]*models.SpaceMemory, error)
	IsSpaceMember(ctx context.Context, spaceID, userID uint64) (bool, error)
	IsSpaceOwner(ctx context.Context, spaceID, userID uint64) (bool, error)
	AddPlaceToSpace(ctx context.Context, spaceID, placeID, addedBy uint64) error
	RemovePlaceFromSpace(ctx context.Context, spaceID, placeID uint64) error
	ListSpacePlaceIDs(ctx context.Context, spaceID uint64) ([]uint64, error)
	// IsPlaceInSpace returns true if the given place is linked to the given space.
	IsPlaceInSpace(ctx context.Context, spaceID, placeID uint64) (bool, error)
	GetOrCreateInviteToken(ctx context.Context, spaceID, createdBy uint64) (string, error)
	FindSpaceByInviteToken(ctx context.Context, token string) (*models.Space, error)
}

// Compile-time checks that concrete types satisfy their interfaces.
var _ UserStore = (*UserRepository)(nil)
var _ PlaceStore = (*PlaceRepository)(nil)
var _ SpaceStore = (*SpaceRepository)(nil)
