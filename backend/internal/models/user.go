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
