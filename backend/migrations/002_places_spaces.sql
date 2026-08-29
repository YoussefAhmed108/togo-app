-- Migration: 002_places_spaces
-- Extends users for two-step onboarding and adds all app tables

-- One ALTER per column: TiDB rejects both `ADD COLUMN ... UNIQUE` (err 8200) and
-- an `AFTER <col>` that names a column added in the same statement. MySQL accepts
-- this split form identically.
ALTER TABLE users ADD COLUMN name             VARCHAR(100) NULL AFTER email;
ALTER TABLE users ADD COLUMN username         VARCHAR(50)  NULL AFTER name;
ALTER TABLE users ADD COLUMN avatar_key       VARCHAR(512) NULL AFTER username;
ALTER TABLE users ADD COLUMN profile_complete TINYINT(1) NOT NULL DEFAULT 0 AFTER avatar_key;
CREATE UNIQUE INDEX uq_users_username ON users (username);

-- Refresh tokens (single active token per user, rotated on use)
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  token_hash VARCHAR(64)     NOT NULL UNIQUE,  -- SHA-256 hex of the raw token
  expires_at TIMESTAMP       NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_rt_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Tags (global deduplicated pool)
CREATE TABLE IF NOT EXISTS tags (
  id   INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(64) NOT NULL UNIQUE
);

-- Places (user-owned)
CREATE TABLE IF NOT EXISTS places (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  owner_id   BIGINT UNSIGNED NOT NULL,
  name       VARCHAR(255)    NOT NULL,
  address    VARCHAR(512)    NULL,
  lat        DECIMAL(10, 7)  NOT NULL,
  lng        DECIMAL(10, 7)  NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_place_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Place <-> Tag junction
CREATE TABLE IF NOT EXISTS place_tags (
  place_id BIGINT UNSIGNED NOT NULL,
  tag_id   INT UNSIGNED    NOT NULL,
  PRIMARY KEY (place_id, tag_id),
  CONSTRAINT fk_pt_place FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_pt_tag   FOREIGN KEY (tag_id)   REFERENCES tags(id)   ON DELETE CASCADE
);

-- Memories (photos attached to a place)
CREATE TABLE IF NOT EXISTS memories (
  id          BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  place_id    BIGINT UNSIGNED NOT NULL,
  uploader_id BIGINT UNSIGNED NOT NULL,
  image_key   VARCHAR(512)    NOT NULL,  -- R2 object key
  caption     VARCHAR(512)    NULL,
  created_at  TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_mem_place    FOREIGN KEY (place_id)    REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_mem_uploader FOREIGN KEY (uploader_id) REFERENCES users(id)  ON DELETE CASCADE
);

-- Spaces (shared groups)
CREATE TABLE IF NOT EXISTS spaces (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  name       VARCHAR(255)    NOT NULL,
  banner_key VARCHAR(512)    NULL,  -- R2 object key
  owner_id   BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT fk_space_owner FOREIGN KEY (owner_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Space members
CREATE TABLE IF NOT EXISTS space_members (
  space_id  BIGINT UNSIGNED NOT NULL,
  user_id   BIGINT UNSIGNED NOT NULL,
  role      ENUM('owner','member') NOT NULL DEFAULT 'member',
  joined_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (space_id, user_id),
  CONSTRAINT fk_sm_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_sm_user  FOREIGN KEY (user_id)  REFERENCES users(id)  ON DELETE CASCADE
);

-- Space <-> Place junction
CREATE TABLE IF NOT EXISTS space_places (
  space_id  BIGINT UNSIGNED NOT NULL,
  place_id  BIGINT UNSIGNED NOT NULL,
  added_by  BIGINT UNSIGNED NOT NULL,
  added_at  TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (space_id, place_id),
  CONSTRAINT fk_sp_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_place FOREIGN KEY (place_id) REFERENCES places(id) ON DELETE CASCADE,
  CONSTRAINT fk_sp_user  FOREIGN KEY (added_by) REFERENCES users(id)  ON DELETE CASCADE
);

-- Indexes for hot query paths
CREATE INDEX idx_places_owner   ON places(owner_id);
CREATE INDEX idx_memories_place ON memories(place_id);
CREATE INDEX idx_sm_user        ON space_members(user_id);
CREATE INDEX idx_sp_space       ON space_places(space_id);
CREATE INDEX idx_rt_user        ON refresh_tokens(user_id);
