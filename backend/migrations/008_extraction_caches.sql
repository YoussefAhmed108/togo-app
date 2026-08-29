-- Cost control for POST /places/extract.
--
-- One uncached extraction is ~$0.041: ~$0.032 Google Places Text Search (Pro
-- SKU) + ~$0.009 Claude vision. Google is ~78% of it, so both caches below are
-- aimed at the Google call first.
--
-- Two layers, cheapest lookup first:
--   url_extractions (migration 007) — same video shared again. Skips everything.
--   place_lookups                   — same venue from ANY video. Skips Google.
--
-- The second layer is the one that compounds. A city has a bounded set of
-- shareable venues and TikTok concentrates on whichever are having a moment,
-- so the same restaurant arrives from dozens of different videos. Per-URL
-- caching misses all of those. Keying on the resolved query (venue name + city
-- + country) collapses them into one paid lookup. Nothing here is
-- city-specific: the key is whatever the model read, so it works the same in
-- Cairo, Lagos or Osaka, and each city warms its own working set.

-- Dedupe key for places. The same venue shared from several TikToks, by
-- several users, must converge on one identity — that is what lets memories
-- from different people attach to the same place instead of near-duplicates.
-- NULL for manually dropped pins.
ALTER TABLE places ADD COLUMN google_place_id VARCHAR(255) NULL AFTER lng;
CREATE INDEX idx_places_google_id ON places(google_place_id);

-- Text-search results keyed by the normalized query, including empty ones.
--
-- Caching a miss matters as much as caching a hit: a video the model cannot
-- pin costs the same $0.032, and unpinnable videos get re-shared like any
-- other. TTL enforced in application code.
--
-- Deliberately NOT read from the `places` table: rows there are private to
-- their owner, while everything stored here came back from Google and is
-- public venue information.
CREATE TABLE place_lookups (
  query_hash   CHAR(64)      NOT NULL PRIMARY KEY,  -- sha256 of normalized query + language
  query        VARCHAR(512)  NOT NULL,              -- kept for debugging/inspection
  results_json MEDIUMTEXT    NOT NULL,              -- []Candidate, possibly empty
  created_at   TIMESTAMP     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  INDEX idx_place_lookups_age (created_at)
);
