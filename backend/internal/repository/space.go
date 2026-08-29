package repository

import (
	"context"
	"crypto/rand"
	"database/sql"
	"encoding/hex"
	"fmt"
	"strings"

	"app/backend/internal/models"
)

type SpaceRepository struct {
	Base
}

func (r *SpaceRepository) CreateSpace(ctx context.Context, name, icon string, ownerID uint64) (uint64, error) {
	var spaceID uint64
	err := withTx(ctx, r.DB, func(tx *sql.Tx) error {
		res, err := tx.ExecContext(ctx,
			`INSERT INTO spaces (name, icon, owner_id) VALUES (?, ?, ?)`, name, icon, ownerID,
		)
		if err != nil {
			return err
		}
		id, err := res.LastInsertId()
		if err != nil {
			return err
		}
		spaceID = uint64(id)
		_, err = tx.ExecContext(ctx,
			`INSERT INTO space_members (space_id, user_id, role) VALUES (?, ?, 'owner')`, spaceID, ownerID,
		)
		return err
	})
	return spaceID, err
}

func (r *SpaceRepository) GetSpace(ctx context.Context, id uint64) (*models.Space, error) {
	s := &models.Space{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT id, name, icon, banner_key, owner_id, created_at, updated_at FROM spaces WHERE id = ?`, id,
	).Scan(&s.ID, &s.Name, &s.Icon, &s.BannerKey, &s.OwnerID, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return s, nil
}

func (r *SpaceRepository) ListSpacesByMember(ctx context.Context, userID uint64) ([]*models.Space, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT s.id, s.name, s.icon, s.banner_key, s.owner_id, s.created_at, s.updated_at
		 FROM spaces s
		 JOIN space_members sm ON sm.space_id = s.id
		 WHERE sm.user_id = ?
		 ORDER BY s.created_at DESC`, userID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var spaces []*models.Space
	for rows.Next() {
		s := &models.Space{}
		if err := rows.Scan(&s.ID, &s.Name, &s.Icon, &s.BannerKey, &s.OwnerID, &s.CreatedAt, &s.UpdatedAt); err != nil {
			return nil, err
		}
		spaces = append(spaces, s)
	}
	return spaces, rows.Err()
}

// ListSpacesSummary returns spaces the user belongs to, enriched with
// member_count, place_count, and a preview of the first 3 member names.
// Two queries are used to avoid an N+1 pattern:
//  1. Main query with COUNT subqueries for each space.
//  2. A single batch query to fetch member name previews.
func (r *SpaceRepository) ListSpacesSummary(ctx context.Context, userID uint64) ([]*models.SpaceSummary, error) {
	// ── Query 1: spaces with counts ──────────────────────────────────────────
	rows, err := r.DB.QueryContext(ctx, `
		SELECT
			s.id, s.name, s.icon, s.banner_key, s.owner_id, s.created_at, s.updated_at,
			(SELECT COUNT(*) FROM space_members WHERE space_id = s.id) AS member_count,
			(SELECT COUNT(*) FROM space_places  WHERE space_id = s.id) AS place_count
		FROM spaces s
		JOIN space_members sm ON sm.space_id = s.id
		WHERE sm.user_id = ?
		ORDER BY s.created_at DESC`, userID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var summaries []*models.SpaceSummary
	var spaceIDs []uint64
	for rows.Next() {
		ss := &models.SpaceSummary{}
		if err := rows.Scan(
			&ss.ID, &ss.Name, &ss.Icon, &ss.BannerKey, &ss.OwnerID,
			&ss.CreatedAt, &ss.UpdatedAt,
			&ss.MemberCount, &ss.PlaceCount,
		); err != nil {
			return nil, err
		}
		summaries = append(summaries, ss)
		spaceIDs = append(spaceIDs, ss.ID)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}
	if len(summaries) == 0 {
		return summaries, nil
	}

	// ── Query 2: first 3 members per space (ordered by joined_at) ────────────
	placeholders := strings.Repeat("?,", len(spaceIDs))
	placeholders = placeholders[:len(placeholders)-1]
	args := make([]any, len(spaceIDs))
	for i, id := range spaceIDs {
		args[i] = id
	}

	mRows, err := r.DB.QueryContext(ctx, fmt.Sprintf(`
		SELECT sm.space_id, u.id, u.name, u.avatar_key
		FROM space_members sm
		JOIN users u ON u.id = sm.user_id
		WHERE sm.space_id IN (%s)
		ORDER BY sm.space_id, sm.joined_at`, placeholders), args...)
	if err != nil {
		return nil, err
	}
	defer mRows.Close()

	// Collect up to 3 previews per space
	previewMap := make(map[uint64][]models.MemberPreview, len(spaceIDs))
	for mRows.Next() {
		var spaceID uint64
		var mp models.MemberPreview
		if err := mRows.Scan(&spaceID, &mp.UserID, &mp.Name, &mp.AvatarKey); err != nil {
			return nil, err
		}
		if len(previewMap[spaceID]) < 3 {
			previewMap[spaceID] = append(previewMap[spaceID], mp)
		}
	}
	if err := mRows.Err(); err != nil {
		return nil, err
	}

	for _, ss := range summaries {
		ss.MemberPreviews = previewMap[ss.ID]
	}
	return summaries, nil
}

// UpdateSpace patches a space. A nil icon or bannerKey means "leave as-is" —
// omitting the banner from a rename must not wipe the banner.
func (r *SpaceRepository) UpdateSpace(ctx context.Context, id uint64, name string, icon, bannerKey *string) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE spaces SET name = ?, icon = COALESCE(?, icon), banner_key = COALESCE(?, banner_key) WHERE id = ?`,
		name, icon, bannerKey, id,
	)
	return err
}

func (r *SpaceRepository) DeleteSpace(ctx context.Context, id uint64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM spaces WHERE id = ?`, id)
	return err
}

