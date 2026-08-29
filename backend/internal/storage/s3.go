// Package storage provides image upload and CDN URL helpers.
//
// Two modes:
//
//	R2 mode   — Cloudflare R2 via presigned PUT URLs (production).
//	            Frontend uploads directly to R2; backend only stores the key.
//	Local mode — Backend receives the file itself and stores it on disk
//	             (local development, no R2 credentials needed).
//	             The presign endpoint returns a URL pointing back at the
//	             backend's /local-upload/{key} route, so the frontend code
//	             is identical in both modes.
package storage

import (
	"context"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"time"

	"app/backend/internal/config"

	"github.com/aws/aws-sdk-go-v2/aws"
	awsconfig "github.com/aws/aws-sdk-go-v2/config"
	"github.com/aws/aws-sdk-go-v2/credentials"
	"github.com/aws/aws-sdk-go-v2/service/s3"
)

// Client handles presigning and CDN URL assembly.
// Call IsLocalMode to know which mode is active.
type Client struct {
	// R2 / S3
	api        *s3.Client // kept for HeadBucket in Ping; presigning never hits the network
	presigner  *s3.PresignClient
	bucket     string
	publicBase string // e.g. "https://cdn.yourdomain.com"

	// Local disk
	localMode bool
	localDir  string // absolute or relative path to store files
	localBase string // base URL accessible from the device, e.g. "http://192.168.1.5:8080"
}

// NewClient creates an R2-backed client (production).
func NewClient(cfg *config.Config) (*Client, error) {
	r2Endpoint := fmt.Sprintf("https://%s.r2.cloudflarestorage.com", cfg.R2AccountID)

	awsCfg, err := awsconfig.LoadDefaultConfig(context.Background(),
		awsconfig.WithCredentialsProvider(
			credentials.NewStaticCredentialsProvider(cfg.R2AccessKeyID, cfg.R2SecretAccessKey, ""),
		),
		awsconfig.WithRegion("auto"),
	)
	if err != nil {
		return nil, fmt.Errorf("storage: load config: %w", err)
	}

	s3Client := s3.NewFromConfig(awsCfg, func(o *s3.Options) {
		o.BaseEndpoint = aws.String(r2Endpoint)
		o.UsePathStyle = true
	})

	return &Client{
		api:        s3Client,
		presigner:  s3.NewPresignClient(s3Client),
		bucket:     cfg.R2BucketName,
		publicBase: cfg.R2PublicBaseURL,
	}, nil
}

// NewLocalClient creates a local-disk client for development.
// dir is the directory to store uploaded files.
// baseURL is the URL the device uses to reach the backend
// (e.g. "http://localhost:8080" for iOS Simulator, "http://10.0.2.2:8080" for Android Emulator,
// or "http://<LAN-IP>:8080" for a physical device).
func NewLocalClient(dir, baseURL string) *Client {
	return &Client{
		localMode: true,
		localDir:  dir,
		localBase: baseURL,
	}
}

// Ping verifies the bucket is reachable with the configured credentials.
// Local mode has no remote to check, so it always succeeds.
func (c *Client) Ping(ctx context.Context) error {
	if c.localMode {
		return nil
	}
	_, err := c.api.HeadBucket(ctx, &s3.HeadBucketInput{Bucket: aws.String(c.bucket)})
	return err
}

// IsLocalMode reports whether the client is using local-disk storage.
func (c *Client) IsLocalMode() bool { return c.localMode }

// LocalDir returns the upload directory (only meaningful in local mode).
func (c *Client) LocalDir() string { return c.localDir }

// PresignPut returns a URL the client should PUT the image to.
//
// R2 mode:    a real AWS/R2 presigned URL (expires after ttl).
// Local mode: a URL pointing to the backend's own /local-upload/{key} endpoint.
func (c *Client) PresignPut(ctx context.Context, key string, ttl time.Duration) (string, error) {
	if c.localMode {
		// URL-encode the key so slashes in paths (e.g. "memory/42/uuid") are safe
		return c.localBase + "/local-upload/" + url.PathEscape(key), nil
	}

	req, err := c.presigner.PresignPutObject(ctx, &s3.PutObjectInput{
		Bucket: aws.String(c.bucket),
		Key:    aws.String(key),
	}, s3.WithPresignExpires(ttl))
	if err != nil {
		return "", fmt.Errorf("storage: presign put: %w", err)
	}
	return req.URL, nil
}

// CDNUrl assembles the public URL for a stored object key.
//
// R2 mode:    publicBase + "/" + key
// Local mode: localBase + "/local-files/" + key
func (c *Client) CDNUrl(key string) string {
	if key == "" {
		return ""
	}
	if c.localMode {
		return c.localBase + "/local-files/" + key
	}
	if c.publicBase == "" {
		return key
	}
	return c.publicBase + "/" + key
}

// SaveLocal writes raw bytes to localDir/key, creating any needed subdirectories.
// Only valid in local mode; returns an error otherwise.
func (c *Client) SaveLocal(key string, data []byte) error {
	if !c.localMode {
		return fmt.Errorf("storage: SaveLocal called in R2 mode")
	}
	dest := filepath.Join(c.localDir, filepath.FromSlash(key))
	if err := os.MkdirAll(filepath.Dir(dest), 0755); err != nil {
		return fmt.Errorf("storage: mkdir %s: %w", filepath.Dir(dest), err)
	}
	return os.WriteFile(dest, data, 0644)
}
