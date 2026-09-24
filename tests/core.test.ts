import { after, before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
const folder = mkdtempSync(join(tmpdir(), "fixtrail-tests-"));
process.env.FIXTRAIL_DATABASE_PATH = join(folder, "test.db");
process.env.GEMINI_API_KEY = "test-key";
process.env.MEMWAL_PRIVATE_KEY = "test-delegate";
process.env.MEMWAL_ACCOUNT_ID = "test-account";
const blobs = new Map<string, string[]>();
let providerCalls = 0;
let store: typeof import("../src/lib/db");
let chatModule: typeof import("../src/lib/chat");
let memoryModule: typeof import("../src/lib/memory");
before(async () => {
  const { MemWal } = await import("@mysten-incubation/memwal");
  mock.method(MemWal, "create", (config: { namespace: string }) => ({
    recall: async () => {
      providerCalls++;
      return {
        results: (blobs.get(config.namespace) || []).map((blob_id) => ({
          blob_id,
        })),
      };
    },
    remember: async (
      _text: string,
      _options: unknown,
      options: { idempotencyKey: string },
    ) => {
      providerCalls++;
      const blob = options.idempotencyKey;
      blobs.set(config.namespace, [
        ...(blobs.get(config.namespace) || []),
        blob,
      ]);
      return { job_id: blob };
    },
    waitForRememberJob: async (job: string) => ({ blob_id: job }),
    destroy() {},
  }));
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.match(
      String(url instanceof Request ? url.url : url),
      /^https:\/\/generativelanguage.googleapis.com\//,
    );
    return new Response(
      JSON.stringify({
        candidates: [
          {
            content: {
              parts: [
                {
                  text: JSON.stringify({
                    answer:
                      "Check the recorded attempts and avoid repeating failed fixes.",
                    facts: [
                      {
                        text: "Deleting the build directory failed to fix dependency resolution.",
                        kind: "failed",
                      },
                    ],
                  }),
                },
              ],
            },
          },
        ],
      }),
      { headers: { "Content-Type": "application/json" } },
    );
  });
  store = await import("../src/lib/db");
  chatModule = await import("../src/lib/chat");
  memoryModule = await import("../src/lib/memory");
});
after(() => {
  mock.restoreAll();
  store.db.close();
  rmSync(folder, { recursive: true, force: true });
});
test("sessions are opaque, hashed at rest, and isolate project access", () => {
  const a = store.createSession();
  const b = store.createSession();
  assert.equal(store.sessionUser(a.token), a.user);
  assert.equal(store.sessionUser("forged"), undefined);
  assert.equal(
    store.db.prepare("SELECT token FROM sessions WHERE token=?").get(a.token),
    undefined,
  );
  assert.throws(
    () => store.ownedProject(b.user, store.projects(a.user)[0].id),
    /not found/,
  );
});
test("live recall rejects foreign blobs, outdated records, and unconfirmed writes", () => {
  const base = {
    id: store.id(),
    projectId: store.id(),
    text: "Failed fix",
    kind: "failed" as const,
    createdAt: store.now(),
    outdated: false,
    sync: "saved" as const,
    blobId: "known",
  };
  const filtered = memoryModule.filterRecalled(
    [
      base,
      { ...base, id: "old", blobId: "old", outdated: true },
      { ...base, id: "pending", blobId: "pending", sync: "pending" },
    ],
    ["known", "old", "pending", "foreign"],
  );
  assert.deepEqual(
    filtered.map((x) => x.id),
    [base.id],
  );
});
test("a new conversation recalls earlier failed fixes; baseline never reads or writes memory", async () => {
  const { user } = store.createSession();
  const projectId = store.projects(user)[0].id;
  const first = await chatModule.chat(user, {
    projectId,
    sessionId: store.id(),
    text: "I tried deleting the build directory but it failed to fix dependency resolution.",
    memory: true,
    source: "web",
  });
  assert.equal(first.saved.length, 1);
  assert.equal(first.saved[0].kind, "failed");
  assert.equal(first.saved[0].sync, "saved");
  assert.ok(first.saved[0].blobId);
  const second = await chatModule.chat(user, {
    projectId,
    sessionId: store.id(),
    text: "The same dependency error is back.",
    memory: true,
    source: "telegram",
  });
  assert.equal(second.recalled.length, 1);
  assert.match(second.answer.text, /avoid repeating/);
  const count = store.memories(projectId).length;
  const callsBeforeBaseline = providerCalls;
  const baseline = await chatModule.chat(user, {
    projectId,
    sessionId: store.id(),
    text: "I tried clearing cache but it failed.",
    memory: false,
    source: "web",
  });
  assert.equal(providerCalls, callsBeforeBaseline);
  assert.equal(baseline.recalled.length, 0);
  assert.equal(baseline.saved.length, 0);
  assert.equal(store.memories(projectId).length, count);
});
test("outdated memory is excluded from later conversations", async () => {
  const { user } = store.createSession();
  const projectId = store.projects(user)[0].id;
  store.putMemory({
    id: store.id(),
    projectId,
    kind: "environment",
    text: "Old toolchain",
    createdAt: store.now(),
    outdated: true,
    sync: "pending",
  });
  assert.deepEqual(await memoryModule.recall(user, projectId, "toolchain"), []);
});
test("missing credentials fail without scripted responses or provider calls", async () => {
  const key = process.env.GEMINI_API_KEY;
  delete process.env.GEMINI_API_KEY;
  const { user } = store.createSession();
  const projectId = store.projects(user)[0].id;
  const calls = providerCalls;
  try {
    await assert.rejects(
      chatModule.chat(user, {
        projectId,
        sessionId: store.id(),
        text: "Help debug this",
        memory: true,
        source: "web",
      }),
      /credentials are required/,
    );
    assert.equal(providerCalls, calls);
    assert.equal(store.messages(projectId).length, 0);
  } finally {
    process.env.GEMINI_API_KEY = key;
  }
});
test("Telegram webhook requires exact nonempty secret", async () => {
  const { verifyTelegram } = await import("../src/lib/telegram");
  process.env.TELEGRAM_WEBHOOK_SECRET = "test-secret";
  assert.equal(verifyTelegram(null), false);
  assert.equal(verifyTelegram("wrong"), false);
  assert.equal(verifyTelegram("test-secret"), true);
});
test("a late write receipt cannot reactivate an outdated memory", () => {
  const { user } = store.createSession();
  const projectId = store.projects(user)[0].id;
  const pending = {
    id: store.id(),
    projectId,
    kind: "environment" as const,
    text: "Old setup",
    createdAt: store.now(),
    outdated: false,
    sync: "pending" as const,
  };
  store.putMemory(pending);
  store.putMemory({ ...pending, outdated: true });
  store.putMemory({ ...pending, sync: "saved", blobId: "late-receipt" });
  assert.equal(store.memories(projectId)[0].outdated, true);
});
test("conversation and project memory clearing are owner-scoped", () => {
  const owner = store.createSession();
  const stranger = store.createSession();
  const projectId = store.projects(owner.user)[0].id;
  const sessionId = store.id();
  store.putMessage({
    id: store.id(),
    projectId,
    sessionId,
    role: "user",
    text: "private",
    createdAt: store.now(),
    source: "web",
    memories: [],
    memoryEnabled: true,
    model: "test",
  });
  assert.throws(
    () => store.deleteConversation(stranger.user, projectId, sessionId),
    /not found/,
  );
  assert.equal(store.messages(projectId).length, 1);
  store.deleteConversation(owner.user, projectId, sessionId);
  assert.equal(store.messages(projectId).length, 0);
  store.putMemory({
    id: store.id(),
    projectId,
    kind: "environment",
    text: "private",
    createdAt: store.now(),
    outdated: false,
    sync: "pending",
  });
  store.clearProjectMemories(owner.user, projectId);
  assert.equal(store.memories(projectId).length, 0);
});
