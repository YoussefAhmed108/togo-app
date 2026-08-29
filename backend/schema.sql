-- ============================================================
-- schema.sql — full database schema for the app
-- Run once against an empty database:
--   mysql -u root -p appdb < schema.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

DROP TABLE IF EXISTS place_lookups;
DROP TABLE IF EXISTS url_extractions;
DROP TABLE IF EXISTS recommendations_cache;
DROP TABLE IF EXISTS user_interests;
DROP TABLE IF EXISTS space_places;
DROP TABLE IF EXISTS space_invites;
DROP TABLE IF EXISTS space_members;
DROP TABLE IF EXISTS spaces;
DROP TABLE IF EXISTS memories;
DROP TABLE IF EXISTS place_tags;
DROP TABLE IF EXISTS places;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS refresh_tokens;
DROP TABLE IF EXISTS users;

SET FOREIGN_KEY_CHECKS = 1;

-- ----------------------------------------------------------
-- Users
-- ----------------------------------------------------------
CREATE TABLE users (
  id               BIGINT UNSIGNED  AUTO_INCREMENT PRIMARY KEY,
  email            VARCHAR(255)     NOT NULL UNIQUE,
  password         VARCHAR(255)     NOT NULL,
  phone_number     VARCHAR(20)      NULL UNIQUE,
  name             VARCHAR(100)     NULL,
  username         VARCHAR(50)      NULL UNIQUE,
  avatar_key       VARCHAR(512)     NULL,
  profile_complete TINYINT(1)       NOT NULL DEFAULT 0,
  created_at       TIMESTAMP        DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP        DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- ----------------------------------------------------------
-- Refresh tokens (single active token per user, rotated on use)
-- ----------------------------------------------------------
CREATE TABLE refresh_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(64)     NOT NULL UNIQUE,  -- SHA-256 hex of the raw token
  expires_at TIMESTAMP       NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Tags (global deduplicated pool)
-- ----------------------------------------------------------
CREATE TABLE tags (
  id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE
);

-- ----------------------------------------------------------
-- Places (user-owned)
--
-- saved = 1  → appears in the user's personal "Saved Places" list
-- saved = 0  → created from a space context; only visible via that space,
--              not polluting the personal list
-- ----------------------------------------------------------
CREATE TABLE places (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id   BIGINT UNSIGNED NOT NULL,
  saved      TINYINT(1)      NOT NULL DEFAULT 1,
  visited    TINYINT(1)      NOT NULL DEFAULT 0,
  name       VARCHAR(255)    NOT NULL,
  address    VARCHAR(512)    NULL,
  lat        DECIMAL(10, 7)  NOT NULL,
  lng        DECIMAL(10, 7)  NOT NULL,
  -- Dedupe key: the same venue shared from several TikToks, by several users,
  -- must converge on one identity. NULL for manually dropped pins.
  google_place_id VARCHAR(255) NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_place_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Place <-> Tag junction
-- ----------------------------------------------------------
CREATE TABLE place_tags (
  place_id BIGINT UNSIGNED NOT NULL,
  tag_id   INT UNSIGNED    NOT NULL,
  PRIMARY KEY (place_id, tag_id),
  CONSTRAINT fk_pt_place FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_tag   FOREIGN KEY (tag_id)   REFERENCES tags(id)   ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Spaces (shared groups)
-- ----------------------------------------------------------
CREATE TABLE spaces (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255)    NOT NULL,
  icon       VARCHAR(32)     NOT NULL DEFAULT '🌍',
  banner_key VARCHAR(512)    NULL,  -- R2 / S3 object key
  owner_id   BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_space_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Memories (photos attached to a place)
--
-- space_id = NULL  → memory added outside any space context (personal)
-- space_id = N     → memory attributed to that specific space
-- ----------------------------------------------------------
CREATE TABLE memories (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  place_id    BIGINT UNSIGNED NOT NULL,
  space_id    BIGINT UNSIGNED NULL,
  uploader_id BIGINT UNSIGNED NOT NULL,
  image_key   VARCHAR(512)    NOT NULL,  -- R2 / S3 object key
  caption     VARCHAR(512)    NULL,
  created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mem_place    FOREIGN KEY (place_id)    REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_mem_space    FOREIGN KEY (space_id)    REFERENCES spaces(id) ON DELETE SET NULL,
  CONSTRAINT fk_mem_uploader FOREIGN KEY (uploader_id) REFERENCES users(id)  ON DELETE CASCADE
);


-- ----------------------------------------------------------
-- Space members
-- ----------------------------------------------------------
CREATE TABLE space_members (
  space_id  BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  role      ENUM('owner', 'member') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (space_id, user_id),
  CONSTRAINT fk_sm_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Space <-> Place junction
-- ----------------------------------------------------------
CREATE TABLE space_places (
  space_id  BIGINT UNSIGNED NOT NULL,
  place_id  BIGINT UNSIGNED NOT NULL,
  added_by  BIGINT UNSIGNED NOT NULL,
  added_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (space_id, place_id),
  CONSTRAINT fk_sp_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_place FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_user  FOREIGN KEY (added_by) REFERENCES users(id)  ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Space invite links
-- ----------------------------------------------------------
CREATE TABLE space_invites (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  space_id   BIGINT UNSIGNED NOT NULL,
  token      VARCHAR(64)     NOT NULL UNIQUE,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_si_space   FOREIGN KEY (space_id)   REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_si_creator FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- User interest categories (onboarding)
-- ----------------------------------------------------------
CREATE TABLE user_interests (
  user_id  BIGINT UNSIGNED NOT NULL,
  category VARCHAR(50)     NOT NULL,
  PRIMARY KEY (user_id, category),
  CONSTRAINT fk_ui_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ----------------------------------------------------------
-- Shared grid-based recommendations cache
-- Keyed by (grid_lat, grid_lng, category); TTL enforced in app code (48h).
-- ----------------------------------------------------------
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

-- ----------------------------------------------------------
-- Indexes for hot query paths
-- ----------------------------------------------------------
CREATE INDEX idx_places_owner   ON places(owner_id);
CREATE INDEX idx_memories_place ON memories(place_id);
CREATE INDEX idx_memories_space ON memories(space_id);
CREATE INDEX idx_sm_user        ON space_members(user_id);
CREATE INDEX idx_sp_space       ON space_places(space_id);
CREATE INDEX idx_rt_user        ON refresh_tokens(user_id);
CREATE INDEX idx_si_space       ON space_invites(space_id);
CREATE INDEX idx_places_google_id ON places(google_place_id);

-- ----------------------------------------------------------
-- Extraction caches (POST /places/extract)
--
-- One uncached extraction is ~$0.041: ~$0.032 Google Places Text Search +
-- ~$0.009 Claude vision. Two layers, cheapest lookup first — see
-- internal/extract/cache.go and migration 008.
-- ----------------------------------------------------------

-- Same video shared again. Skips the whole pipeline. TTL 24h in app code.
CREATE TABLE url_extractions (
  url_hash    CHAR(64)   NOT NULL PRIMARY KEY,
  url         VARCHAR(2048) NOT NULL,
  result_json MEDIUMTEXT NOT NULL,
  created_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_url_extractions_age (created_at)
);

-- Same venue from ANY video, keyed on the normalized query. Includes queries
-- that matched nothing — a miss costs the same $0.032 as a hit. TTL 30d.
CREATE TABLE place_lookups (
  query_hash   CHAR(64)      NOT NULL PRIMARY KEY,
  query        VARCHAR(512)  NOT NULL,
  results_json MEDIUMTEXT    NOT NULL,
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_place_lookups_age (created_at)
);
