-- 010: saved starting points — named locations a user can pick instead of GPS.
-- Split ADD/CREATE INDEX statements for TiDB compatibility.

CREATE TABLE user_locations (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id    BIGINT UNSIGNED NOT NULL,
  label      VARCHAR(60)     NOT NULL,
  address    VARCHAR(512)    NOT NULL,
  lat        DOUBLE          NOT NULL,
  lng        DOUBLE          NOT NULL,
  created_at TIMESTAMP       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_ul_user FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE INDEX idx_user_locations_user ON user_locations (user_id);
