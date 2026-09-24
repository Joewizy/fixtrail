import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { chat, factSchema } from "@/lib/chat";
import { configured, persist, refreshReceipts } from "@/lib/memory";
import {
  telegramLinked,
  createTelegramLink,
  createAccessKey,
  withProjectLock,
  id,
  now,
  createSession,
  sessionUser,
  projects,
  memories,
  messages,
  createProject,
  ownedProject,
  putMemory,
  rateLimit,
  deleteConversation,
  clearProjectMemories,
} from "@/lib/db";
import { telegramUpdate, verifyTelegram } from "@/lib/telegram";
export const runtime = "nodejs";
export const maxDuration = 300;
async function snapshot(user: string) {
  const ps = await projects(user);
  return {
    projects: ps,
    memories: (
      await Promise.all(
        ps.map(async (p) => {
          try {
            return await withProjectLock(user, p.id, () =>
              refreshReceipts(user, p.id),
            );
          } catch {
            return memories(p.id);
          }
        }),
      )
    ).flat(),
    messages: (await Promise.all(ps.map((p) => messages(p.id)))).flat(),
    configured: configured(),
    telegramLinked: await telegramLinked(user),
    telegramUsername: process.env.TELEGRAM_BOT_USERNAME || "",
  };
}
async function handle(
  req: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const path = (await context.params).path.join("/");
  try {
    if (path === "telegram/webhook" && req.method === "POST") {
      if (!verifyTelegram(req.headers.get("x-telegram-bot-api-secret-token")))
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      await telegramUpdate(await req.json());
      return NextResponse.json({ ok: true });
    }
    if (req.method !== "GET") {
      const expected = new URL(
        process.env.APP_URL ||
          `${req.nextUrl.protocol}//${req.headers.get("host")}`,
      ).origin;
      const received = req.headers.get("origin");
      let originAllowed = received === expected;
      // Browsers treat these as different origins even though they point to
      // the same local server. Allow the two loopback names during local
      // development; deployed hosts still require an exact APP_URL match.
      if (!originAllowed && received) {
        const expectedUrl = new URL(expected);
        const receivedUrl = new URL(received);
        const localHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);
        originAllowed =
          localHosts.has(expectedUrl.hostname) &&
          localHosts.has(receivedUrl.hostname) &&
          expectedUrl.port === receivedUrl.port;
      }
      if (!originAllowed)
        return NextResponse.json({ error: "Invalid origin" }, { status: 403 });
    }
    let user = await sessionUser(
      req.cookies.get("fixtrail_session")?.value || "",
    );
    let token: string | undefined;
    if (!user && path === "workspace" && req.method === "GET") {
      const s = await createSession();
      user = s.user;
      token = s.token;
    }
    if (path === "restore" && req.method === "POST") {
      const input = z
        .object({ token: z.string().regex(/^[a-f0-9]{64}$/) })
        .parse(await req.json());
      user = await sessionUser(input.token);
      if (!user)
        return NextResponse.json(
          { error: "Invalid or expired access key" },
          { status: 401 },
        );
      const res = NextResponse.json(await snapshot(user), {
        headers: { "Cache-Control": "no-store" },
      });
      res.cookies.set("fixtrail_session", input.token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 86400,
      });
      return res;
    }
    if (!user)
      return NextResponse.json(
        { error: "Open FixTrail to start a session." },
        { status: 401 },
      );
    let result: unknown;
    if (path === "workspace" && req.method === "GET")
      result = await snapshot(user);
    else if (path === "projects" && req.method === "POST") {
      await rateLimit(`${user}:projects`, 5);
      const input = z
        .object({
          name: z.string().trim().min(1).max(60),
          stack: z.string().trim().max(100),
        })
        .parse(await req.json());
      result = await createProject(user, input.name, input.stack);
    } else if (path === "chat" && req.method === "POST") {
      const input = z
        .object({
          projectId: z.string().uuid(),
          sessionId: z.string().uuid(),
          text: z.string().trim().min(1).max(8000),
          memory: z.boolean(),
        })
        .parse(await req.json());
      result = await chat(user, { ...input, source: "web" });
    } else if (path === "memories" && req.method === "POST") {
      await rateLimit(`${user}:memories`);
      const input = factSchema
        .extend({ projectId: z.string().uuid() })
        .parse(await req.json());
      await ownedProject(user, input.projectId);
      result = await withProjectLock(user, input.projectId, () =>
        persist(user!, {
          id: id(),
          ...input,
          createdAt: now(),
          outdated: false,
          sync: "pending",
        }),
      );
    } else if (path === "memories/update" && req.method === "POST") {
      const input = z
        .object({
          projectId: z.string().uuid(),
          id: z.string().uuid(),
          action: z.enum(["outdate", "retry"]),
        })
        .parse(await req.json());
      result = await withProjectLock(user, input.projectId, async () => {
        const m = (await memories(input.projectId)).find(
          (m) => m.id === input.id,
        );
        if (!m) throw new Error("Memory not found");
        if (input.action === "outdate") {
          m.outdated = true;
          await putMemory(m);
          return m;
        } else {
          if (m.outdated)
            throw new Error("Outdated memories cannot be retried");
          return persist(user!, m);
        }
      });
    } else if (path === "conversation/clear" && req.method === "POST") {
      const input = z
        .object({ projectId: z.string().uuid(), sessionId: z.string().uuid() })
        .parse(await req.json());
      await withProjectLock(user, input.projectId, () =>
        deleteConversation(user!, input.projectId, input.sessionId),
      );
      result = { ok: true };
    } else if (path === "memories/clear" && req.method === "POST") {
      const input = z
        .object({ projectId: z.string().uuid() })
        .parse(await req.json());
      await withProjectLock(user, input.projectId, () =>
        clearProjectMemories(user!, input.projectId),
      );
      result = { ok: true };
    } else if (path === "telegram/link" && req.method === "POST") {
      await rateLimit(`${user}:link`, 5);
      if (!process.env.TELEGRAM_BOT_USERNAME || !process.env.TELEGRAM_BOT_TOKEN)
        throw new Error(
          "Telegram is not configured yet. Add bot credentials to .env.local.",
        );
      const code = await createTelegramLink(user);
      result = {
        url: `https://t.me/${process.env.TELEGRAM_BOT_USERNAME}?start=${code}`,
      };
    } else if (path === "access" && req.method === "POST") {
      await rateLimit(`${user}:access`, 3);
      const key = await createAccessKey(user);
      result = { key };
    } else return NextResponse.json({ error: "Not found" }, { status: 404 });
    const response = NextResponse.json(result, {
      headers: { "Cache-Control": "no-store" },
    });
    if (token)
      response.cookies.set("fixtrail_session", token, {
        httpOnly: true,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 86400,
      });
    return response;
  } catch (error) {
    const message =
      error instanceof z.ZodError
        ? "Check the request fields and try again."
        : error instanceof Error &&
            /not found|credentials|configured|Too many|already|Outdated|Walrus recall failed|Gemini request failed/.test(
              error.message,
            )
          ? error.message
          : "The request failed. No successful memory write is assumed. Check your server configuration and try again.";
    console.error(
      "[FixTrail]",
      error instanceof Error
        ? `${error.name}: ${error.message}`
        : "RequestError",
    );
    return NextResponse.json(
      { error: message },
      {
        status: /not found/.test(message)
          ? 404
          : /Too many/.test(message)
            ? 429
            : 400,
      },
    );
  }
}
export const GET = handle;
export const POST = handle;
