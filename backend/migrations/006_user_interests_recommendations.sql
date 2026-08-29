-- migration 006 — user interest categories + shared recommendations cache

-- Interest categories chosen during onboarding (one row per category per user)
CREATE TABLE user_interests (
  user_id  BIGINT UNSIGNED NOT NULL,
  category VARCHAR(50)     NOT NULL,
  PRIMARY KEY (user_id, category),
  CONSTRAINT fk_ui_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Shared grid-based cache for Google Places Nearby Search results.
-- Keyed by (rounded lat, rounded lng, interest category) so users in the
-- same ~1 km² tile with the same category share cached results.
-- TTL enforced in application code (48 hours).
CREATE TABLE recommendations_cache (
  id           BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  grid_lat     DECIMAL(5,2)  NOT NULL,
  grid_lng     DECIMAL(5,2)  NOT NULL,
  category     VARCHAR(50)   NOT NULL,
  results_json MEDIUMTEXT    NOT NULL,
  cached_at    TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_cache (grid_lat, grid_lng, category),
  INDEX idx_cache_age (cached_at)
);
