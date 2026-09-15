package main

import (
	"log"
	"net/http"
	"time"

	"app/backend/internal/analytics"
	"app/backend/internal/config"
	"app/backend/internal/handlers"
	"app/backend/internal/storage"

	"github.com/gorilla/mux"
)

func main() {
	cfg := config.Load()

	// A missing or guessable secret lets anyone mint a token for any user id.
	if len(cfg.JWTSecret) < 32 {
		log.Fatal("JWT_SECRET must be set to at least 32 random bytes (openssl rand -base64 48)")
	}

	db, err := config.NewDB(cfg)
	if err != nil {
		log.Fatalf("failed to connect to database: %v", err)
	}
	defer db.Close()
	log.Print("database: connected")

	// Presence only, never the values: "extraction is not configured" and
	// "recommendations are empty" are both silent 3rd-party misconfigurations
	// that this one line diagnoses at boot.
	log.Printf("config: anthropic_key=%t places_key=%t r2=%t posthog=%t",
		cfg.AnthropicAPIKey != "", cfg.GooglePlacesKey != "", cfg.R2AccountID != "", cfg.PostHogKey != "")
	analytics.Init(cfg.PostHogKey, cfg.PostHogHost)

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

	// Timeouts stop slow-loris clients pinning connections forever. WriteTimeout
	// sits above the 150s extraction budget so that endpoint can still finish.
	srv := &http.Server{
		Addr:              cfg.ServerAddr,
		Handler:           r,
		ReadHeaderTimeout: 10 * time.Second,
		ReadTimeout:       30 * time.Second,
		WriteTimeout:      180 * time.Second,
		IdleTimeout:       120 * time.Second,
	}
	log.Printf("server listening on %s", cfg.ServerAddr)
	log.Fatal(srv.ListenAndServe())
}
