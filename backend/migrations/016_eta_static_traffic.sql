-- 016: live ETA without paying for traffic on every list. A list shows the
-- no-traffic drive time (kept 30 days) times a traffic factor learned from
-- the real traffic readings taken when a place is opened. See internal/eta.

CREATE TABLE eta_static (
  origin_cell VARCHAR(24) NOT NULL,
  dest        VARCHAR(24) NOT NULL,
  seconds     INT         NOT NULL, -- -1 = Google cannot route there
  cached_at   TIMESTAMP   NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (origin_cell, dest),
  INDEX idx_eta_static_age (cached_at)
);

-- area is a trip between ~5 km squares ("30.00,31.20>30.05,31.25"), one
-- origin square ("30.00,31.20"), or '*' for the whole city.
-- hour_of_week is 0-167 in Cairo time, Sunday 00:00 = 0.
CREATE TABLE eta_traffic (
  area         VARCHAR(48)       NOT NULL,
  hour_of_week SMALLINT UNSIGNED NOT NULL,
  ratio        DOUBLE            NOT NULL, -- traffic time / no-traffic time, moving average
  samples      INT UNSIGNED      NOT NULL,
  updated_at   TIMESTAMP         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (area, hour_of_week)
);
