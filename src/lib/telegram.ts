import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import {
  clearProjectMemories,
  db,
  deleteConversation,
  hash,
  id,
  projects,
} from "./db";
import { chat } from "./chat";
const updateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      text: z.string().max(8000).optional(),
      chat: z.object({ id: z.number().int(), type: z.string() }),
    })
    .optional(),
});
export function verifyTelegram(secret: string | null) {
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  return Boolean(
    expected &&
    secret &&
    Buffer.byteLength(secret) === Buffer.byteLength(expected) &&
    timingSafeEqual(Buffer.from(secret), Buffer.from(expected)),
  );
}
async function send(chatId: string, text: string) {
  for (let i = 0; i < text.length; i += 4000) {
    const response = await fetch(
      `https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          chat_id: chatId,
          text: text.slice(i, i + 4000),
        }),
      },
    );
    if (!response.ok) throw new Error("Telegram delivery failed");
  }
}
export async function telegramUpdate(raw: unknown) {
  if (!process.env.TELEGRAM_BOT_TOKEN)
    throw new Error("Telegram is not configured");
  const update = updateSchema.parse(raw);
  if (!update.message?.text || update.message.chat.type !== "private") return;
  if (db.prepare("SELECT id FROM updates WHERE id=?").get(update.update_id))
    return;
  db.prepare("INSERT INTO updates VALUES (?,?)").run(
    update.update_id,
    "processing",
  );
  const chatId = String(update.message.chat.id);
  const text = update.message.text;
  try {
    if (text === "/start") {
      const linked = db
        .prepare("SELECT user_id FROM telegram WHERE chat_id=?")
        .get(chatId);
      await send(
        chatId,
        linked
          ? "Welcome back to FixTrail. Send a developer error or use /projects to choose a project. /help lists every command."
          : "Welcome to FixTrail. Open the web app, choose Connect Telegram, then tap the generated link to connect this chat. Use /help for commands.",
      );
    } else if (text.startsWith("/start ")) {
      const code = text.slice(7).trim();
      const linked = db.transaction(() => {
        const row = db
          .prepare("SELECT user_id FROM links WHERE code=? AND expires>?")
          .get(hash(code), Date.now()) as { user_id: string } | undefined;
        if (!row) return false;
        const existing = db
          .prepare("SELECT user_id FROM telegram WHERE chat_id=?")
          .get(chatId) as { user_id: string } | undefined;
        if (existing && existing.user_id !== row.user_id) return false;
        const p = projects(row.user_id)[0];
        db.prepare("DELETE FROM telegram WHERE user_id=?").run(row.user_id);
        db.prepare("INSERT INTO telegram VALUES (?,?,?,?)").run(
          chatId,
          row.user_id,
          p.id,
          id(),
        );
        db.prepare("DELETE FROM links WHERE code=?").run(hash(code));
        return true;
      })();
      await send(
        chatId,
        linked
          ? "Connected to FixTrail. /projects lists your projects. /new starts a fresh conversation. Send an error or an update to continue your trail."
          : "This link is invalid or expired. Generate a new link in FixTrail.",
      );
    } else {
      const link = db
        .prepare("SELECT * FROM telegram WHERE chat_id=?")
        .get(chatId) as
        { user_id: string; project_id: string; session_id: string } | undefined;
      if (!link)
        await send(
          chatId,
          "Connect your account using the Telegram button in the FixTrail web app.",
        );
      else if (text === "/projects")
        await send(
          chatId,
          projects(link.user_id)
            .map((p, i) => `${i + 1}. ${p.name}\n/project ${p.id}`)
            .join("\n\n"),
        );
      else if (text.startsWith("/project ")) {
        const p = projects(link.user_id).find(
          (p) => p.id === text.slice(9).trim(),
        );
        if (p) {
          db.prepare(
            "UPDATE telegram SET project_id=?,session_id=? WHERE chat_id=?",
          ).run(p.id, id(), chatId);
          await send(chatId, `Switched to ${p.name}.`);
        } else await send(chatId, "Project not found. Use /projects.");
      } else if (text === "/new") {
        db.prepare("UPDATE telegram SET session_id=? WHERE chat_id=?").run(
          id(),
          chatId,
        );
        await send(
          chatId,
          "New conversation started. Your project memories are still available.",
        );
      } else if (text === "/clear") {
        deleteConversation(link.user_id, link.project_id, link.session_id);
        db.prepare("UPDATE telegram SET session_id=? WHERE chat_id=?").run(
          id(),
          chatId,
        );
        await send(
          chatId,
          "Current conversation deleted. Project memories are still available.",
        );
      } else if (text === "/clear_memory") {
        await send(
          chatId,
          "This removes the selected project's memories from FixTrail recall. Walrus blobs already uploaded are immutable. Send /clear_memory confirm to continue.",
        );
      } else if (text === "/clear_memory confirm") {
        clearProjectMemories(link.user_id, link.project_id);
        await send(
          chatId,
          "Project memory cleared from FixTrail. Your next message starts with an empty memory trail.",
        );
      } else if (text === "/help") {
        await send(
          chatId,
          "/projects — list projects\n/project <id> — switch project\n/new — new conversation\n/clear — delete current conversation\n/clear_memory — clear project memory (requires confirmation)\n/unlink — disconnect Telegram",
        );
      } else if (text === "/unlink") {
        db.prepare("DELETE FROM telegram WHERE chat_id=?").run(chatId);
        await send(
          chatId,
          "Telegram disconnected. Your memories remain in the web app.",
        );
      } else {
        const result = await chat(link.user_id, {
          projectId: link.project_id,
          sessionId: link.session_id,
          text,
          memory: true,
          source: "telegram",
        });
        await send(
          chatId,
          result.answer.text +
            `\n\n${result.recalled.length} memories recalled · ${result.saved.filter((m) => m.sync === "saved").length} saved to Walrus`,
        );
      }
    }
    db.prepare("UPDATE updates SET status=? WHERE id=?").run(
      "done",
      update.update_id,
    );
  } catch {
    // Keep the update consumed: automatic retries must not duplicate model calls or paid memory writes.
    db.prepare("UPDATE updates SET status=? WHERE id=?").run(
      "failed",
      update.update_id,
    );
    await send(
      chatId,
      "That request could not finish. Check the web app for saved messages before trying again.",
    );
  }
}
