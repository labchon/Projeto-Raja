import path from "node:path";
import fs from "node:fs";
import sqlite3 from "sqlite3";
import { open } from "sqlite";

const dataDir = path.resolve(process.cwd(), "backend", "data");
fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "observach.sqlite");

export async function getDb() {
  const db = await open({
    filename: dbPath,
    driver: sqlite3.Database,
  });

  await db.exec(`
    PRAGMA foreign_keys = ON;

    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK(role IN ('user', 'admin')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS observations (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      photo_path TEXT NOT NULL,
      popular_name TEXT NOT NULL,
      scientific_name TEXT NOT NULL,
      species_group TEXT NOT NULL,
      location TEXT NOT NULL,
      sex TEXT NOT NULL,
      observed_at TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS comments (
      id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      user_name TEXT NOT NULL,
      text TEXT NOT NULL,
      status TEXT NOT NULL CHECK(status IN ('pending', 'approved', 'rejected')),
      created_at TEXT NOT NULL,
      FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );

    CREATE TABLE IF NOT EXISTS votes (
      id TEXT PRIMARY KEY,
      observation_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      value TEXT NOT NULL CHECK(value IN ('coherent', 'incoherent')),
      created_at TEXT NOT NULL,
      UNIQUE(observation_id, user_id),
      FOREIGN KEY (observation_id) REFERENCES observations(id) ON DELETE CASCADE,
      FOREIGN KEY (user_id) REFERENCES users(id)
    );
  `);

  return db;
}
