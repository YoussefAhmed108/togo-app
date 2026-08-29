-- 004: add `saved` flag to places, add `space_id` to memories

ALTER TABLE places
  ADD COLUMN saved TINYINT(1) NOT NULL DEFAULT 1 AFTER owner_id;

-- Split: TiDB cannot add a constraint on a column created in the same ALTER.
ALTER TABLE memories ADD COLUMN space_id BIGINT UNSIGNED NULL AFTER place_id;
ALTER TABLE memories
  ADD CONSTRAINT fk_memories_space FOREIGN KEY (space_id) REFERENCES spaces(id) ON DELETE SET NULL;

CREATE INDEX idx_memories_space ON memories (space_id);
