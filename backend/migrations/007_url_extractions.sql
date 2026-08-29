-- Cache for TikTok place extraction (POST /places/extract).
--
-- One extraction costs ~$0.04 (Claude vision + Google Places) and ~9-13s, most
-- of it spent downloading the video. Shared links get passed around, so the same
-- URL is extracted repeatedly. Keyed by a hash of the resolved URL rather than
-- the URL itself, because share links are long and vary in tracking params.
--
-- TTL enforced in application code (24 hours), mirroring recommendations_cache.
--
-- NOT YET USED: the table exists so the cache can be switched on without a
-- migration. See internal/extract/cache.go for the (commented out) reader/writer.
CREATE TABLE url_extractions (
  url_hash    CHAR(64)   NOT NULL PRIMARY KEY,   -- sha256 hex of the request URL
  url         VARCHAR(2048) NOT NULL,            -- kept for debugging/inspection
  result_json MEDIUMTEXT NOT NULL,               -- the full extractResponse payload
  created_at  TIMESTAMP  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_url_extractions_age (created_at)
);
