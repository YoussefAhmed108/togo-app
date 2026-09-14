-- 011: dishes rated on a memory — a memory can name the dishes eaten and
-- score each out of 5. Split CREATE TABLE / CREATE INDEX for TiDB.

CREATE TABLE memory_dishes (
  id         BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  memory_id  BIGINT UNSIGNED  NOT NULL,
  name       VARCHAR(120)     NOT NULL,
  rating     TINYINT UNSIGNED NOT NULL,
  created_at TIMESTAMP        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_md_memory FOREIGN KEY (memory_id) REFERENCES memories(id) ON DELETE CASCADE
);
CREATE INDEX idx_memory_dishes_memory ON memory_dishes (memory_id);
