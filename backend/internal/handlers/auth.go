package handlers

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"database/sql"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"
	"time"

	"app/backend/internal/middleware"
	"app/backend/internal/repository"

	"github.com/golang-jwt/jwt/v5"
	"golang.org/x/crypto/bcrypt"
)

var usernameRe = regexp.MustCompile(`^[a-zA-Z0-9_]{3,20}$`)

type AuthHandler struct {
	users      repository.UserStore
	jwtSecret  string
	accessTTL  time.Duration
	refreshTTL time.Duration
}

func NewAuthHandler(users repository.UserStore, jwtSecret string, accessTTL, refreshTTL time.Duration) *AuthHandler {
	return &AuthHandler{users: users, jwtSecret: jwtSecret, accessTTL: accessTTL, refreshTTL: refreshTTL}
}

var phoneRe = regexp.MustCompile(`^\+?[0-9\s\-().]{7,20}$`)

// POST /api/v1/auth/register
func (h *AuthHandler) Register(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email       string `json:"email"`
		Password    string `json:"password"`
		PhoneNumber string `json:"phone_number"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))
	req.PhoneNumber = strings.TrimSpace(req.PhoneNumber)

	if req.Email == "" || !strings.Contains(req.Email, "@") {
		writeError(w, http.StatusBadRequest, "valid email required")
		return
	}
	if len(req.Password) < 8 {
		writeError(w, http.StatusBadRequest, "password must be at least 8 characters")
		return
	}
	if req.PhoneNumber == "" || !phoneRe.MatchString(req.PhoneNumber) {
		writeError(w, http.StatusBadRequest, "valid phone number required")
		return
	}

	_, err := h.users.FindByEmail(r.Context(), req.Email)
	if err == nil {
		writeError(w, http.StatusConflict, "email already registered")
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}

	hash, err := bcrypt.GenerateFromPassword([]byte(req.Password), bcrypt.DefaultCost)
	if err != nil {
		serverError(w, err)
		return
	}

	userID, err := h.users.CreateUser(r.Context(), req.Email, string(hash), &req.PhoneNumber)
	if err != nil {
		serverError(w, err)
		return
	}

	access, refresh, err := h.issueTokenPair(r.Context(), userID, false)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusCreated, map[string]string{
		"access_token":  access,
		"refresh_token": refresh,
	})
}

// POST /api/v1/auth/login
func (h *AuthHandler) Login(w http.ResponseWriter, r *http.Request) {
	var req struct {
		Email    string `json:"email"`
		Password string `json:"password"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Email = strings.ToLower(strings.TrimSpace(req.Email))

	user, err := h.users.FindByEmail(r.Context(), req.Email)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}

	if err := bcrypt.CompareHashAndPassword([]byte(user.PasswordHash), []byte(req.Password)); err != nil {
		writeError(w, http.StatusUnauthorized, "invalid credentials")
		return
	}

	access, refresh, err := h.issueTokenPair(r.Context(), user.ID, user.ProfileComplete)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"access_token":  access,
		"refresh_token": refresh,
	})
}

// POST /api/v1/auth/refresh
func (h *AuthHandler) Refresh(w http.ResponseWriter, r *http.Request) {
	var req struct {
		RefreshToken string `json:"refresh_token"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	if req.RefreshToken == "" {
		writeError(w, http.StatusBadRequest, "refresh_token required")
		return
	}

	tokenHash := hashToken(req.RefreshToken)
	userID, expiresAt, err := h.users.FindRefreshToken(r.Context(), tokenHash)
	if errors.Is(err, sql.ErrNoRows) {
		writeError(w, http.StatusUnauthorized, "invalid or expired refresh token")
		return
	}
	if err != nil {
		serverError(w, err)
		return
	}
	if time.Now().After(expiresAt) {
		writeError(w, http.StatusUnauthorized, "refresh token expired")
		return
	}

	user, err := h.users.FindByID(r.Context(), userID)
	if err != nil {
		serverError(w, err)
		return
	}

	access, refresh, err := h.issueTokenPair(r.Context(), userID, user.ProfileComplete)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"access_token":  access,
		"refresh_token": refresh,
	})
}

// POST /api/v1/auth/profile-setup  (requires Auth middleware, NOT RequireProfile)
func (h *AuthHandler) ProfileSetup(w http.ResponseWriter, r *http.Request) {
	userID := middleware.GetUserID(r)

	var req struct {
		Name     string `json:"name"`
		Username string `json:"username"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
		writeError(w, http.StatusBadRequest, "invalid request body")
		return
	}
	req.Name = strings.TrimSpace(req.Name)
	req.Username = strings.TrimSpace(req.Username)

	if req.Name == "" {
		writeError(w, http.StatusBadRequest, "name required")
		return
	}
	if !usernameRe.MatchString(req.Username) {
		writeError(w, http.StatusBadRequest, "username must be 3-20 characters (letters, numbers, underscores)")
		return
	}

	_, err := h.users.FindByUsername(r.Context(), req.Username)
	if err == nil {
		writeError(w, http.StatusConflict, "username already taken")
		return
	}
	if !errors.Is(err, sql.ErrNoRows) {
		serverError(w, err)
		return
	}

	if err := h.users.UpdateProfile(r.Context(), userID, req.Name, req.Username, nil); err != nil {
		serverError(w, err)
		return
	}

	// Issue new tokens with profile_complete: true
	access, refresh, err := h.issueTokenPair(r.Context(), userID, true)
	if err != nil {
		serverError(w, err)
		return
	}

	writeJSON(w, http.StatusOK, map[string]string{
		"access_token":  access,
		"refresh_token": refresh,
	})
}

func (h *AuthHandler) issueTokenPair(ctx context.Context, userID uint64, profileComplete bool) (access, refresh string, err error) {
	claims := middleware.Claims{
		UserID:          userID,
		ProfileComplete: profileComplete,
		RegisteredClaims: jwt.RegisteredClaims{
			ExpiresAt: jwt.NewNumericDate(time.Now().Add(h.accessTTL)),
			IssuedAt:  jwt.NewNumericDate(time.Now()),
		},
	}
	access, err = jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(h.jwtSecret))
	if err != nil {
		return
	}

	raw := make([]byte, 32)
	if _, err = rand.Read(raw); err != nil {
		return
	}
	refresh = base64.RawURLEncoding.EncodeToString(raw)
	tokenHash := hashToken(refresh)
	expiresAt := time.Now().Add(h.refreshTTL)

	err = h.users.StoreRefreshToken(ctx, userID, tokenHash, expiresAt)
	return
}

func hashToken(raw string) string {
	h := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(h[:])
}
