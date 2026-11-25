// SQLite via Node's built-in node:sqlite (no native dependency).
import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { config } from './config.js';

mkdirSync(dirname(config.dbPath), { recursive: true });
export const db = new DatabaseSync(config.dbPath);
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;');

db.exec(`
CREATE TABLE IF NOT EXISTS generations (
  id            TEXT PRIMARY KEY,
  status        TEXT NOT NULL DEFAULT 'locked',   -- locked | paid | refunded | failed
  source_url    TEXT,
  source_kind   TEXT,                             -- shopify | html | manual | batch
  source_json   TEXT NOT NULL,                    -- normalized product data sent to the model
  result_json   TEXT,                             -- full model output (never sent before payment)
  ip            TEXT,
  email         TEXT,
  order_id      TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS orders (
  id            TEXT PRIMARY KEY,
  plan          TEXT NOT NULL,                    -- single | pilot | catalog
  amount_agorot INTEGER NOT NULL,
  quota         INTEGER NOT NULL,                 -- products allowed
  email         TEXT NOT NULL,
  generation_id TEXT,                             -- single plan only
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | paid | refunded
  access_token  TEXT NOT NULL UNIQUE,             -- permanent secret link
  provider      TEXT NOT NULL,
  provider_ref  TEXT,                             -- provider's page / request id
  batch_status  TEXT,                             -- null | awaiting_upload | processing | done | failed
  batch_note    TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now')),
  paid_at       TEXT
);

CREATE TABLE IF NOT EXISTS payments (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id        TEXT NOT NULL REFERENCES orders(id),
  provider        TEXT NOT NULL,
  provider_txn_id TEXT NOT NULL,
  amount_agorot   INTEGER NOT NULL,
  raw             TEXT,
  status          TEXT NOT NULL DEFAULT 'completed', -- completed | refunded
  created_at      TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (provider, provider_txn_id)                 -- blocks double-processing
);

CREATE TABLE IF NOT EXISTS batch_items (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id      TEXT NOT NULL REFERENCES orders(id),
  row_index     INTEGER NOT NULL,
  handle        TEXT,
  source_json   TEXT NOT NULL,
  result_json   TEXT,
  status        TEXT NOT NULL DEFAULT 'queued',   -- queued | done | failed
  error         TEXT
);

CREATE TABLE IF NOT EXISTS preview_log (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  ip         TEXT NOT NULL,
  email      TEXT,
  day        TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  name       TEXT NOT NULL,   -- page_view | preview_created | checkout_click | payment_completed
  ref        TEXT,
  meta       TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS idx_preview_ip ON preview_log(ip, day);
CREATE INDEX IF NOT EXISTS idx_preview_email ON preview_log(email, day);
CREATE INDEX IF NOT EXISTS idx_batch_order ON batch_items(order_id, status);
CREATE INDEX IF NOT EXISTS idx_events_name ON events(name, created_at);
`);

export function tx(fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export function track(name, ref = null, meta = null) {
  db.prepare('INSERT INTO events (name, ref, meta) VALUES (?, ?, ?)')
    .run(name, ref, meta ? JSON.stringify(meta) : null);
}
