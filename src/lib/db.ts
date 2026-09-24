import { createHash, randomBytes, randomUUID } from "node:crypto";
import { query, transaction } from "./postgres";
import type { Memory, Message, Project } from "./types";
export const id = () => randomUUID();
export const now = () => new Date().toISOString();
export const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export async function createSession() {
  const user = id();
  const token = randomBytes(32).toString("hex");
  const p: Project = {
    id: id(),
    name: "My first project",
    stack: "",
    createdAt: now(),
  };
  await transaction(async (c) => {
    await c.query("INSERT INTO fixtrail.users(id) VALUES ($1)", [user]);
    await c.query("INSERT INTO fixtrail.sessions VALUES ($1,$2,$3)", [
      hash(token),
      user,
      Date.now() + 30 * 86400000,
    ]);
    await c.query(
      "INSERT INTO fixtrail.projects(id,user_id,data) VALUES ($1,$2,$3)",
      [p.id, user, p],
    );
  });
  return { user, token };
}
export async function sessionUser(token: string) {
  const { rows } = await query<{ user_id: string }>(
    "SELECT user_id FROM fixtrail.sessions WHERE token=$1 AND expires>$2",
    [hash(token), Date.now()],
  );
  return rows[0]?.user_id;
}
export async function createAccessKey(user: string) {
  const key = randomBytes(32).toString("hex");
  await query("INSERT INTO fixtrail.sessions VALUES ($1,$2,$3)", [
    hash(key),
    user,
    Date.now() + 30 * 86400000,
  ]);
  return key;
}
export async function createProject(
  user: string,
  name: string,
  stack: string,
): Promise<Project> {
  const p = { id: id(), name, stack, createdAt: now() };
  await query(
    "INSERT INTO fixtrail.projects(id,user_id,data) VALUES ($1,$2,$3)",
    [p.id, user, p],
  );
  return p;
}
export async function projects(user: string): Promise<Project[]> {
  const { rows } = await query<{ data: Project }>(
    "SELECT data FROM fixtrail.projects WHERE user_id=$1 ORDER BY position",
    [user],
  );
  return rows.map((r) => r.data);
}
export async function ownedProject(
  user: string,
  project: string,
): Promise<Project> {
  const { rows } = await query<{ data: Project }>(
    "SELECT data FROM fixtrail.projects WHERE id=$1 AND user_id=$2",
    [project, user],
  );
  if (!rows[0]) throw new Error("Project not found");
  return rows[0].data;
}
export async function memories(project: string): Promise<Memory[]> {
  const { rows } = await query<{ data: Memory }>(
    "SELECT data FROM fixtrail.memories WHERE project_id=$1 ORDER BY position",
    [project],
  );
  return rows.map((r) => r.data);
}
export async function messages(project: string): Promise<Message[]> {
  const { rows } = await query<{ data: Message }>(
    "SELECT data FROM fixtrail.messages WHERE project_id=$1 ORDER BY position",
    [project],
  );
  return rows.map((r) => r.data);
}
export async function deleteConversation(
  user: string,
  project: string,
  session: string,
) {
  await ownedProject(user, project);
  await query(
    "DELETE FROM fixtrail.messages WHERE project_id=$1 AND data->>'sessionId'=$2",
    [project, session],
  );
}
export async function clearProjectMemories(user: string, project: string) {
  await ownedProject(user, project);
  await query("DELETE FROM fixtrail.memories WHERE project_id=$1", [project]);
}
export async function putMemory(m: Memory) {
  const { rows } = await query<{ data: Memory }>(
    `INSERT INTO fixtrail.memories(id,project_id,data) VALUES ($1,$2,$3)
    ON CONFLICT(id) DO UPDATE SET data = CASE
      WHEN (fixtrail.memories.data->>'outdated')::boolean
      THEN jsonb_set(EXCLUDED.data, '{outdated}', 'true'::jsonb)
      ELSE EXCLUDED.data END
    RETURNING data`,
    [m.id, m.projectId, m],
  );
  Object.assign(m, rows[0].data);
}
export async function putMessage(m: Message) {
  await query(
    "INSERT INTO fixtrail.messages(id,project_id,data) VALUES ($1,$2,$3)",
    [m.id, m.projectId, m],
  );
}
export async function putMessages(items: Message[]) {
  await transaction(async (c) => {
    for (const m of items)
      await c.query(
        "INSERT INTO fixtrail.messages(id,project_id,data) VALUES ($1,$2,$3)",
        [m.id, m.projectId, m],
      );
  });
}
export async function rateLimit(key: string, max = 20) {
  const { rowCount } = await query(
    `INSERT INTO fixtrail.limits AS l (key,started,count) VALUES ($1,clock_timestamp(),1)
    ON CONFLICT(key) DO UPDATE SET
      started = CASE WHEN l.started <= clock_timestamp() - interval '1 minute' THEN clock_timestamp() ELSE l.started END,
      count = CASE WHEN l.started <= clock_timestamp() - interval '1 minute' THEN 1 ELSE l.count+1 END
    WHERE l.started <= clock_timestamp() - interval '1 minute' OR l.count < $2
    RETURNING key`,
    [key, max],
  );
  if (!rowCount) throw new Error("Too many requests. Please wait a minute.");
}
// A lease outlives the route's 300-second execution limit; no connection is held during provider calls.
export async function acquireProjectLock(user: string, project: string) {
  await ownedProject(user, project);
  const token = id();
  const { rowCount } = await query(
    `INSERT INTO fixtrail.project_locks AS l (project_id,token,expires)
    VALUES ($1,$2,clock_timestamp()+interval '360 seconds')
    ON CONFLICT(project_id) DO UPDATE SET token=EXCLUDED.token, expires=EXCLUDED.expires
    WHERE l.expires < clock_timestamp() RETURNING token`,
    [project, token],
  );
  if (!rowCount)
    throw new Error(
      "A response or update is already in progress for this project.",
    );
  return token;
}
export async function releaseProjectLock(project: string, token: string) {
  await query(
    "DELETE FROM fixtrail.project_locks WHERE project_id=$1 AND token=$2",
    [project, token],
  );
}
export async function withProjectLock<T>(
  user: string,
  project: string,
  work: () => Promise<T>,
) {
  const token = await acquireProjectLock(user, project);
  try {
    return await work();
  } finally {
    await releaseProjectLock(project, token);
  }
}
export type TelegramLink = {
  user_id: string;
  project_id: string;
  session_id: string;
};
export async function telegramLink(chatId: string) {
  return (
    await query<TelegramLink>(
      "SELECT user_id,project_id,session_id FROM fixtrail.telegram WHERE chat_id=$1",
      [chatId],
    )
  ).rows[0];
}
export async function telegramLinked(user: string) {
  return Boolean(
    (
      await query("SELECT chat_id FROM fixtrail.telegram WHERE user_id=$1", [
        user,
      ])
    ).rowCount,
  );
}
export async function createTelegramLink(user: string) {
  const code = randomBytes(24).toString("hex");
  await query(
    `INSERT INTO fixtrail.links(code,user_id,expires) VALUES ($1,$2,$3)
    ON CONFLICT(user_id) DO UPDATE SET code=EXCLUDED.code, expires=EXCLUDED.expires`,
    [hash(code), user, Date.now() + 600000],
  );
  return code;
}
export async function consumeTelegramLink(code: string, chatId: string) {
  return transaction(async (c) => {
    // Transaction-scoped advisory locks work with transaction pooling.
    await c.query("SELECT pg_advisory_xact_lock(78129421)");
    const { rows } = await c.query<{ user_id: string }>(
      "SELECT user_id FROM fixtrail.links WHERE code=$1 AND expires>$2 FOR UPDATE",
      [hash(code), Date.now()],
    );
    if (!rows[0]) return false;
    const user = rows[0].user_id;
    const existing = await c.query(
      "SELECT user_id FROM fixtrail.telegram WHERE chat_id=$1",
      [chatId],
    );
    if (existing.rows[0] && existing.rows[0].user_id !== user) return false;
    const ps = await c.query(
      "SELECT id FROM fixtrail.projects WHERE user_id=$1 ORDER BY position LIMIT 1",
      [user],
    );
    await c.query("DELETE FROM fixtrail.telegram WHERE user_id=$1", [user]);
    await c.query("INSERT INTO fixtrail.telegram VALUES ($1,$2,$3,$4)", [
      chatId,
      user,
      ps.rows[0].id,
      id(),
    ]);
    await c.query("DELETE FROM fixtrail.links WHERE code=$1", [hash(code)]);
    return true;
  });
}
export async function updateTelegramSession(
  chatId: string,
  session: string,
  project?: string,
) {
  await query(
    "UPDATE fixtrail.telegram SET session_id=$2,project_id=COALESCE($3,project_id) WHERE chat_id=$1",
    [chatId, session, project ?? null],
  );
}
export async function unlinkTelegram(chatId: string) {
  await query("DELETE FROM fixtrail.telegram WHERE chat_id=$1", [chatId]);
}
export async function claimTelegramUpdate(updateId: number) {
  return Boolean(
    (
      await query(
        "INSERT INTO fixtrail.updates VALUES ($1,'processing') ON CONFLICT DO NOTHING RETURNING id",
        [updateId],
      )
    ).rowCount,
  );
}
export async function finishTelegramUpdate(
  updateId: number,
  status: "done" | "failed",
) {
  await query("UPDATE fixtrail.updates SET status=$2 WHERE id=$1", [
    updateId,
    status,
  ]);
}
