package models

import "time"

type Place struct {
	ID      uint64
	OwnerID uint64
	Saved   bool
	Visited bool
	Name    string
	Address *string
	Lat     float64
	Lng     float64
	// GooglePlaceID is the venue's stable identity. Nil for a manually dropped
	// pin; set when the place came from a Places lookup, which is what lets the
	// same venue saved by several users converge instead of duplicating.
	GooglePlaceID *string
	Tags          []string // populated by JOIN, not a DB column
	CreatedAt     time.Time
	UpdatedAt     time.Time
}

type Memory struct {
	ID         uint64
	PlaceID    uint64
	SpaceID    *uint64 // nil if added outside a space context
	SpaceName  *string // populated by LEFT JOIN on spaces
	UploaderID uint64
	ImageKey   string
	Caption    *string
	CreatedAt  time.Time
}