func (r *SpaceRepository) AddMember(ctx context.Context, spaceID, userID uint64) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT IGNORE INTO space_members (space_id, user_id, role) VALUES (?, ?, 'member')`, spaceID, userID,
	)
	return err
}

func (r *SpaceRepository) RemoveMember(ctx context.Context, spaceID, userID uint64) error {
	_, err := r.DB.ExecContext(ctx,
		`DELETE FROM space_members WHERE space_id = ? AND user_id = ? AND role != 'owner'`, spaceID, userID,
	)
	return err
}

func (r *SpaceRepository) GetMember(ctx context.Context, spaceID, userID uint64) (*models.SpaceMember, error) {
	m := &models.SpaceMember{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT space_id, user_id, role, joined_at FROM space_members WHERE space_id = ? AND user_id = ?`,
		spaceID, userID,
	).Scan(&m.SpaceID, &m.UserID, &m.Role, &m.JoinedAt)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (r *SpaceRepository) ListMembers(ctx context.Context, spaceID uint64) ([]*models.SpaceMember, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT space_id, user_id, role, joined_at FROM space_members WHERE space_id = ? ORDER BY joined_at`,
		spaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var members []*models.SpaceMember
	for rows.Next() {
		m := &models.SpaceMember{}
		if err := rows.Scan(&m.SpaceID, &m.UserID, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		members = append(members, m)
	}
	return members, rows.Err()
}

// ListMembersWithNames returns all space members joined with their user profile.
func (r *SpaceRepository) ListMembersWithNames(ctx context.Context, spaceID uint64) ([]*models.MemberWithName, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT sm.user_id, u.name, u.avatar_key, sm.role, sm.joined_at
		FROM space_members sm
		JOIN users u ON u.id = sm.user_id
		WHERE sm.space_id = ?
		ORDER BY CASE sm.role WHEN 'owner' THEN 0 ELSE 1 END, sm.joined_at`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.MemberWithName
	for rows.Next() {
		m := &models.MemberWithName{}
		if err := rows.Scan(&m.UserID, &m.Name, &m.AvatarKey, &m.Role, &m.JoinedAt); err != nil {
			return nil, err
		}
		out = append(out, m)
	}
	return out, rows.Err()
}

