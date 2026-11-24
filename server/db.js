import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import pg from 'pg';

export async function openDatabase({ url = process.env.DATABASE_URL, file = process.env.SQLITE_PATH || 'data/quizhub.db', postgres = Boolean(process.env.PGHOST) } = {}) {
  let db;
  if (url || postgres) {
    const pool = new pg.Pool({ ...(url ? { connectionString: url } : {}), max: 10 });
    db = { query: async (sql, args = []) => (await pool.query(sql, args)).rows, close: () => pool.end() };
  } else {
    if (file !== ':memory:') mkdirSync(dirname(file), { recursive: true });
    const sqlite = new DatabaseSync(file);
    sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');
    db = { query: async (sql, args = []) => {
      const ordered = [];
      const statement = sqlite.prepare(sql.replace(/\$(\d+)/g, (_, n) => { ordered.push(args[Number(n) - 1]); return '?'; }));
      return statement.all(...ordered);
    }, close: async () => sqlite.close() };
  }
  for (const sql of [
    `CREATE TABLE IF NOT EXISTS users (id TEXT PRIMARY KEY, name TEXT NOT NULL, email TEXT UNIQUE NOT NULL, password TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS semesters (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS subjects (id TEXT PRIMARY KEY, semester_id TEXT NOT NULL REFERENCES semesters(id) ON DELETE CASCADE, name TEXT NOT NULL, created_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS lessons (id TEXT PRIMARY KEY, subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE, name TEXT NOT NULL, description TEXT NOT NULL, questions TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
    `CREATE TABLE IF NOT EXISTS attempts (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, lesson_id TEXT NOT NULL REFERENCES lessons(id) ON DELETE CASCADE, lesson_name TEXT NOT NULL, questions TEXT NOT NULL, answers TEXT NOT NULL, started_at TEXT NOT NULL, finished_at TEXT, version INTEGER NOT NULL DEFAULT 0)`,
    `CREATE INDEX IF NOT EXISTS semesters_user ON semesters(user_id)`,
    `CREATE INDEX IF NOT EXISTS subjects_semester ON subjects(semester_id)`,
    `CREATE INDEX IF NOT EXISTS lessons_subject ON lessons(subject_id)`,
    `CREATE INDEX IF NOT EXISTS attempts_user ON attempts(user_id)`,
    `CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at)`
    ,`CREATE TABLE IF NOT EXISTS exams (id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE, subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE, subject_name TEXT NOT NULL, questions TEXT NOT NULL, answers TEXT NOT NULL, started_at TEXT NOT NULL, deadline TEXT NOT NULL, finished_at TEXT, version INTEGER NOT NULL DEFAULT 0)`
    ,`CREATE INDEX IF NOT EXISTS exams_user ON exams(user_id)`
  ]) await db.query(sql);
  try {
    await db.query(`ALTER TABLE users ADD COLUMN role TEXT NOT NULL DEFAULT 'user'`);
  } catch {}
  try {
    const admins = await db.query(`SELECT id FROM users WHERE role = 'admin' LIMIT 1`);
    if (admins.length === 0) {
      const [first] = await db.query(`SELECT id FROM users ORDER BY created_at ASC LIMIT 1`);
      if (first) await db.query(`UPDATE users SET role = 'admin' WHERE id = $1`, [first.id]);
    }
  } catch {}
  return db;
}
