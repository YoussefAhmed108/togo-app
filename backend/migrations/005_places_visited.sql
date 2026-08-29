-- 005: add `visited` flag to places

ALTER TABLE places
  ADD COLUMN visited TINYINT(1) NOT NULL DEFAULT 0 AFTER saved;
