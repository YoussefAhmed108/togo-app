package config

import (
	"database/sql"
	"fmt"
	"log"
	"os"
	"time"

	_ "github.com/go-sql-driver/mysql"
	"github.com/joho/godotenv"
)

type Config struct {
	ServerAddr string

	// MySQL — individual vars (matching MYSQL_* naming convention)
	MySQLHost     string
	MySQLPort     string
	MySQLUser     string
	MySQLPassword string
	MySQLDatabase string
	// MySQLTLS maps to the go-sql-driver `tls` DSN param. Empty = plaintext (local).
	// TiDB Cloud / Aiven / PlanetScale require "true".
	MySQLTLS string

	JWTSecret        string
	JWTAccessExpiry  time.Duration
	JWTRefreshExpiry time.Duration

	R2AccountID       string
	R2AccessKeyID     string
	R2SecretAccessKey string
	R2BucketName      string
	R2PublicBaseURL   string

	// Google Places API key — used for recommendations and TikTok place extraction.
	// Leave empty to disable external recommendations (only cross-space recs will be returned).
	GooglePlacesKey string

	// Anthropic API key — used to read the place name off shared TikTok videos.
	// Leave empty to disable the TikTok share feature.
	AnthropicAPIKey string

	// Local file storage — used automatically when R2 credentials are absent.
	// LocalBaseURL must be reachable from the device running the app:
	//   iOS Simulator  → http://localhost:8080   (default)
	//   Android Emu    → http://10.0.2.2:8080
	//   Physical device → http://<your-mac-LAN-IP>:8080
	LocalUploadDir string // directory to store uploaded files, default: ./uploads
	LocalBaseURL   string // base URL prefix returned to the client
}

func Load() *Config {
	if err := godotenv.Load(); err != nil {
		log.Println("no .env file found, using environment variables")
	}

	return &Config{
		ServerAddr: getEnv("SERVER_ADDR", ":8080"),

		MySQLHost:     getEnv("MYSQL_HOST", "127.0.0.1"),
		MySQLPort:     getEnv("MYSQL_PORT", "3306"),
		MySQLUser:     getEnv("MYSQL_USER", "root"),
		MySQLPassword: getEnv("MYSQL_PASSWORD", ""),
		MySQLDatabase: getEnv("MYSQL_DATABASE", "appdb"),
		MySQLTLS:      getEnv("MYSQL_TLS", ""),

		JWTSecret:        getEnv("JWT_SECRET", "change-me-in-production"),
		JWTAccessExpiry:  getDuration("JWT_ACCESS_EXPIRY", 15*time.Minute),
		JWTRefreshExpiry: getDuration("JWT_REFRESH_EXPIRY", 7*24*time.Hour),

		R2AccountID:       getEnv("R2_ACCOUNT_ID", ""),
		R2AccessKeyID:     getEnv("R2_ACCESS_KEY_ID", ""),
		R2SecretAccessKey: getEnv("R2_SECRET_ACCESS_KEY", ""),
		R2BucketName:      getEnv("R2_BUCKET_NAME", ""),
		R2PublicBaseURL:   getEnv("R2_PUBLIC_BASE_URL", ""),

		// GOOGLE_MAPS_API_KEY is the name the key actually lives under in .env;
		// GOOGLE_PLACES_KEY is kept as an override for existing deployments.
		GooglePlacesKey: getEnv("GOOGLE_PLACES_KEY", getEnv("GOOGLE_MAPS_API_KEY", "")),
		AnthropicAPIKey: getEnv("ANTHROPIC_API_KEY", ""),

		LocalUploadDir: getEnv("LOCAL_UPLOAD_DIR", "./uploads"),
		LocalBaseURL:   getEnv("LOCAL_BASE_URL", "http://localhost:8080"),
	}
}

// NewDB opens a MySQL connection pool with sensible defaults.
func NewDB(cfg *Config) (*sql.DB, error) {
	dsn := fmt.Sprintf(
		"%s:%s@tcp(%s:%s)/%s?parseTime=true&charset=utf8mb4&collation=utf8mb4_unicode_ci&loc=UTC",
		cfg.MySQLUser,
		cfg.MySQLPassword,
		cfg.MySQLHost,
		cfg.MySQLPort,
		cfg.MySQLDatabase,
	)
	if cfg.MySQLTLS != "" {
		dsn += "&tls=" + cfg.MySQLTLS
	}

	db, err := sql.Open("mysql", dsn)
	if err != nil {
		return nil, fmt.Errorf("open db: %w", err)
	}

	// Connection pool settings
	db.SetMaxOpenConns(25)                 // max simultaneous connections
	db.SetMaxIdleConns(10)                 // kept open when idle
	db.SetConnMaxLifetime(5 * time.Minute) // recycle connections every 5 min
	db.SetConnMaxIdleTime(2 * time.Minute) // close idle connections after 2 min

	if err := db.Ping(); err != nil {
		return nil, fmt.Errorf("cannot reach database at %s:%s — %w", cfg.MySQLHost, cfg.MySQLPort, err)
	}

	log.Printf("connected to MySQL  host=%s  db=%s", cfg.MySQLHost, cfg.MySQLDatabase)
	return db, nil
}

func getEnv(key, fallback string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return fallback
}

func getDuration(key string, fallback time.Duration) time.Duration {
	v := os.Getenv(key)
	if v == "" {
		return fallback
	}
	d, err := time.ParseDuration(v)
	if err != nil {
		return fallback
	}
	return d
}
