-- Osprey DB 스키마 — Supabase SQL Editor에서 실행하세요

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  email       TEXT UNIQUE NOT NULL,
  password    TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id          TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token       TEXT UNIQUE NOT NULL,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS verification_codes (
  id          TEXT PRIMARY KEY,
  email       TEXT NOT NULL,
  code        TEXT NOT NULL,
  used        INTEGER NOT NULL DEFAULT 0,
  expires_at  TEXT NOT NULL,
  created_at  TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);

CREATE TABLE IF NOT EXISTS fund_transactions (
  id               TEXT PRIMARY KEY,
  user_id          TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type             TEXT NOT NULL CHECK(type IN ('deposit','withdraw')),
  amount           NUMERIC NOT NULL,
  status           TEXT NOT NULL DEFAULT 'pending'
                     CHECK(status IN ('pending','processing','done','rejected')),
  sender_name      TEXT,
  bank             TEXT,
  account_number   TEXT,
  account_holder   TEXT,
  requested_at     TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  completed_at     TEXT
);

CREATE TABLE IF NOT EXISTS notification_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  trade      INTEGER NOT NULL DEFAULT 1,
  big_profit INTEGER NOT NULL DEFAULT 1,
  big_loss   INTEGER NOT NULL DEFAULT 1,
  weekly     INTEGER NOT NULL DEFAULT 1,
  deposit    INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS agent_settings (
  user_id    TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  status     TEXT NOT NULL DEFAULT 'running'
               CHECK(status IN ('running','paused','waiting')),
  risk_level TEXT NOT NULL DEFAULT 'medium'
               CHECK(risk_level IN ('low','medium','high'))
);

CREATE TABLE IF NOT EXISTS chart_snapshots (
  id       TEXT PRIMARY KEY,
  user_id  TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  date     TEXT NOT NULL,
  value    NUMERIC NOT NULL,
  UNIQUE(user_id, date)
);

CREATE TABLE IF NOT EXISTS agent_decisions (
  id           TEXT PRIMARY KEY,
  contract     TEXT NOT NULL,
  direction    TEXT NOT NULL,
  entry_price  NUMERIC NOT NULL,
  reason       TEXT NOT NULL,
  plan         TEXT NOT NULL,
  signals      TEXT,
  created_at   TEXT NOT NULL DEFAULT to_char(NOW(), 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
);
