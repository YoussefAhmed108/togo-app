package models

import "time"

type Space struct {
	ID        uint64
	Name      string
	Icon      string
	BannerKey *string
	OwnerID   uint64
	CreatedAt time.Time
	UpdatedAt time.Time
}

type SpaceMember struct {
	SpaceID  uint64
	UserID   uint64
	Role     string
	JoinedAt time.Time
}

// MemberPreview is a lightweight member record used in list responses.
type MemberPreview struct {
	UserID    uint64
	Name      string
	AvatarKey *string
}

// MemberWithName is a full member record including the user's name/avatar.
type MemberWithName struct {
	UserID    uint64
	Name      string
	AvatarKey *string
	Role      string
	JoinedAt  time.Time
}

// SpaceMemory is a memory enriched with the owning place's name.
type SpaceMemory struct {
	ID         uint64
	PlaceID    uint64
	PlaceName  string
	UploaderID uint64
	ImageKey   string
	Caption    *string
	CreatedAt  time.Time
}

// SpaceSummary extends Space with denormalised counts and member previews
// returned by the list endpoint so the card UI can render avatars + counts
// without additional round-trips.
type SpaceSummary struct {
	Space
	MemberCount    int
	PlaceCount     int
	MemberPreviews []MemberPreview // first 3 members ordered by joined_at
}
