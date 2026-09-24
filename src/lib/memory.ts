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
// The caller holds the project lock so a late receipt cannot undo a clear/outdate action.
export async function refreshReceipts(user: string, project: string) {
  const all = await memories(project);
  const outstanding = all.filter(
    (m) =>
      m.jobId && !m.outdated && (m.sync === "pending" || m.sync === "error"),
  );
  if (!outstanding.length || !configured()) return all;
  const c = client(user, project);
  try {
    for (const m of outstanding) {
      try {
        const status = await c.getRememberStatus(m.jobId!);
        if (status.status === "done" && status.blob_id) {
          m.blobId = status.blob_id;
          m.sync = "saved";
        } else if (
          status.status === "failed" ||
          status.status === "not_found"
        ) {
          m.sync = "error";
        } else {
          m.sync = "pending";
        }
        await putMemory(m);
      } catch {
        // Keep the last known state when the status service is unavailable.
      }
    }
  } finally {
    c.destroy();
  }
  return all;
}
export async function recall(user: string, project: string, query: string) {
  const all = await refreshReceipts(user, project);
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
  await putMemory(m);
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
      await putMemory(m);
    }
    const result = await c.waitForRememberJob(m.jobId, {
      timeoutMs: 20000,
      pollIntervalMs: 1000,
    });
    if (!result.blob_id) throw new Error("Walrus receipt has no blob ID");
    m.blobId = result.blob_id;
    m.sync = "saved";
    await putMemory(m);
  } catch (error) {
    m.sync =
      m.jobId && (error as { status?: number }).status === 504
        ? "pending"
        : "error";
    await putMemory(m);
  } finally {
    c.destroy();
  }
  return m;
}
