package repository

import (
	"context"
	"database/sql"
	"strings"

	"app/backend/internal/models"
)

type PlaceRepository struct {
	Base
}

func (r *PlaceRepository) CreatePlace(ctx context.Context, ownerID uint64, name string, address *string, lat, lng float64, saved bool, googlePlaceID *string) (uint64, error) {
	savedInt := 1
	if !saved {
		savedInt = 0
	}
	res, err := r.DB.ExecContext(ctx,
		`INSERT INTO places (owner_id, saved, name, address, lat, lng, google_place_id) VALUES (?, ?, ?, ?, ?, ?, ?)`,
		ownerID, savedInt, name, address, lat, lng, googlePlaceID,
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return uint64(id), err
}

// FindByGoogleID returns the owner's existing place for a venue, or 0 when
// they have not saved it. Saving the same venue from two different TikToks
// should reuse the row, not create a near-duplicate the user then has to
// reconcile — and memories attach to one place instead of splitting.
func (r *PlaceRepository) FindByGoogleID(ctx context.Context, ownerID uint64, googlePlaceID string) (uint64, error) {
	var id uint64
	err := r.DB.QueryRowContext(ctx,
		`SELECT id FROM places WHERE owner_id = ? AND google_place_id = ? LIMIT 1`,
		ownerID, googlePlaceID,
	).Scan(&id)
	if err == sql.ErrNoRows {
		return 0, nil
	}
	return id, err
}

func (r *PlaceRepository) GetPlace(ctx context.Context, id uint64) (*models.Place, error) {
	p := &models.Place{}
	err := r.DB.QueryRowContext(ctx,
		`SELECT id, owner_id, saved, visited, name, address, lat, lng, google_place_id, created_at, updated_at FROM places WHERE id = ?`, id,
	).Scan(&p.ID, &p.OwnerID, &p.Saved, &p.Visited, &p.Name, &p.Address, &p.Lat, &p.Lng, &p.GooglePlaceID, &p.CreatedAt, &p.UpdatedAt)
	if err != nil {
		return nil, err
	}
	tags, err := r.GetPlaceTags(ctx, id)
	if err != nil {
		return nil, err
	}
	p.Tags = tags
	return p, nil
}

// ListPlacesByOwner returns only places explicitly saved by the user (saved = 1).
func (r *PlaceRepository) ListPlacesByOwner(ctx context.Context, ownerID uint64) ([]*models.Place, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT id, owner_id, saved, visited, name, address, lat, lng, google_place_id, created_at, updated_at
		 FROM places WHERE owner_id = ? AND saved = 1 ORDER BY created_at DESC`, ownerID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var places []*models.Place
	for rows.Next() {
		p := &models.Place{}
		if err := rows.Scan(&p.ID, &p.OwnerID, &p.Saved, &p.Visited, &p.Name, &p.Address, &p.Lat, &p.Lng, &p.GooglePlaceID, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		places = append(places, p)
	}
	if err := rows.Err(); err != nil {
		return nil, err
	}

	for _, p := range places {
		p.Tags, err = r.GetPlaceTags(ctx, p.ID)
		if err != nil {
			return nil, err
		}
	}
	return places, nil
}

func (r *PlaceRepository) UpdatePlace(ctx context.Context, id uint64, name string, address *string, lat, lng float64) error {
	_, err := r.DB.ExecContext(ctx,
		`UPDATE places SET name = ?, address = ?, lat = ?, lng = ? WHERE id = ?`,
		name, address, lat, lng, id,
	)
	return err
}

func (r *PlaceRepository) DeletePlace(ctx context.Context, id uint64) error {
	_, err := r.DB.ExecContext(ctx, `DELETE FROM places WHERE id = ?`, id)
	return err
}

func (r *PlaceRepository) SetVisited(ctx context.Context, id uint64, visited bool) error {
	v := 0
	if visited {
		v = 1
	}
	_, err := r.DB.ExecContext(ctx, `UPDATE places SET visited = ? WHERE id = ?`, v, id)
	return err
}

func (r *PlaceRepository) IsPlaceOwner(ctx context.Context, placeID, userID uint64) (bool, error) {
	var count int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM places WHERE id = ? AND owner_id = ?`, placeID, userID,
	).Scan(&count)
	return count > 0, err
}

// HasPlaceAccess returns true if userID is the place owner OR is a member of any
// space that contains this place.
func (r *PlaceRepository) HasPlaceAccess(ctx context.Context, placeID, userID uint64) (bool, error) {
	var count int
	err := r.DB.QueryRowContext(ctx, `
		SELECT COUNT(*) FROM (
			SELECT 1 FROM places WHERE id = ? AND owner_id = ?
			UNION
			SELECT 1 FROM space_places sp
			JOIN space_members sm ON sm.space_id = sp.space_id
			WHERE sp.place_id = ? AND sm.user_id = ?
		) x`, placeID, userID, placeID, userID,
	).Scan(&count)
	return count > 0, err
}

// UpsertTag inserts a tag if it doesn't exist and returns its ID.
func (r *PlaceRepository) UpsertTag(ctx context.Context, name string) (uint64, error) {
	name = strings.ToLower(strings.TrimSpace(name))
	_, err := r.DB.ExecContext(ctx, `INSERT IGNORE INTO tags (name) VALUES (?)`, name)
	if err != nil {
		return 0, err
	}
	var id uint64
	err = r.DB.QueryRowContext(ctx, `SELECT id FROM tags WHERE name = ?`, name).Scan(&id)
	return id, err
}

func (r *PlaceRepository) AddTagToPlace(ctx context.Context, placeID, tagID uint64) error {
	_, err := r.DB.ExecContext(ctx,
		`INSERT IGNORE INTO place_tags (place_id, tag_id) VALUES (?, ?)`, placeID, tagID,
	)
	return err
}

