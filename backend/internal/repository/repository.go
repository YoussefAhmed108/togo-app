package repository

import (
	"context"
	"database/sql"
	"fmt"
)

// Base holds a shared DB connection for all repositories.
type Base struct {
	DB *sql.DB
}

// withTx runs fn inside a transaction, committing on success and rolling back on error.
func withTx(ctx context.Context, db *sql.DB, fn func(*sql.Tx) error) error {
	tx, err := db.BeginTx(ctx, nil)
	if err != nil {
		return fmt.Errorf("begin tx: %w", err)
	}
	if err := fn(tx); err != nil {
		_ = tx.Rollback()
		return err
	}
	return tx.Commit()
}