// ListSpaceMemories returns all memories from places that belong to the space,
// enriched with the place name, ordered newest first.
func (r *SpaceRepository) ListSpaceMemories(ctx context.Context, spaceID uint64) ([]*models.SpaceMemory, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT m.id, m.place_id, p.name, m.uploader_id, m.image_key, m.caption, m.created_at
		FROM memories m
		JOIN places p ON p.id = m.place_id
		JOIN space_places sp ON sp.place_id = m.place_id AND sp.space_id = ?
		ORDER BY m.created_at DESC`, spaceID)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var out []*models.SpaceMemory
	for rows.Next() {
		sm := &models.SpaceMemory{}
		if err := rows.Scan(&sm.ID, &sm.PlaceID, &sm.PlaceName,
			&sm.UploaderID, &sm.ImageKey, &sm.Caption, &sm.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, sm)
	}
	return out, rows.Err()
}

func (r *SpaceRepository) IsSpaceMember(ctx context.Context, spaceID, userID uint64) (bool, error) {
	var count int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM space_members WHERE space_id = ? AND user_id = ?`, spaceID, userID,
	).Scan(&count)
	return count > 0, err
}

func (r *SpaceRepository) IsSpaceOwner(ctx context.Context, spaceID, userID uint64) (bool, error) {
	var count int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM space_members WHERE space_id = ? AND user_id = ? AND role = 'owner'`, spaceID, userID,
	).Scan(&count)
	return count > 0, err
}

func (r *SpaceRepository) AddPlaceToSpace(ctx context.Context, spaceID, placeID, addedBy uint64) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT IGNORE INTO space_places (space_id, place_id, added_by) VALUES (?, ?, ?)`, spaceID, placeID, addedBy,
	)
	return err
}

func (r *SpaceRepository) RemovePlaceFromSpace(ctx context.Context, spaceID, placeID uint64) error {
	_, err := r.DB.ExecContext(ctx,
		`DELETE FROM space_places WHERE space_id = ? AND place_id = ?`, spaceID, placeID,
	)
	return err
}

func (r *SpaceRepository) ListSpacePlaceIDs(ctx context.Context, spaceID uint64) ([]uint64, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT place_id FROM space_places WHERE space_id = ? ORDER BY added_at DESC`, spaceID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var ids []uint64
	for rows.Next() {
		var id uint64
		if err := rows.Scan(&id); err != nil {
			return nil, err
		}
		ids = append(ids, id)
	}
	return ids, rows.Err()
}

func (r *SpaceRepository) GetOrCreateInviteToken(ctx context.Context, spaceID, createdBy uint64) (string, error) {
	// Check if a token already exists for this space
	var existing string
	err := r.DB.QueryRowContext(ctx,
		`SELECT token FROM space_invites WHERE space_id = ? LIMIT 1`, spaceID,
	).Scan(&existing)
	if err == nil {
		return existing, nil
	}
	if err != sql.ErrNoRows {
		return "", err
	}

	// Generate a new random token (32 bytes = 64 hex chars)
	buf := make([]byte, 32)
	if _, err := rand.Read(buf); err != nil {
		return "", err
	}
	token := hex.EncodeToString(buf)

	_, err = r.DB.ExecContext(ctx,
		`INSERT INTO space_invites (space_id, token, created_by) VALUES (?, ?, ?)`,
		spaceID, token, createdBy,
	)
	if err != nil {
		return "", err
	}
	return token, nil
}

// IsPlaceInSpace returns true if the given place has been added to the given space.
func (r *SpaceRepository) IsPlaceInSpace(ctx context.Context, spaceID, placeID uint64) (bool, error) {
	var count int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM space_places WHERE space_id = ? AND place_id = ?`, spaceID, placeID,
	).Scan(&count)
	return count > 0, err
}

func (r *SpaceRepository) FindSpaceByInviteToken(ctx context.Context, token string) (*models.Space, error) {
	s := &models.Space{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT s.id, s.name, s.icon, s.banner_key, s.owner_id, s.created_at, s.updated_at
		 FROM spaces s
		 JOIN space_invites si ON si.space_id = s.id
		 WHERE si.token = ?`, token,
	).Scan(&s.ID, &s.Name, &s.Icon, &s.BannerKey, &s.OwnerID, &s.CreatedAt, &s.UpdatedAt)
	if err != nil {
		return nil, err
	}
	return s, nil
}