func (r *PlaceRepository) RemoveTagFromPlace(ctx context.Context, placeID uint64, tagName string) error {
	tagName = strings.ToLower(strings.TrimSpace(tagName))
	_, err := r.DB.ExecContext(ctx,
		`DELETE pt FROM place_tags pt
		 JOIN tags t ON t.id = pt.tag_id
		 WHERE pt.place_id = ? AND t.name = ?`,
		placeID, tagName,
	)
	return err
}

func (r *PlaceRepository) GetPlaceTags(ctx context.Context, placeID uint64) ([]string, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT t.name FROM tags t JOIN place_tags pt ON pt.tag_id = t.id WHERE pt.place_id = ? ORDER BY t.name`,
		placeID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var t string
		if err := rows.Scan(&t); err != nil {
			return nil, err
		}
		tags = append(tags, t)
	}
	return tags, rows.Err()
}

func (r *PlaceRepository) CreateMemory(ctx context.Context, placeID, uploaderID uint64, imageKey string, caption *string, spaceID *uint64) (uint64, error) {
	res, err := r.DB.ExecContext(ctx,
		`INSERT INTO memories (place_id, space_id, uploader_id, image_key, caption) VALUES (?, ?, ?, ?, ?)`,
		placeID, spaceID, uploaderID, imageKey, caption,
	)
	if err != nil {
		return 0, err
	}
	id, err := res.LastInsertId()
	return uint64(id), err
}

func (r *PlaceRepository) ListMemories(ctx context.Context, placeID uint64) ([]*models.Memory, error) {
	rows, err := r.DB.QueryContext(ctx, `
		SELECT m.id, m.place_id, m.space_id, s.name, m.uploader_id, m.image_key, m.caption, m.created_at
		FROM memories m
		LEFT JOIN spaces s ON s.id = m.space_id
		WHERE m.place_id = ?
		ORDER BY m.created_at DESC`,
		placeID,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var memories []*models.Memory
	for rows.Next() {
		m := &models.Memory{}
		if err := rows.Scan(&m.ID, &m.PlaceID, &m.SpaceID, &m.SpaceName, &m.UploaderID, &m.ImageKey, &m.Caption, &m.CreatedAt); err != nil {
			return nil, err
		}
		memories = append(memories, m)
	}
	return memories, rows.Err()
}

func (r *PlaceRepository) GetMemory(ctx context.Context, memoryID uint64) (*models.Memory, error) {
	m := &models.Memory{}
	err := r.DB.QueryRowContext(ctx, `
		SELECT m.id, m.place_id, m.space_id, s.name, m.uploader_id, m.image_key, m.caption, m.created_at
		FROM memories m
		LEFT JOIN spaces s ON s.id = m.space_id
		WHERE m.id = ?`, memoryID,
	).Scan(&m.ID, &m.PlaceID, &m.SpaceID, &m.SpaceName, &m.UploaderID, &m.ImageKey, &m.Caption, &m.CreatedAt)
	if err != nil {
		return nil, err
	}
	return m, nil
}

func (r *PlaceRepository) DeleteMemory(ctx context.Context, memoryID, placeID uint64) error {
	_, err := r.DB.ExecContext(ctx,
		`DELETE FROM memories WHERE id = ? AND place_id = ?`, memoryID, placeID,
	)
	return err
}

// PlaceExistsForOwner checks if a place exists AND belongs to the given owner.
func (r *PlaceRepository) PlaceExistsForOwner(ctx context.Context, placeID, ownerID uint64) (bool, error) {
	var count int
	err := r.DB.QueryRowContext(ctx,
		`SELECT COUNT(*) FROM places WHERE id = ? AND owner_id = ?`, placeID, ownerID,
	).Scan(&count)
	return count > 0, err
}

// GetUserTagProfile returns the user's most-used tag names ranked by frequency.
func (r *PlaceRepository) GetUserTagProfile(ctx context.Context, userID uint64, limit int) ([]string, error) {
	rows, err := r.DB.QueryContext(ctx,
		`SELECT t.name
		 FROM place_tags pt
		 JOIN tags t ON t.id = pt.tag_id
		 JOIN places p ON p.id = pt.place_id
		 WHERE p.owner_id = ?
		 GROUP BY t.name
		 ORDER BY COUNT(*) DESC
		 LIMIT ?`,
		userID, limit,
	)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var tags []string
	for rows.Next() {
		var tag string
		if err := rows.Scan(&tag); err != nil {
			return nil, err
		}
		tags = append(tags, tag)
	}
	return tags, rows.Err()
}

// ListByIDs fetches multiple places by their IDs (used by space places listing).
func (r *PlaceRepository) ListByIDs(ctx context.Context, ids []uint64) ([]*models.Place, error) {
	if len(ids) == 0 {
		return nil, nil
	}
	args := make([]interface{}, len(ids))
	placeholders := make([]string, len(ids))
	for i, id := range ids {
		args[i] = id
		placeholders[i] = "?"
	}
	query := `SELECT id, owner_id, saved, visited, name, address, lat, lng, created_at, updated_at FROM places WHERE id IN (` + strings.Join(placeholders, ",") + `)`
	rows, err := r.DB.QueryContext(ctx, query, args...)
	if err != nil {
		return nil, err
	}
	defer rows.Close()

	var places []*models.Place
	for rows.Next() {
		p := &models.Place{}
		if err := rows.Scan(&p.ID, &p.OwnerID, &p.Saved, &p.Visited, &p.Name, &p.Address, &p.Lat, &p.Lng, &p.CreatedAt, &p.UpdatedAt); err != nil {
			return nil, err
		}
		places = append(places, p)
	}
	return places, rows.Err()
}
