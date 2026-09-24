-- 015: shared live-travel-time cache. One row per (~500 m origin cell, venue
-- coordinates). Rows are overwritten and served for 5 minutes. See internal/eta.

CREATE TABLE eta_cache (
  origin_cell VARCHAR(24) NOT NULL,
  dest        VARCHAR(24) NOT NULL,
  seconds     INT         NOT NULL, -- -1 = Google cannot route there
  cached_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (origin_cell, dest),
  INDEX idx_eta_cache_age (cached_at)
);
