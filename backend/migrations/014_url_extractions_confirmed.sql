-- 014: a cached extraction is served only after a user confirms it was right.
-- Existing rows start unconfirmed, so nothing unverified keeps being served.

ALTER TABLE url_extractions ADD COLUMN confirmed BOOLEAN NOT NULL DEFAULT FALSE;
