import { after, before, test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { query, closeDatabase } from "../src/lib/postgres";
process.env.GEMINI_API_KEY = "test-key";
process.env.MEMWAL_PRIVATE_KEY = "test-delegate";
process.env.MEMWAL_ACCOUNT_ID = "test-account";
const blobs = new Map<string, string[]>();
let providerCalls = 0;
let geminiFailures = 0;
let walrusTimeout = false;
let walrusCompleted = true;
let remembers = 0;
const geminiRequests: string[] = [];
let store: typeof import("../src/lib/db");
let chatModule: typeof import("../src/lib/chat");
let memoryModule: typeof import("../src/lib/memory");
before(async () => {
  const migration = readFileSync(
    new URL("../supabase/migrations/202609240001_initial.sql", import.meta.url),
    "utf8",
  );
  await query(migration);
  await query(migration); // The initial migration is safe to reapply.

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
      remembers++;
      const blob = options.idempotencyKey;
      blobs.set(config.namespace, [
        ...(blobs.get(config.namespace) || []),
        blob,
      ]);
      return { job_id: blob };
    },
    getRememberStatus: async (job: string) =>
      walrusCompleted
        ? { status: "done", blob_id: job }
        : { status: "running" },
    waitForRememberJob: async (job: string) => {
      if (walrusTimeout)
        throw Object.assign(new Error("Receipt wait timed out"), {
          status: 504,
        });
      return { blob_id: job };
    },
    destroy() {},
  }));
  mock.method(globalThis, "fetch", async (url: string | URL | Request) => {
    assert.match(
      String(url instanceof Request ? url.url : url),
      /^https:\/\/generativelanguage.googleapis.com\//,
    );
    geminiRequests.push(String(url instanceof Request ? url.url : url));
    if (geminiFailures > 0) {
      geminiFailures--;
      return new Response(
        JSON.stringify({
          error: {
            code: 504,
            message: "Deadline expired before operation could complete.",
            status: "DEADLINE_EXCEEDED",
          },
        }),
        { status: 504, headers: { "Content-Type": "application/json" } },
      );
    }
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
after(async () => {
  mock.restoreAll();
  await closeDatabase();
});
test("sessions are opaque, hashed at rest, and isolate project access", async () => {
  const a = await store.createSession();
  const b = await store.createSession();
  assert.equal(await store.sessionUser(a.token), a.user);
  assert.equal(await store.sessionUser("forged"), undefined);
  assert.equal(
    (
      await query("SELECT token FROM fixtrail.sessions WHERE token=$1", [
        a.token,
      ])
    ).rowCount,
    0,
  );
  await assert.rejects(
    async () =>
      store.ownedProject(b.user, (await store.projects(a.user))[0].id),
    /not found/,
  );
});
test("live recall rejects foreign blobs, outdated records, and unconfirmed writes", async () => {
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
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
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
  const count = (await store.memories(projectId)).length;
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
  assert.equal((await store.memories(projectId)).length, count);
});
test("outdated memory is excluded from later conversations", async () => {
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
  await store.putMemory({
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
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
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
    assert.equal((await store.messages(projectId)).length, 0);
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
test("a late write receipt cannot reactivate an outdated memory", async () => {
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
  const pending = {
    id: store.id(),
    projectId,
    kind: "environment" as const,
    text: "Old setup",
    createdAt: store.now(),
    outdated: false,
    sync: "pending" as const,
  };
  await store.putMemory(pending);
  await store.putMemory({ ...pending, outdated: true });
  await store.putMemory({ ...pending, sync: "saved", blobId: "late-receipt" });
  assert.equal((await store.memories(projectId))[0].outdated, true);
});
test("conversation and project memory clearing are owner-scoped", async () => {
  const owner = await store.createSession();
  const stranger = await store.createSession();
  const projectId = (await store.projects(owner.user))[0].id;
  const sessionId = store.id();
  await store.putMessage({
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
  await assert.rejects(
    () => store.deleteConversation(stranger.user, projectId, sessionId),
    /not found/,
  );
  assert.equal((await store.messages(projectId)).length, 1);
  await store.deleteConversation(owner.user, projectId, sessionId);
  assert.equal((await store.messages(projectId)).length, 0);
  await store.putMemory({
    id: store.id(),
    projectId,
    kind: "environment",
    text: "private",
    createdAt: store.now(),
    outdated: false,
    sync: "pending",
  });
  await store.clearProjectMemories(owner.user, projectId);
  assert.equal((await store.memories(projectId)).length, 0);
});

test("parallel rate limits admit exactly the allowed number of requests", async () => {
  const key = store.id();
  const outcomes = await Promise.allSettled(
    Array.from({ length: 12 }, () => store.rateLimit(key, 3)),
  );
  assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 3);
  assert.equal(outcomes.filter((r) => r.status === "rejected").length, 9);
  await query(
    "UPDATE fixtrail.limits SET started=clock_timestamp()-interval '61 seconds' WHERE key=$1",
    [key],
  );
  await store.rateLimit(key, 3);
  assert.equal(
    (await query("SELECT count FROM fixtrail.limits WHERE key=$1", [key]))
      .rows[0].count,
    1,
  );
});

test("project leases coordinate independent connections and reject stale releases", async () => {
  const { user } = await store.createSession();
  const project = (await store.projects(user))[0].id;
  const claims = await Promise.allSettled(
    Array.from({ length: 6 }, () => store.acquireProjectLock(user, project)),
  );
  const accepted = claims.filter((r) => r.status === "fulfilled");
  assert.equal(accepted.length, 1);
  const first = (accepted[0] as PromiseFulfilledResult<string>).value;
  await query(
    "UPDATE fixtrail.project_locks SET expires=clock_timestamp()-interval '1 second' WHERE project_id=$1",
    [project],
  );
  const second = await store.acquireProjectLock(user, project);
  await store.releaseProjectLock(project, first);
  await assert.rejects(
    store.acquireProjectLock(user, project),
    /already in progress/,
  );
  await store.releaseProjectLock(project, second);
  await assert.rejects(
    store.withProjectLock(user, project, async () => {
      throw new Error("provider failed");
    }),
    /provider failed/,
  );
  await store.withProjectLock(user, project, async () => true);
});

test("Telegram updates and account links are consumed once under concurrency", async () => {
  const claims = await Promise.all(
    Array.from({ length: 6 }, () => store.claimTelegramUpdate(12345)),
  );
  assert.equal(claims.filter(Boolean).length, 1);
  const { user } = await store.createSession();
  const code = await store.createTelegramLink(user);
  const links = await Promise.all([
    store.consumeTelegramLink(code, "101"),
    store.consumeTelegramLink(code, "102"),
  ]);
  assert.equal(links.filter(Boolean).length, 1);
  const stranger = await store.createSession();
  const otherCode = await store.createTelegramLink(stranger.user);
  const winner = links[0] ? "101" : "102";
  assert.equal(await store.consumeTelegramLink(otherCode, winner), false);
  assert.equal((await store.telegramLink(winner))?.user_id, user);
});

test("private schema and RLS prevent browser roles reading session data", async () => {
  await query("CREATE ROLE fixtrail_test_browser");
  const result = await query(
    "SELECT has_schema_privilege('fixtrail_test_browser','fixtrail','USAGE') AS allowed",
  );
  assert.equal(result.rows[0].allowed, false);
  const tables = await query(
    "SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='fixtrail' AND c.relkind='r'",
  );
  assert.ok(tables.rows.length >= 10);
  assert.ok(tables.rows.every((r) => r.relrowsecurity));
});

test("message pairs roll back together if either insert fails", async () => {
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
  const message = {
    id: store.id(),
    projectId,
    sessionId: store.id(),
    role: "user" as const,
    text: "hello",
    createdAt: store.now(),
    source: "web" as const,
    memories: [],
    memoryEnabled: true,
    model: "test",
  };
  await assert.rejects(store.putMessages([message, message]));
  assert.deepEqual(await store.messages(projectId), []);
});

test("API workspace, project writes, and access restoration use Postgres", async () => {
  const { NextRequest } = await import("next/server");
  const { GET, POST } = await import("../src/app/api/[...path]/route");
  const origin = "http://localhost:3000";
  process.env.APP_URL = origin;
  const context = (path: string) => ({
    params: Promise.resolve({ path: path.split("/") }),
  });
  const workspace = await GET(
    new NextRequest(`${origin}/api/workspace`),
    context("workspace"),
  );
  assert.equal(workspace.status, 200);
  const token = workspace.cookies.get("fixtrail_session")!.value;
  const initial = await workspace.json();
  assert.equal(initial.projects.length, 1);
  assert.ok(Array.isArray(initial.memories));
  const post = (path: string, body: unknown, requestOrigin = origin) =>
    POST(
      new NextRequest(`${origin}/api/${path}`, {
        method: "POST",
        headers: {
          origin: requestOrigin,
          "content-type": "application/json",
          cookie: `fixtrail_session=${token}`,
        },
        body: JSON.stringify(body),
      }),
      context(path),
    );
  const created = await post("projects", {
    name: "API test",
    stack: "TypeScript",
  });
  assert.equal(created.status, 200);
  assert.equal((await created.json()).name, "API test");
  assert.equal(
    (
      await post(
        "projects",
        { name: "blocked", stack: "" },
        "https://foreign.example",
      )
    ).status,
    403,
  );
  const access = await post("access", {});
  const { key } = await access.json();
  assert.equal(key.length, 64);
  const restored = await POST(
    new NextRequest(`${origin}/api/restore`, {
      method: "POST",
      headers: { origin, "content-type": "application/json" },
      body: JSON.stringify({ token: key }),
    }),
    context("restore"),
  );
  assert.equal(restored.status, 200);
  assert.equal((await restored.json()).projects.length, 2);
});

test("Gemini 504 is retried on the same model before falling back", async () => {
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
  const start = geminiRequests.length;
  geminiFailures = 1;
  try {
    const result = await chatModule.chat(user, {
      projectId,
      sessionId: store.id(),
      text: "Help with a compiler error",
      memory: false,
      source: "web",
    });
    assert.equal(geminiRequests.length - start, 2);
    assert.equal(geminiRequests[start], geminiRequests[start + 1]);
    assert.ok(result.answer.text);
  } finally {
    geminiFailures = 0;
  }
});

test("persistent Gemini timeouts have bounded retries and release the project lock", async () => {
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
  const start = geminiRequests.length;
  geminiFailures = 20;
  try {
    await assert.rejects(
      chatModule.chat(user, {
        projectId,
        sessionId: store.id(),
        text: "Help",
        memory: false,
        source: "web",
      }),
      /Gemini request failed/,
    );
    assert.equal(geminiRequests.length - start, 6);
    assert.deepEqual(await store.messages(projectId), []);
    await store.withProjectLock(user, projectId, async () => true);
  } finally {
    geminiFailures = 0;
  }
});

test("late Walrus receipts reconcile without resubmitting and become recallable", async () => {
  const { user } = await store.createSession();
  const projectId = (await store.projects(user))[0].id;
  const m = {
    id: store.id(),
    projectId,
    kind: "resolved" as const,
    text: "Return a u64 literal",
    createdAt: store.now(),
    outdated: false,
    sync: "pending" as const,
  };
  walrusTimeout = true;
  walrusCompleted = false;
  const before = remembers;
  try {
    const pending = await memoryModule.persist(user, m);
    assert.equal(pending.sync, "pending");
    assert.ok(pending.jobId);
    assert.equal(
      (await memoryModule.refreshReceipts(user, projectId))[0].sync,
      "pending",
    );
    // Also recover records marked error by the previous version.
    pending.sync = "error";
    await store.putMemory(pending);
    walrusCompleted = true;
    const refreshed = await store.withProjectLock(user, projectId, () =>
      memoryModule.refreshReceipts(user, projectId),
    );
    assert.equal(refreshed[0].sync, "saved");
    assert.equal(refreshed[0].blobId, pending.jobId);
    assert.equal(remembers, before + 1);
    assert.equal(
      (await memoryModule.recall(user, projectId, "fix"))[0].id,
      m.id,
    );
  } finally {
    walrusTimeout = false;
    walrusCompleted = true;
  }
});
