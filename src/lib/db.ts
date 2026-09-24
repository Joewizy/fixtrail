import Database from "better-sqlite3";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Memory, Message, Project } from "./types";
const path = process.env.FIXTRAIL_DATABASE_PATH || "./data/fixtrail.db";
mkdirSync(dirname(path), { recursive: true });
const globalDb = globalThis as unknown as { fixtrailDb?: Database.Database };
export const db = globalDb.fixtrailDb || new Database(path);
globalDb.fixtrailDb = db;
db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");
db.exec(`
CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS projects(id TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS memories(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS messages(id TEXT PRIMARY KEY, project_id TEXT NOT NULL REFERENCES projects(id), data TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS links(code TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES users(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS telegram(chat_id TEXT PRIMARY KEY, user_id TEXT NOT NULL UNIQUE REFERENCES users(id), project_id TEXT, session_id TEXT);
CREATE TABLE IF NOT EXISTS updates(id INTEGER PRIMARY KEY, status TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS limits(key TEXT PRIMARY KEY, started INTEGER NOT NULL, count INTEGER NOT NULL);
`);
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function createSession() {
  const user = id();
  const token = randomBytes(32).toString("hex");
  db.transaction(() => {
    db.prepare("INSERT INTO users VALUES (?,?)").run(user, now());
    db.prepare("INSERT INTO sessions VALUES (?,?,?)").run(
      hash(token),
      user,
      Date.now() + 30 * 86400000,
    );
    createProject(user, "My first project", "Sui · Move");
  })();
  return { user, token };
}
export function sessionUser(token: string) {
  return (
    db
      .prepare("SELECT user_id FROM sessions WHERE token=? AND expires>?")
      .get(hash(token), Date.now()) as { user_id: string } | undefined
  )?.user_id;
}
export function createProject(
  user: string,
  name: string,
  stack: string,
): Project {
  const p = { id: id(), name, stack, createdAt: now() };
  db.prepare("INSERT INTO projects VALUES (?,?,?)").run(
    p.id,
    user,
    JSON.stringify(p),
  );
  return p;
}
export function projects(user: string): Project[] {
  return (
    db
      .prepare("SELECT data FROM projects WHERE user_id=? ORDER BY rowid")
      .all(user) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function ownedProject(user: string, project: string): Project {
  const row = db
    .prepare("SELECT data FROM projects WHERE id=? AND user_id=?")
    .get(project, user) as { data: string } | undefined;
  if (!row) throw new Error("Project not found");
  return JSON.parse(row.data);
}
export function memories(project: string): Memory[] {
  return (
    db
      .prepare("SELECT data FROM memories WHERE project_id=? ORDER BY rowid")
      .all(project) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function messages(project: string): Message[] {
  return (
    db
      .prepare("SELECT data FROM messages WHERE project_id=? ORDER BY rowid")
      .all(project) as { data: string }[]
  ).map((r) => JSON.parse(r.data));
}
export function deleteConversation(
  user: string,
  project: string,
  session: string,
) {
  ownedProject(user, project);
  db.prepare(
    "DELETE FROM messages WHERE project_id=? AND json_extract(data, '$.sessionId')=?",
  ).run(project, session);
}
export function clearProjectMemories(user: string, project: string) {
  ownedProject(user, project);
  db.prepare("DELETE FROM memories WHERE project_id=?").run(project);
}
export function putMemory(m: Memory) {
  const existing = db
    .prepare("SELECT data FROM memories WHERE id=?")
    .get(m.id) as { data: string } | undefined;
  if (existing && JSON.parse(existing.data).outdated) m.outdated = true;
  db.prepare(
    "INSERT INTO memories VALUES (?,?,?) ON CONFLICT(id) DO UPDATE SET data=excluded.data",
  ).run(m.id, m.projectId, JSON.stringify(m));
}
export function putMessage(m: Message) {
  db.prepare("INSERT INTO messages VALUES (?,?,?)").run(
    m.id,
    m.projectId,
    JSON.stringify(m),
  );
}
export function rateLimit(key: string, max = 20) {
  const t = Date.now();
  const row = db
    .prepare("SELECT started,count FROM limits WHERE key=?")
    .get(key) as { started: number; count: number } | undefined;
  if (!row || t - row.started > 60000) {
    db.prepare("INSERT OR REPLACE INTO limits VALUES (?,?,1)").run(key, t);
    return;
  }
  if (row.count >= max)
    throw new Error("Too many requests. Please wait a minute.");
  db.prepare("UPDATE limits SET count=count+1 WHERE key=?").run(key);
}
