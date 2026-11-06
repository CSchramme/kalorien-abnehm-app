import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);

/**
 * SQLite-Treiber wählen:
 *  1. better-sqlite3 (per "npm install", läuft ab Node 20 – z. B. bei Plesk-Hostern)
 *  2. node:sqlite (in Node ≥ 22.13 eingebaut, ganz ohne Installation)
 * Mit DB_DRIVER=better-sqlite3 bzw. DB_DRIVER=node:sqlite lässt sich einer erzwingen.
 * Beide haben dieselbe synchrone API (prepare/get/all/run/exec), der restliche Code merkt keinen Unterschied.
 */
function loadDriver(wanted = process.env.DB_DRIVER) {
  const drivers = {
    'better-sqlite3': () => {
      const Database = require('better-sqlite3');
      return (file) => new Database(file);
    },
    'node:sqlite': () => {
      const { DatabaseSync } = require('node:sqlite');
      return (file) => new DatabaseSync(file);
    },
  };
  const order = wanted ? [wanted] : ['better-sqlite3', 'node:sqlite'];
  const errors = [];
  for (const name of order) {
    if (!drivers[name]) throw new Error(`Unbekannter DB_DRIVER "${name}".`);
    try {
      return { name, open: drivers[name]() };
    } catch (err) {
      errors.push(`${name}: ${err.message.split('\n')[0]}`);
    }
  }
  throw new Error(
    `Keine SQLite-Bibliothek verfügbar (Node ${process.version}).\n` +
      'Lösung: im App-Ordner "npm install" ausführen (installiert better-sqlite3, ab Node 20) ' +
      'oder Node.js ≥ 22.13 verwenden.\n' + errors.join('\n'),
  );
}

let driver;
export function dbDriverName() {
  driver ??= loadDriver();
  return driver.name;
}

/** Standard: <App-Verzeichnis>/data/leichter.db – unabhängig vom aktuellen Arbeitsverzeichnis */
export const DEFAULT_DB_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', 'data', 'leichter.db');

// Jede Migration wird genau einmal ausgeführt (PRAGMA user_version zählt mit).
const MIGRATIONS = [
  /* 1 */ `
  CREATE TABLE users (
    id            INTEGER PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL DEFAULT '',
    created_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE sessions (
    token_hash  TEXT PRIMARY KEY,
    user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at  INTEGER NOT NULL,
    expires_at  INTEGER NOT NULL,
    user_agent  TEXT
  );
  CREATE INDEX sessions_user ON sessions(user_id);

  CREATE TABLE profiles (
    user_id       INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
    sex           TEXT,
    birth_year    INTEGER,
    height_cm     REAL,
    start_weight  REAL,
    goal_weight   REAL,
    activity      TEXT,
    rate          REAL NOT NULL DEFAULT 0.5,
    kcal_override INTEGER,
    updated_at    TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE TABLE foods (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name         TEXT NOT NULL,
    serving_qty  REAL NOT NULL DEFAULT 1,
    serving_unit TEXT NOT NULL DEFAULT 'Portion',
    kcal REAL NOT NULL DEFAULT 0, protein REAL NOT NULL DEFAULT 0, carbs REAL NOT NULL DEFAULT 0,
    sugar REAL NOT NULL DEFAULT 0, fat REAL NOT NULL DEFAULT 0, sat_fat REAL NOT NULL DEFAULT 0,
    fiber REAL NOT NULL DEFAULT 0, sodium REAL NOT NULL DEFAULT 0,
    favorite     INTEGER NOT NULL DEFAULT 0,
    use_count    INTEGER NOT NULL DEFAULT 0,
    last_used_at TEXT,
    created_at   TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX foods_user ON foods(user_id, name COLLATE NOCASE);

  -- Nährwerte werden pro Portion als Momentaufnahme gespeichert,
  -- damit spätere Änderungen am Lebensmittel die Historie nicht verfälschen.
  CREATE TABLE entries (
    id           INTEGER PRIMARY KEY,
    user_id      INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date         TEXT NOT NULL,
    meal         TEXT NOT NULL,
    food_id      INTEGER REFERENCES foods(id) ON DELETE SET NULL,
    name         TEXT NOT NULL,
    serving_qty  REAL NOT NULL DEFAULT 1,
    serving_unit TEXT NOT NULL DEFAULT 'Portion',
    qty          REAL NOT NULL DEFAULT 1,
    kcal REAL NOT NULL DEFAULT 0, protein REAL NOT NULL DEFAULT 0, carbs REAL NOT NULL DEFAULT 0,
    sugar REAL NOT NULL DEFAULT 0, fat REAL NOT NULL DEFAULT 0, sat_fat REAL NOT NULL DEFAULT 0,
    fiber REAL NOT NULL DEFAULT 0, sodium REAL NOT NULL DEFAULT 0,
    created_at   TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX entries_user_date ON entries(user_id, date);

  CREATE TABLE exercises (
    id         INTEGER PRIMARY KEY,
    user_id    INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date       TEXT NOT NULL,
    name       TEXT NOT NULL,
    minutes    REAL,
    kcal       REAL NOT NULL,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );
  CREATE INDEX exercises_user_date ON exercises(user_id, date);

  CREATE TABLE weights (
    id      INTEGER PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    date    TEXT NOT NULL,
    weight  REAL NOT NULL,
    UNIQUE (user_id, date)
  );
  `,
];

export function openDb(file) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  driver ??= loadDriver();
  const db = driver.open(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  const { user_version: version } = db.prepare('PRAGMA user_version').get();
  for (let v = version; v < MIGRATIONS.length; v++) {
    transaction(db, () => {
      db.exec(MIGRATIONS[v]);
      db.exec(`PRAGMA user_version = ${v + 1}`);
    });
  }
  return db;
}

export function transaction(db, fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
