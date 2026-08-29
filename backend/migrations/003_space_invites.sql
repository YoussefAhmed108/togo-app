-- Migration: 003_space_invites
-- Adds the space_invites table for invite-link functionality.
-- Also adds the `icon` column to spaces that was missing from 002.

-- Add icon column to spaces (skip if already present in your DB)
ALTER TABLE spaces
  ADD COLUMN icon VARCHAR(32) NOT NULL DEFAULT '🌍' AFTER name;

-- Space invite tokens (one permanent token per space, created on demand)
CREATE TABLE IF NOT EXISTS space_invites (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  space_id   BIGINT UNSIGNED NOT NULL,
  token      VARCHAR(64)     NOT NULL UNIQUE,
  created_by BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP       DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_si_space FOREIGN KEY (space_id)   REFERENCES spaces(id) ON DELETE CASCADE,
  CONSTRAINT fk_si_user  FOREIGN KEY (created_by) REFERENCES users(id)  ON DELETE CASCADE
);

CREATE INDEX idx_si_space ON space_invites(space_id);
