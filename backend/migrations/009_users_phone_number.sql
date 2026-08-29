-- 009: add users.phone_number
--
-- schema.sql has always declared this column and the repository layer selects it
-- (internal/repository/user.go), but no migration ever created it — so any database
-- built from migrations/ failed every login with:
--   Error 1054: Unknown column 'phone_number' in 'field list'
-- Split ADD COLUMN / CREATE INDEX for TiDB compatibility.

ALTER TABLE users ADD COLUMN phone_number VARCHAR(20) NULL AFTER password;
CREATE UNIQUE INDEX uq_users_phone_number ON users (phone_number);
