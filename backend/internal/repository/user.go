package repository

import (
	"context"
	"database/sql"
	"time"

	"app/backend/internal/models"
)

type UserRepository struct {
	Base
}

func (r *UserRepository) CreateUser(ctx context.Context, email, passwordHash string, phoneNumber *string) (uint64, error) {
	res, err := r.DB.ExecContext(ctx,
		`INSERT INTO users (email, password, phone_number) VALUES (?, ?, ?)`,
		email, passwordHash, phoneNumber,
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return uint64(id), err
}

func (r *UserRepository) FindByEmail(ctx context.Context, email string) (*models.User, error) {
	u := &models.User{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT id, email, password, phone_number, name, username, avatar_key, profile_complete, created_at, updated_at
		 FROM users WHERE email = ?`, email,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.PhoneNumber, &u.Name, &u.Username, &u.AvatarKey, &u.ProfileComplete, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *UserRepository) FindByID(ctx context.Context, id uint64) (*models.User, error) {
	u := &models.User{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT id, email, password, phone_number, name, username, avatar_key, profile_complete, created_at, updated_at
		 FROM users WHERE id = ?`, id,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.PhoneNumber, &u.Name, &u.Username, &u.AvatarKey, &u.ProfileComplete, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *UserRepository) FindByUsername(ctx context.Context, username string) (*models.User, error) {
	u := &models.User{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT id, email, password, phone_number, name, username, avatar_key, profile_complete, created_at, updated_at
		 FROM users WHERE username = ?`, username,
	).Scan(&u.ID, &u.Email, &u.PasswordHash, &u.PhoneNumber, &u.Name, &u.Username, &u.AvatarKey, &u.ProfileComplete, &u.CreatedAt, &u.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return u, nil
}

func (r *UserRepository) UpdateProfile(ctx context.Context, id uint64, name, username string, avatarKey *string) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE users SET name = ?, username = ?, avatar_key = ?, profile_complete = 1 WHERE id = ?`,
		name, username, avatarKey, id,
	)
	return err
}

func (r *UserRepository) UpdateMe(ctx context.Context, id uint64, name string, avatarKey *string) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE users SET name = ?, avatar_key = ? WHERE id = ?`,
		name, avatarKey, id,
	)
	return err
}

// StoreRefreshToken adds a session. It must not touch the user's other live
// tokens: deleting them all signed a user out on every other device (their
// phone went blank the moment they signed in on the simulator). Only this
// user's expired rows are cleared, as housekeeping.
func (r *UserRepository) StoreRefreshToken(ctx context.Context, userID uint64, tokenHash string, expiresAt time.Time) error {
	return withTx(ctx, r.DB, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx,
			`DELETE FROM refresh_tokens WHERE user_id = ? AND expires_at < ?`, userID, time.Now(),
		); err != nil {
			return err
		}
		_, err := tx.ExecContext(ctx,
			`INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES (?, ?, ?)`,
			userID, tokenHash, expiresAt,
		)
		return err
	})
}

func (r *UserRepository) FindRefreshToken(ctx context.Context, tokenHash string) (userID uint64, expiresAt time.Time, err error) {
	err = r.DB.QueryRowContext(ctx,
		`SELECT user_id, expires_at FROM refresh_tokens WHERE token_hash = ?`, tokenHash,
	).Scan(&userID, &expiresAt)
	return
}

func (r *UserRepository) DeleteRefreshToken(ctx context.Context, tokenHash string) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM refresh_tokens WHERE token_hash = ?`, tokenHash)
	return err
}

// DeleteUser removes the user. Places, spaces they own, memories, memberships
// and tokens all go with it through ON DELETE CASCADE.
func (r *UserRepository) DeleteUser(ctx context.Context, id uint64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM users WHERE id = ?`, id)
	return err
}

// SaveInterests replaces the user's interest categories atomically.
func (r *UserRepository) SaveInterests(ctx context.Context, userID uint64, categories []string) error {
	return withTx(ctx, r.DB, func(tx *sql.Tx) error {
		if _, err := tx.ExecContext(ctx, `DELETE FROM user_interests WHERE user_id = ?`, userID); err != nil {
			return err
		}
		for _, cat := range categories {
			if _, err := tx.ExecContext(ctx,
				`INSERT INTO user_interests (user_id, category) VALUES (?, ?)`, userID, cat,
			); err != nil {
				return err
			}
		}
		return nil
	})
}

// GetInterests returns all interest category slugs for a user.
func (r *UserRepository) GetInterests(ctx context.Context, userID uint64) ([]string, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT category FROM user_interests WHERE user_id = ?`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var cats []string
	for rows.Next() {
		var cat string
		if err := rows.Scan(&cat); err != nil {
			return nil, err
		}
		cats = append(cats, cat)
	}
	return cats, rows.Err()
}

// ── Saved starting points ───────────────────────────────────────────────────

func (r *UserRepository) ListLocations(ctx context.Context, userID uint64) ([]*models.SavedLocation, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, label, address, lat, lng FROM user_locations WHERE user_id = ? ORDER BY created_at`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	locs := []*models.SavedLocation{}
	for rows.Next() {
		l := &models.SavedLocation{}
		if err := rows.Scan(&l.ID, &l.Label, &l.Address, &l.Lat, &l.Lng); err != nil {
			return nil, err
		}
		locs = append(locs, l)
	}
	return locs, rows.Err()
}

func (r *UserRepository) CreateLocation(ctx context.Context, userID uint64, label, address string, lat, lng float64) (uint64, error) {
	res, err := r.DB.ExecContext(ctx,
		`INSERT INTO user_locations (user_id, label, address, lat, lng) VALUES (?, ?, ?, ?, ?)`,
		userID, label, address, lat, lng,
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return uint64(id), err
}

// DeleteLocation is scoped by user_id so one user can never delete another's.
func (r *UserRepository) DeleteLocation(ctx context.Context, userID, id uint64) (bool, error) {
	res, err := r.DB.ExecContext(ctx,
		`DELETE FROM user_locations WHERE id = ? AND user_id = ?`, id, userID)
	if err != nil {
		return false, err
	}
	n, err := res.RowsAffected()
	return n > 0, err
}
