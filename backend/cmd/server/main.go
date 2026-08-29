package main

import (
	"context"
	"database/sql"
	"log"
	"net/http"
	"os"

	"app/backend/internal/config"
	"app/backend/internal/handlers"
	"app/backend/internal/storage"

	"github.com/gorilla/mux"
	"golang.org/x/crypto/bcrypt"
)

func main() {
	cfg := config.Load()

	db, err := config.NewDB(cfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()

	if err := seedDemoAccount(context.Background(), db); err != nil {
		log.Fatalf("failed to seed demo account: %v", err)
	}

	var storageClient *storage.Client
	if cfg.R2AccountID != "" {
		storageClient, err = storage.NewClient(cfg)
		if err != nil {
			log.Fatalf("failed to init storage client: %v", err)
		}
		log.Printf("storage: R2 mode  bucket=%s  cdn=%s", cfg.R2BucketName, cfg.R2PublicBaseURL)
	} else {
		storageClient = storage.NewLocalClient(cfg.LocalUploadDir, cfg.LocalBaseURL)
		log.Printf("storage: local mode  dir=%s  base=%s", cfg.LocalUploadDir, cfg.LocalBaseURL)
	}

	r := mux.NewRouter()
	handlers.RegisterRoutes(r, handlers.Dependencies{
		DB:      db,
		Storage: storageClient,
		Config:  cfg,
	})

	log.Printf("server listening on %s", cfg.ServerAddr)
	log.Fatal(http.ListenAndServe(cfg.ServerAddr, r))
}

func seedDemoAccount(ctx context.Context, db *sql.DB) error {
	email := os.Getenv("DEMO_EMAIL")
	password := os.Getenv("DEMO_PASSWORD")
	if email == "" || password == "" {
		return nil
	}

	name := os.Getenv("DEMO_NAME")
	if name == "" {
		name = "Demo User"
	}
	username := os.Getenv("DEMO_USERNAME")
	if username == "" {
		username = "demo_user"
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(password), bcrypt.DefaultCost)
	if err != nil {
		return err
	}

	var existingID uint64
	err = db.QueryRowContext(ctx, `SELECT id FROM users WHERE email = ?`, email).Scan(&existingID)
	if err != nil && err != sql.ErrNoRows {
		return err
	}

	if err == sql.ErrNoRows {
		_, err = db.ExecContext(ctx,
			`INSERT INTO users (email, password, name, username, profile_complete) VALUES (?, ?, ?, ?, 1)`,
			email, string(hash), name, username,
		)
		if err != nil {
			return err
		}
		log.Printf("seeded demo account email=%s username=%s", email, username)
		return nil
	}

	_, err = db.ExecContext(ctx,
		`UPDATE users SET password = ?, name = ?, username = ?, profile_complete = 1 WHERE id = ?`,
		string(hash), name, username, existingID,
	)
	if err != nil {
		return err
	}
	log.Printf("updated demo account email=%s username=%s", email, username)
	return nil
}
