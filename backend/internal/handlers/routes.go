package handlers

import (
	"database/sql"
	"net/http"

	"app/backend/internal/config"
	"app/backend/internal/middleware"
	"app/backend/internal/repository"
	"app/backend/internal/storage"

	"github.com/gorilla/mux"
)

type Dependencies struct {
	DB      *sql.DB
	Storage *storage.Client
	Config  *config.Config
}

func RegisterRoutes(r *mux.Router, deps Dependencies) {
	// Repositories
	userRepo := &repository.UserRepository{Base: repository.Base{DB: deps.DB}}
	placeRepo := &repository.PlaceRepository{Base: repository.Base{DB: deps.DB}}
	spaceRepo := &repository.SpaceRepository{Base: repository.Base{DB: deps.DB}}

	// Handlers
	authH := NewAuthHandler(userRepo, deps.Config.JWTSecret, deps.Config.JWTAccessExpiry, deps.Config.JWTRefreshExpiry)
	userH := NewUserHandler(userRepo, deps.Storage)
	placeH := NewPlaceHandler(placeRepo, spaceRepo, deps.Storage)
	spaceH := NewSpaceHandler(spaceRepo, placeRepo, deps.Storage)
	uploadH := NewUploadHandler(deps.Storage)
	extractH := NewExtractHandler(deps.Config.AnthropicAPIKey, deps.Config.GooglePlacesKey, deps.DB)
	// A cache MISS downloads a video and calls two paid APIs (~$0.041), so
	// extraction stays capped per user regardless of hit rate. Worst case per
	// user, all misses: 10/hr, 40/day ≈ $1.64/day.
	extractLimiter := middleware.NewRateLimiter(10, 40)
	recH := NewRecommendationHandler(userRepo, placeRepo, spaceRepo, deps.DB, deps.Config.GooglePlacesKey)

	// ── Local-mode routes (registered on the root router, not under /api/v1) ──
	// These are only active when R2 is not configured (local development).
	// /local-upload/{key} — receives the raw image PUT from the React Native app.
	// /local-files/       — serves stored images back as a static file tree.
	if deps.Storage.IsLocalMode() {
		r.HandleFunc("/local-upload/{key:.*}", uploadH.LocalUpload).Methods(http.MethodPut)
		r.PathPrefix("/local-files/").Handler(
			http.StripPrefix("/local-files/", http.FileServer(http.Dir(deps.Config.LocalUploadDir))),
		)
	}

	authMiddleware := middleware.Auth(deps.Config.JWTSecret)

	api := r.PathPrefix("/api/v1").Subrouter()
	api.Use(middleware.Logger, middleware.JSON)

	// Health check (public)
	api.HandleFunc("/health", func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
		w.Write([]byte(`{"status":"ok"}`))
	}).Methods(http.MethodGet)

	// Deep health check (public): probes DB, R2, Google Maps and Anthropic.
	// Kept separate from /health so a platform health check never fails because
	// a third party is down, and never makes outbound calls on every probe.
	// Limit() keys on GetUserID, which is 0 here, so this is one shared bucket
	// across all callers — enough to stop anyone hammering the outbound probes.
	healthH := NewHealthHandler(deps.DB, deps.Storage, deps.Config.GooglePlacesKey, deps.Config.AnthropicAPIKey)
	deepLimiter := middleware.NewRateLimiter(120, 2000)
	api.HandleFunc("/health/deep", deepLimiter.Limit(healthH.Deep)).Methods(http.MethodGet)

	// API docs (public)
	api.HandleFunc("/docs", serveSwaggerUI).Methods(http.MethodGet)
	api.HandleFunc("/docs/openapi.yaml", serveOpenAPISpec).Methods(http.MethodGet)

	// --- Auth routes (public) ---
	auth := api.PathPrefix("/auth").Subrouter()
	auth.HandleFunc("/register", authH.Register).Methods(http.MethodPost)
	auth.HandleFunc("/login", authH.Login).Methods(http.MethodPost)
	auth.HandleFunc("/refresh", authH.Refresh).Methods(http.MethodPost)

	// Profile setup: Auth required, but NOT RequireProfile
	authSetup := auth.NewRoute().Subrouter()
	authSetup.Use(authMiddleware)
	authSetup.HandleFunc("/profile-setup", authH.ProfileSetup).Methods(http.MethodPost)

	// --- Authenticated + profile-complete routes ---
	protected := api.NewRoute().Subrouter()
	protected.Use(authMiddleware)
	protected.Use(middleware.RequireProfile)

	// Users
	protected.HandleFunc("/users/me", userH.GetMe).Methods(http.MethodGet)
	protected.HandleFunc("/users/me", userH.UpdateMe).Methods(http.MethodPut)
	protected.HandleFunc("/users/me/interests", userH.SaveInterests).Methods(http.MethodPost)

	// Places — /places/extract must be registered before /places/{id},
	// or mux treats "extract" as a place id.
	protected.HandleFunc("/places/extract", extractLimiter.Limit(extractH.ExtractPlace)).Methods(http.MethodPost)
	protected.HandleFunc("/places", placeH.ListPlaces).Methods(http.MethodGet)
	protected.HandleFunc("/places", placeH.CreatePlace).Methods(http.MethodPost)
	protected.HandleFunc("/places/{id}", placeH.GetPlace).Methods(http.MethodGet)
	protected.HandleFunc("/places/{id}", placeH.UpdatePlace).Methods(http.MethodPut)
	protected.HandleFunc("/places/{id}", placeH.DeletePlace).Methods(http.MethodDelete)
	protected.HandleFunc("/places/{id}/visited", placeH.SetVisited).Methods(http.MethodPatch)
	protected.HandleFunc("/places/{id}/tags", placeH.AddTags).Methods(http.MethodPost)
	protected.HandleFunc("/places/{id}/tags", placeH.RemoveTag).Methods(http.MethodDelete)
	protected.HandleFunc("/places/{id}/memories", placeH.ListMemories).Methods(http.MethodGet)
	protected.HandleFunc("/places/{id}/memories", placeH.AddMemory).Methods(http.MethodPost)
	protected.HandleFunc("/places/{id}/memories/{memoryId}", placeH.DeleteMemory).Methods(http.MethodDelete)

	// Spaces — register /spaces/join BEFORE /spaces/{id} to avoid mux treating "join" as an id
	protected.HandleFunc("/spaces", spaceH.ListSpaces).Methods(http.MethodGet)
	protected.HandleFunc("/spaces", spaceH.CreateSpace).Methods(http.MethodPost)
	protected.HandleFunc("/spaces/join", spaceH.JoinViaInvite).Methods(http.MethodPost)
	protected.HandleFunc("/spaces/{id}", spaceH.GetSpace).Methods(http.MethodGet)
	protected.HandleFunc("/spaces/{id}", spaceH.UpdateSpace).Methods(http.MethodPut)
	protected.HandleFunc("/spaces/{id}", spaceH.DeleteSpace).Methods(http.MethodDelete)
	protected.HandleFunc("/spaces/{id}/invite-link", spaceH.GenerateInviteLink).Methods(http.MethodPost)
	protected.HandleFunc("/spaces/{id}/members", spaceH.ListSpaceMembers).Methods(http.MethodGet)
	protected.HandleFunc("/spaces/{id}/members", spaceH.AddMember).Methods(http.MethodPost)
	protected.HandleFunc("/spaces/{id}/members/{userId}", spaceH.RemoveMember).Methods(http.MethodDelete)
	protected.HandleFunc("/spaces/{id}/memories", spaceH.ListSpaceMemories).Methods(http.MethodGet)
	protected.HandleFunc("/spaces/{id}/places", spaceH.ListSpacePlaces).Methods(http.MethodGet)
	protected.HandleFunc("/spaces/{id}/places", spaceH.AddPlaceToSpace).Methods(http.MethodPost)
	protected.HandleFunc("/spaces/{id}/places/{placeId}", spaceH.RemovePlaceFromSpace).Methods(http.MethodDelete)

	// Recommendations
	protected.HandleFunc("/recommendations", recH.GetGlobal).Methods(http.MethodGet)
	protected.HandleFunc("/spaces/{id}/recommendations", recH.GetSpaceRecs).Methods(http.MethodGet)

	// Uploads
	protected.HandleFunc("/uploads/presign", uploadH.Presign).Methods(http.MethodPost)
}
