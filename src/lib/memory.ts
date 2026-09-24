import { MemWal } from "@mysten-incubation/memwal";
import { memories, putMemory } from "./db";
import type { Memory } from "./types";
export function configured() {
  return Boolean(
    process.env.GEMINI_API_KEY &&
    process.env.MEMWAL_PRIVATE_KEY &&
    process.env.MEMWAL_ACCOUNT_ID,
  );
}
function client(user: string, project: string) {
  if (!configured())
    throw new Error(
      "Gemini and Walrus credentials are required. See .env.example.",
    );
  return MemWal.create({
    key: process.env.MEMWAL_PRIVATE_KEY!,
    accountId: process.env.MEMWAL_ACCOUNT_ID!,
    serverUrl: process.env.MEMWAL_SERVER_URL || undefined,
    namespace: `fixtrail-${user}-${project}`,
  });
}
export function filterRecalled(all: Memory[], blobIds: string[]) {
  return all.filter(
    (m) =>
      !m.outdated &&
      m.sync === "saved" &&
      Boolean(m.blobId && blobIds.includes(m.blobId)),
  );
}
export async function recall(user: string, project: string, query: string) {
  const all = memories(project);
  const c = client(user, project);
  try {
    const result = await c.recall({ query, limit: 20, maxTokens: 2500 });
    // Only locally known, active records in this authenticated project can enter context.
    return filterRecalled(
      all,
      result.results.map((m) => m.blob_id),
    ).slice(-8);
  } finally {
    c.destroy();
  }
}
export async function persist(user: string, m: Memory) {
  m.sync = "pending";
  putMemory(m);
  const c = client(user, m.projectId);
  try {
    if (!m.jobId) {
      const accepted = await c.remember(
        JSON.stringify({
          id: m.id,
          kind: m.kind,
          text: m.text,
          createdAt: m.createdAt,
        }),
        undefined,
        { idempotencyKey: m.id },
      );
      m.jobId = accepted.job_id;
      putMemory(m);
    }
    const result = await c.waitForRememberJob(m.jobId, {
      timeoutMs: 20000,
      pollIntervalMs: 1000,
    });
    m.blobId = result.blob_id;
    m.sync = "saved";
    putMemory(m);
  } catch {
    m.sync = "error";
    putMemory(m);
  } finally {
    c.destroy();
  }
  return m;
}
