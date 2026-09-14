package models

import "time"

type User struct {
	ID              uint64
	Email           string
	PasswordHash    string
	PhoneNumber     *string
	Name            *string
	Username        *string
	AvatarKey       *string
	ProfileComplete bool
	CreatedAt       time.Time
	UpdatedAt       time.Time
}

// SavedLocation is a named starting point the user can pick instead of GPS.
type SavedLocation struct {
	ID      uint64
	Label   string
	Address string
	Lat     float64
	Lng     float64
}
