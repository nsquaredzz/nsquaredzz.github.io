-- Who has been seen today. `visitor` is a salted hash that changes every day; rows older than
-- one day are deleted by the daily cron. `scope` is '*' for the whole site, or a page path.
CREATE TABLE seen (
  day     TEXT    NOT NULL,
  visitor TEXT    NOT NULL,
  scope   TEXT    NOT NULL,
  n       INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (day, visitor, scope)
) WITHOUT ROWID;

-- Everything below is counts only. Nothing in these tables identifies a person.
CREATE TABLE daily (
  day      TEXT    PRIMARY KEY,
  visitors INTEGER NOT NULL DEFAULT 0,
  views    INTEGER NOT NULL DEFAULT 0
) WITHOUT ROWID;

CREATE TABLE pages (
  day      TEXT    NOT NULL,
  path     TEXT    NOT NULL,
  visitors INTEGER NOT NULL DEFAULT 0,
  views    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, path)
) WITHOUT ROWID;

CREATE TABLE referrers (
  day      TEXT    NOT NULL,
  host     TEXT    NOT NULL,
  visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, host)
) WITHOUT ROWID;

CREATE TABLE countries (
  day      TEXT    NOT NULL,
  country  TEXT    NOT NULL,
  visitors INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, country)
) WITHOUT ROWID;
