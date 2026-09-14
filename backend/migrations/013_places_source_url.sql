-- 013: remember the TikTok a place was extracted from, so the place page can
-- link back to it.

ALTER TABLE places ADD COLUMN source_url VARCHAR(2048) NULL;
