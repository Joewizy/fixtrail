"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ArrowDownToLine,
  ArrowRight,
  ArrowUp,
  BookOpen,
  Check,
  CheckCheck,
  Code2,
  Copy,
  FlaskConical,
  Folder,
  GitBranch,
  History,
  Layers3,
  Link2,
  Loader2,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Plus,
  Send,
  Settings2,
  ShieldCheck,
  Terminal,
  X,
} from "lucide-react";
import type { Kind, Memory, Workspace as Data } from "@/lib/types";
const kinds: { value: Kind; label: string }[] = [
  { value: "environment", label: "Environment" },
  { value: "suggested", label: "Suggested" },
  { value: "tried", label: "Tried" },
  { value: "failed", label: "Failed attempt" },
  { value: "resolved", label: "Resolved" },
];
async function api<T>(path: string, body?: unknown): Promise<T> {
  const res = await fetch(`/api/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? {} : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Request failed");
  return data;
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <div className={`brand ${small ? "small" : ""}`}>
      <span className="brand-mark">
        <GitBranch size={small ? 16 : 23} strokeWidth={2.6} />
      </span>
      {!small && (
        <span>
          fixtrail<span className="brand-period">.</span>
        </span>
      )}
    </div>
  );
}
function date(s: string) {
  return new Date(s).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}
export default function Workspace() {
  const [data, setData] = useState<Data>();
  const [projectId, setProjectId] = useState("");
  const [sessionId, setSessionId] = useState("");
  const [view, setView] = useState("chat");
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [pendingMessage, setPendingMessage] = useState("");
  const [error, setError] = useState("");
  const [memoryOn, setMemoryOn] = useState(true);
  const [modal, setModal] = useState("");
  const [mobileNav, setMobileNav] = useState(false);
  const [filter, setFilter] = useState("all");
  const [name, setName] = useState("");
  const [stack, setStack] = useState("Sui · Move");
  const [fact, setFact] = useState("");
  const [kind, setKind] = useState<Kind>("environment");
  const [accessKey, setAccessKey] = useState("");
  const [restoreKey, setRestoreKey] = useState("");
  const [toast, setToast] = useState("");
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const initialized = useRef(false);
  const modalRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!modal) return;
    const previous = document.activeElement as HTMLElement | null;
    const dialog = modalRef.current;
    const elements = () =>
      Array.from(
        dialog?.querySelectorAll<HTMLElement>(
          "button:not(:disabled), input, textarea, select, a[href]",
        ) || [],
      );
    elements()[0]?.focus();
    const trap = (e: KeyboardEvent) => {
      if (e.key !== "Tab") return;
      const items = elements();
      const first = items[0];
      const last = items[items.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last?.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first?.focus();
      }
    };
    dialog?.addEventListener("keydown", trap);
    return () => {
      dialog?.removeEventListener("keydown", trap);
      previous?.focus();
    };
  }, [modal]);
  const refresh = useCallback(async () => {
    const d = await api<Data>("workspace");
    setData(d);
    return d;
  }, []);
  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    api<Data>("workspace")
      .then((d) => {
        setData(d);
        const p = localStorage.getItem("fixtrail-project");
        setProjectId(
          d.projects.some((x) => x.id === p) ? p! : d.projects[0]?.id || "",
        );
        const savedSession =
          localStorage.getItem("fixtrail-session") || crypto.randomUUID();
        setSessionId(savedSession);
        setMemoryOn(
          d.messages.find((m) => m.sessionId === savedSession)?.memoryEnabled ??
            true,
        );
      })
      .catch((e) => setError(e.message));
  }, [refresh]);
  useEffect(() => {
    if (projectId) localStorage.setItem("fixtrail-project", projectId);
    if (sessionId) localStorage.setItem("fixtrail-session", sessionId);
  }, [projectId, sessionId]);
  useEffect(() => {
    if (data?.messages.length || busy)
      bottom.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [data?.messages.length, busy]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(t);
  }, [toast]);
  useEffect(() => {
    const listener = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal("");
        setMobileNav(false);
      }
    };
    window.addEventListener("keydown", listener);
    return () => window.removeEventListener("keydown", listener);
  }, []);
  const project = data?.projects.find((p) => p.id === projectId);
  const all = data?.memories.filter((m) => m.projectId === projectId) || [];
  const active = all.filter((m) => !m.outdated);
  const conversation =
    data?.messages.filter(
      (m) => m.projectId === projectId && m.sessionId === sessionId,
    ) || [];
  const sessions = [
    ...new Set(
      data?.messages
        .filter((m) => m.projectId === projectId)
        .map((m) => m.sessionId) || [],
    ),
  ].reverse();
  const history = sessions.slice(0, 5).map((s) => ({
    id: s,
    first: data?.messages.find(
      (m) => m.sessionId === s && m.projectId === projectId,
    ),
  }));
  async function action(fn: () => Promise<unknown>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }
  function fresh() {
    setSessionId(crypto.randomUUID());
    setView("chat");
    setText("");
    setMobileNav(false);
  }
  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!text.trim() || busy) return;
    const outgoing = text;
    setText("");
    setPendingMessage(outgoing);
    setError("");
    setBusy(true);
    try {
      await api("chat", {
        projectId,
        sessionId,
        text: outgoing,
        memory: memoryOn,
      });
      await refresh();
      setPendingMessage("");
    } catch (e) {
      setText(outgoing);
      setError(
        e instanceof Error ? e.message : "That message could not be sent.",
      );
      setPendingMessage("");
    } finally {
      setBusy(false);
    }
  }
  function chooseProject(p: string) {
    setProjectId(p);
    fresh();
  }
  function exportEvidence() {
    const payload = {
      exportedAt: new Date().toISOString(),
      project,
      memories: all,
      messages: data?.messages.filter((m) => m.projectId === projectId),
      note: "User-exported record; only confirmed Walrus writes are storage evidence. Review before publishing",
    };
    const u = URL.createObjectURL(
      new Blob([JSON.stringify(payload, null, 2)], {
        type: "application/json",
      }),
    );
    const a = document.createElement("a");
    a.href = u;
    a.download = "fixtrail-evidence.json";
    a.click();
    URL.revokeObjectURL(u);
  }
  function memoryCard(m: Memory, compact = false) {
    return (
      <article
        key={m.id}
        className={`memory-card ${m.outdated ? "outdated" : ""} ${compact ? "compact" : ""}`}
      >
        <div className="memory-meta">
          <span className={`kind ${m.kind}`}>
            <i />
            {kinds.find((k) => k.value === m.kind)?.label}
          </span>
          <span>{date(m.createdAt)}</span>
        </div>
        <p>{m.text}</p>
        <div className="memory-bottom">
          <span className={m.sync === "error" ? "sync-error" : ""}>
            {m.outdated
              ? "Excluded from recall"
              : m.sync === "saved"
                ? "✓ Saved to Walrus"
                : m.sync === "local"
                  ? "Not synced to Walrus"
                  : m.sync === "error"
                    ? "Write not confirmed"
                    : m.jobId
                      ? "Awaiting Walrus confirmation"
                      : "Saving…"}
          </span>
          {!m.outdated && (
            <button
              title="Mark outdated: exclude from future recall"
              onClick={() =>
                action(async () => {
                  await api("memories/update", {
                    projectId,
                    id: m.id,
                    action: "outdate",
                  });
                  await refresh();
                })
              }
              disabled={busy}
            >
              <History size={13} /> Outdated
            </button>
          )}
          {!m.outdated && (m.sync === "error" || m.sync === "pending") && (
            <button
              onClick={() =>
                action(async () => {
                  await api("memories/update", {
                    projectId,
                    id: m.id,
                    action: "retry",
                  });
                  await refresh();
                })
              }
              disabled={busy}
            >
              {m.jobId ? "Check receipt" : "Retry"}
            </button>
          )}
          {m.sync === "saved" && m.blobId && (
            <a
              className="walrus-link"
              href={`https://walruscan.com/mainnet/blob/${encodeURIComponent(m.blobId)}`}
              target="_blank"
              rel="noreferrer"
              title="Open this confirmed Walrus blob on Walruscan"
            >
              <Link2 size={12} /> View blob
            </a>
          )}
        </div>
      </article>
    );
  }
  if (!data)
    return (
      <div className="loading">
        <Brand />
        <p>{error || "Opening your workspace…"}</p>
        {error && <button onClick={() => location.reload()}>Try again</button>}
      </div>
    );
  return (
    <div className="app-shell">
      {mobileNav && (
        <button
          className="nav-scrim"
          aria-label="Close navigation"
          onClick={() => setMobileNav(false)}
        />
      )}
      <aside className={`sidebar ${mobileNav ? "open" : ""}`}>
        <Brand />
        <div className="sidebar-section">
          <span>WORKSPACE</span>
        </div>
        <nav>
          {[
            { id: "chat", label: "Troubleshoot", icon: MessageSquare },
            { id: "memory", label: "Memory trail", icon: GitBranch },
            { id: "evidence", label: "Evidence", icon: FlaskConical },
          ].map((n) => (
            <button
              key={n.id}
              className={view === n.id ? "selected" : ""}
              onClick={() => {
                setView(n.id);
                setMobileNav(false);
              }}
            >
              <n.icon size={17} />
              {n.label}
              {n.id === "memory" && (
                <span className="count">{active.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="sidebar-section">
          <span>PROJECTS</span>
          <button aria-label="Add project" onClick={() => setModal("project")}>
            <Plus size={15} />
          </button>
        </div>
        <div className="projects-list">
          {data.projects.map((p) => (
            <button
              className={p.id === projectId ? "current" : ""}
              key={p.id}
              onClick={() => chooseProject(p.id)}
            >
              <Folder size={16} />
              <span>{p.name}</span>
              {p.id === projectId && <i />}
            </button>
          ))}
        </div>
        {history.length > 0 && (
          <>
            <div className="sidebar-section">
              <span>RECENT CONVERSATIONS</span>
            </div>
            <div className="recent-list">
              {history.map((s) => (
                <button
                  key={s.id}
                  onClick={() => {
                    setSessionId(s.id);
                    setMemoryOn(s.first?.memoryEnabled ?? true);
                    setView("chat");
                    setMobileNav(false);
                  }}
                >
                  <MessageSquare size={13} />
                  <span>{s.first?.text || "Conversation"}</span>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="sidebar-bottom">
          <div className="telegram-card">
            <span className="telegram-icon">
              <Send size={17} />
            </span>
            <strong>Take your trail with you</strong>
            <p>Start here. Pick it up on Telegram.</p>
            <button onClick={() => setModal("telegram")}>
              {data.telegramLinked ? "Telegram connected" : "Connect Telegram"}
              <ArrowRight size={14} />
            </button>
          </div>
          <button
            className="plain settings"
            onClick={() => setModal("settings")}
          >
            <Settings2 size={16} /> Settings & access
          </button>
          <a
            className="docs-link"
            href="https://docs.wal.app/walrus-memory/examples/chatbot"
            target="_blank"
            rel="noreferrer"
          >
            <BookOpen size={14} /> Built with Walrus Memory{" "}
            <ArrowRight size={12} />
          </a>
        </div>
      </aside>
      <main className="main-shell">
        {error && (
          <div className="error-banner" role="alert">
            <div className="error-content">
              <strong>
                {error.startsWith("Walrus")
                  ? "Memory service could not be reached"
                  : error.startsWith("Gemini")
                    ? "The assistant could not answer"
                    : "That message could not be sent"}
              </strong>
              <span>{error}</span>
            </div>
            <div className="error-actions">
              {text.trim() && (
                <button
                  className="error-retry"
                  onClick={() => input.current?.focus()}
                >
                  Keep message & try again
                </button>
              )}
              <button onClick={() => setError("")} aria-label="Dismiss error">
                <X size={16} />
              </button>
            </div>
          </div>
        )}
        <div className="workspace-body">
          <section className="primary-panel">
            {view === "chat" ? (
              <>
                <div className="conversation-toolbar">
                  <div>
                    <button
                      className="mobile-menu"
                      aria-label="Open navigation"
                      onClick={() => setMobileNav(true)}
                    >
                      <Menu size={20} />
                    </button>
                    <span className="live-dot" />
                    {conversation.length
                      ? "Current conversation"
                      : "New conversation"}
                    <span className="toolbar-divider" />
                    {project?.stack || "Project workspace"}
                  </div>
                  <div>
                    <button
                      className="secondary new-chat"
                      onClick={fresh}
                      disabled={busy}
                    >
                      <Plus size={15} /> New conversation
                    </button>
                    <button
                      className={`memory-toggle ${memoryOn ? "on" : ""}`}
                      aria-pressed={memoryOn}
                      disabled={busy}
                      onClick={() => {
                        setMemoryOn(!memoryOn);
                        fresh();
                      }}
                    >
                      <span className="switch">
                        <i />
                      </span>
                      Memory {memoryOn ? "on" : "off"}
                    </button>
                  </div>
                </div>
                <div className="conversation">
                  {!conversation.length && !pendingMessage && !busy && (
                    <div className="welcome">
                      <div className="trail-illustration" aria-hidden="true">
                        <div className="trail-line" />
                        <span className="trail-node first">
                          <Terminal size={20} />
                        </span>
                        <span className="trail-node second">
                          <X size={18} />
                        </span>
                        <span className="trail-node third">
                          <GitBranch size={24} />
                        </span>
                        <span className="trail-node fourth">
                          <Check size={18} />
                        </span>
                        <span className="illustration-note">
                          progress, preserved.
                        </span>
                      </div>
                      <div className="welcome-eyebrow">
                        LESS REPEATING. MORE RESOLVING.
                      </div>
                      <h2>What are we working through?</h2>
                      <p>
                        Paste an error, describe a blocker, or continue an old
                        thread.
                        <br />
                        We’ll keep track of the things you’ve already tried.
                      </p>
                      <div className="starter-grid">
                        <button
                          onClick={() => {
                            setText(
                              "I’m getting an error when I run sui move build. ",
                            );
                            input.current?.focus();
                          }}
                        >
                          <Terminal size={19} />
                          <strong>Debug an error</strong>
                          <span>Let’s find the next useful step</span>
                          <ArrowRight size={15} />
                        </button>
                        <button
                          onClick={() => {
                            setText("Here’s what I already tried: ");
                            input.current?.focus();
                          }}
                        >
                          <GitBranch size={19} />
                          <strong>Continue troubleshooting</strong>
                          <span>Build on your previous attempts</span>
                          <ArrowRight size={15} />
                        </button>
                      </div>
                    </div>
                  )}
                  {conversation.map((m) => (
                    <div className={`message ${m.role}`} key={m.id}>
                      <div className="message-avatar">
                        {m.role === "assistant" ? <Brand small /> : "Y"}
                      </div>
                      <div className="message-body">
                        <div className="message-heading">
                          <strong>
                            {m.role === "assistant" ? "FixTrail" : "You"}
                          </strong>
                          <span>
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                            {m.source === "telegram" ? " · Telegram" : ""}
                          </span>
                        </div>
                        <div className="message-text">{m.text}</div>
                        {m.role === "assistant" && m.memories.length > 0 && (
                          <details className="recalled">
                            <summary>
                              <Layers3 size={13} /> Used {m.memories.length}{" "}
                              earlier{" "}
                              {m.memories.length === 1 ? "memory" : "memories"}
                            </summary>
                            {m.memories.map((mid) => (
                              <p key={mid}>
                                {all.find((mm) => mm.id === mid)?.text ||
                                  "Memory unavailable"}
                              </p>
                            ))}
                          </details>
                        )}
                      </div>
                    </div>
                  ))}
                  {pendingMessage && (
                    <div
                      className="message user pending-message"
                      aria-label="Sending your message"
                    >
                      <div className="message-avatar">Y</div>
                      <div className="message-body">
                        <div className="message-heading">
                          <strong>You</strong>
                          <span>Sending…</span>
                        </div>
                        <div className="message-text">{pendingMessage}</div>
                      </div>
                    </div>
                  )}
                  {busy && (
                    <div className="thinking">
                      <Loader2 size={16} className="spin" /> Checking context
                      and saving your progress…
                    </div>
                  )}
                  <div ref={bottom} />
                </div>
                <div className="composer-wrap">
                  {!memoryOn && (
                    <div className="baseline-note">
                      <FlaskConical size={13} /> Baseline: this conversation
                      won’t recall or save memories.
                    </div>
                  )}
                  <form className="composer" onSubmit={submit}>
                    <textarea
                      ref={input}
                      value={text}
                      onChange={(e) => setText(e.target.value)}
                      placeholder="Describe what’s happening, or paste your error…"
                      aria-label="Message FixTrail"
                      maxLength={8000}
                      onKeyDown={(e) => {
                        if (
                          e.key === "Enter" &&
                          !e.shiftKey &&
                          !e.nativeEvent.isComposing
                        ) {
                          e.preventDefault();
                          e.currentTarget.form?.requestSubmit();
                        }
                      }}
                    />
                    <div className="composer-bottom">
                      <span>
                        <Code2 size={14} /> Code and error logs welcome
                      </span>
                      <div>
                        <span className="enter-hint">Enter to send</span>
                        <button
                          className="send-button"
                          type="submit"
                          disabled={busy || !text.trim()}
                          aria-label="Send message"
                        >
                          <ArrowUp size={19} />
                        </button>
                      </div>
                    </div>
                  </form>
                  <p className="composer-footnote">
                    Check suggested commands before running them. Keep secrets
                    out of chat.
                  </p>
                </div>
              </>
            ) : view === "memory" ? (
              <div className="full-content">
                <div className="content-toolbar">
                  <div className="filter-pills">
                    {["all", "failed", "resolved", "outdated"].map((f) => (
                      <button
                        className={filter === f ? "active" : ""}
                        key={f}
                        onClick={() => setFilter(f)}
                      >
                        {f === "all"
                          ? "Active memories"
                          : f === "failed"
                            ? "Failed attempts"
                            : f === "resolved"
                              ? "Resolutions"
                              : "Outdated"}
                      </button>
                    ))}
                  </div>
                  <button
                    className="primary"
                    onClick={() => setModal("memory")}
                  >
                    <Plus size={15} /> Add memory
                  </button>
                </div>
                <div className="memory-grid">
                  {all
                    .filter((m) =>
                      filter === "outdated"
                        ? m.outdated
                        : !m.outdated &&
                          (filter === "all" || m.kind === filter),
                    )
                    .map((m) => memoryCard(m))}
                </div>
                {!all.length && (
                  <div className="empty-state">
                    <GitBranch size={32} />
                    <h2>Your trail starts with a conversation.</h2>
                    <p>
                      Confirmed facts and outcomes will appear here. You can
                      also add a memory yourself.
                    </p>
                    <button className="primary" onClick={() => setView("chat")}>
                      Start troubleshooting <ArrowRight size={15} />
                    </button>
                  </div>
                )}
                <p className="muted-note">
                  Marking a memory outdated excludes it from future recall. It
                  does not erase the underlying Walrus blob.
                </p>
              </div>
            ) : (
              <div className="full-content">
                <div className="evidence-label">
                  <FlaskConical size={18} /> Evidence comes from real
                  conversations, not seeded examples.
                </div>
                <div className="stats-grid">
                  <div>
                    <span>Confirmed Walrus memories</span>
                    <strong>
                      {all.filter((m) => m.sync === "saved").length}
                      <small> / 10 target per user</small>
                    </strong>
                  </div>
                  <div>
                    <span>Conversations</span>
                    <strong>{sessions.length}</strong>
                  </div>
                  <div>
                    <span>Recalls in responses</span>
                    <strong>
                      {
                        data.messages.filter(
                          (m) =>
                            m.projectId === projectId &&
                            m.role === "assistant" &&
                            m.memories.length,
                        ).length
                      }
                    </strong>
                  </div>
                </div>
                <div className="evidence-card">
                  <h2>A fair before-and-after</h2>
                  <p>
                    Start a new conversation with memory off. Ask your
                    troubleshooting question. Then start another with memory on
                    and ask the exact same question.
                  </p>
                  <ol>
                    <li>
                      Use the same model and project in both conversations.
                    </li>
                    <li>
                      Check for repeated questions and previously failed fixes.
                    </li>
                    <li>
                      Save the actual results, including misses and incorrect
                      recalls.
                    </li>
                  </ol>
                  <button
                    className="primary"
                    onClick={() => {
                      setMemoryOn(false);
                      fresh();
                    }}
                  >
                    Start baseline conversation <ArrowRight size={15} />
                  </button>
                </div>
                <div className="evidence-card export-card">
                  <div>
                    <h3>Your record, ready to review</h3>
                    <p>
                      Export messages, memory references, timestamps, and
                      storage receipts.
                      <br />
                      Review the file for private information before sharing.
                    </p>
                  </div>
                  <button className="secondary" onClick={exportEvidence}>
                    <ArrowDownToLine size={16} /> Export JSON
                  </button>
                </div>
              </div>
            )}
          </section>
          {view === "chat" && (
            <aside className="trail-panel">
              <div className="trail-panel-heading">
                <div>
                  <GitBranch size={18} />
                  <h2>Memory trail</h2>
                </div>
                <button
                  aria-label="View all memories"
                  onClick={() => setView("memory")}
                >
                  <MoreHorizontal size={18} />
                </button>
              </div>
              <p className="trail-intro">
                The context you shouldn’t have to repeat.
              </p>
              <div className="trail-stats">
                <div>
                  <strong>{active.length}</strong>
                  <span>memories</span>
                </div>
                <div>
                  <strong>
                    {active.filter((m) => m.kind === "failed").length}
                  </strong>
                  <span>failed attempts</span>
                </div>
                <div>
                  <strong>
                    {active.filter((m) => m.kind === "resolved").length}
                  </strong>
                  <span>resolved</span>
                </div>
              </div>
              <div className="trail-subheading">
                <span>THIS PROJECT</span>
                <button
                  onClick={() => setModal("memory")}
                  aria-label="Add memory"
                >
                  <Plus size={15} />
                </button>
              </div>
              <div className="trail-cards">
                {active.length ? (
                  active
                    .slice()
                    .reverse()
                    .map((m) => memoryCard(m, true))
                ) : (
                  <div className="trail-empty">
                    <div className="empty-dots">
                      <span />
                      <span />
                      <span />
                    </div>
                    <h3>Nothing lost. Nothing yet.</h3>
                    <p>
                      Your environment, attempts, and confirmed fixes will
                      collect here as you talk.
                    </p>
                    <button onClick={() => setModal("memory")}>
                      Add your first memory <Plus size={13} />
                    </button>
                  </div>
                )}
              </div>
              <div className="memory-explainer">
                <ShieldCheck size={17} />
                <div>
                  <strong>Memory with a paper trail.</strong>
                  <p>
                    Only confirmed writes are marked saved. You control what
                    stays in context.
                  </p>
                </div>
              </div>
            </aside>
          )}
        </div>
      </main>
      {toast && (
        <div className="toast" role="status">
          <CheckCheck size={17} />
          {toast}
        </div>
      )}
      {modal && (
        <div className="modal-backdrop" onClick={() => setModal("")}>
          <section
            className="modal"
            ref={modalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="modal-title"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              className="modal-close"
              aria-label="Close dialog"
              onClick={() => setModal("")}
            >
              <X size={20} />
            </button>
            <h2 id="modal-title">
              {modal === "project"
                ? "A new project. A separate trail."
                : modal === "memory"
                  ? "Save something worth remembering."
                  : modal === "telegram"
                    ? "Your context travels with you."
                    : "Workspace settings"}
            </h2>
            {modal === "project" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    const p = await api<{ id: string }>("projects", {
                      name,
                      stack,
                    });
                    await refresh();
                    chooseProject(p.id);
                    setModal("");
                    setName("");
                  });
                }}
              >
                <p>
                  Keep each project’s environment and troubleshooting history
                  separate.
                </p>
                <label>
                  Project name
                  <input
                    autoFocus
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    required
                    maxLength={60}
                    placeholder="e.g. Walrus explorer"
                  />
                </label>
                <label>
                  Stack / environment
                  <input
                    value={stack}
                    onChange={(e) => setStack(e.target.value)}
                    maxLength={100}
                    placeholder="e.g. Sui · Move · testnet"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Create project <ArrowRight size={15} />
                </button>
              </form>
            )}
            {modal === "memory" && (
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  action(async () => {
                    await api("memories", { projectId, text: fact, kind });
                    await refresh();
                    setModal("");
                    setFact("");
                  });
                }}
              >
                <p>
                  Record a specific fact or outcome. Include the problem it
                  relates to.
                </p>
                <label>
                  Memory type
                  <select
                    value={kind}
                    onChange={(e) => setKind(e.target.value as Kind)}
                  >
                    {kinds.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label>
                  What should FixTrail remember?
                  <textarea
                    autoFocus
                    value={fact}
                    onChange={(e) => setFact(e.target.value)}
                    required
                    maxLength={1000}
                    placeholder="Deleting the build directory did not fix the dependency error…"
                  />
                </label>
                <button className="primary" disabled={busy}>
                  Save memory <Plus size={15} />
                </button>
              </form>
            )}
            {modal === "telegram" && (
              <>
                <span className="modal-feature-icon">
                  <Send size={28} />
                </span>
                <p>
                  Continue a project from your phone. Your web and Telegram
                  conversations use the same project memories.
                </p>
                <div className="command-list">
                  <p>
                    <code>/projects</code> Choose a project
                  </p>
                  <p>
                    <code>/new</code> Start a fresh conversation
                  </p>
                  <p>
                    <code>/clear</code> Delete the current conversation
                  </p>
                  <p>
                    <code>/clear_memory</code> Clear project memory with
                    confirmation
                  </p>
                  <p>
                    <code>/unlink</code> Disconnect your account
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={busy}
                  onClick={() =>
                    action(async () => {
                      const r = await api<{ url: string }>("telegram/link", {});
                      window.location.assign(r.url);
                    })
                  }
                >
                  <Link2 size={16} /> Link Telegram account
                </button>
                <small className="muted-note">
                  Connection links expire after 10 minutes and can only be used
                  once.
                </small>
              </>
            )}
            {modal === "settings" && (
              <>
                <p>
                  <strong>Live mode</strong> ·{" "}
                  {data.configured
                    ? "Provider credentials configured."
                    : "Provider credentials missing."}
                </p>
                <p className="muted-note">
                  This browser has a private workspace session. Save an access
                  key to open it on another device. Anyone with the key can
                  access this workspace. Keys expire after 30 days.
                </p>
                <button
                  className="secondary"
                  onClick={() =>
                    action(async () => {
                      const r = await api<{ key: string }>("access", {});
                      setAccessKey(r.key);
                    })
                  }
                >
                  Generate access key
                </button>
                {accessKey && (
                  <div className="access-key">
                    <code>{accessKey}</code>
                    <button
                      aria-label="Copy access key"
                      onClick={() =>
                        action(async () => {
                          await navigator.clipboard.writeText(accessKey);
                          setToast("Access key copied");
                        })
                      }
                    >
                      <Copy size={16} />
                    </button>
                  </div>
                )}
                <div className="data-controls">
                  <div>
                    <strong>Current conversation</strong>
                    <span>Remove its messages from this workspace.</span>
                  </div>
                  <button
                    className="danger-button"
                    disabled={busy || !conversation.length}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Delete this conversation? This cannot be undone.",
                        )
                      )
                        return;
                      action(async () => {
                        await api("conversation/clear", {
                          projectId,
                          sessionId,
                        });
                        await refresh();
                        setModal("");
                        setToast("Conversation deleted");
                      });
                    }}
                  >
                    Delete chat
                  </button>
                </div>
                <div className="data-controls destructive">
                  <div>
                    <strong>Project memory</strong>
                    <span>Remove all memories from future recall.</span>
                  </div>
                  <button
                    className="danger-button"
                    disabled={busy || !all.length}
                    onClick={() => {
                      if (
                        !window.confirm(
                          "Clear this project's memory trail? This cannot be undone.",
                        )
                      )
                        return;
                      action(async () => {
                        await api("memories/clear", { projectId });
                        await refresh();
                        setModal("");
                        setToast("Project memory cleared");
                      });
                    }}
                  >
                    Clear memory
                  </button>
                </div>
                <p className="muted-note">
                  Clearing removes FixTrail’s local records and stops future
                  recall. Walrus blobs already uploaded are immutable and are
                  not physically deleted by this control.
                </p>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    action(async () => {
                      const d = await api<Data>("restore", {
                        token: restoreKey.trim(),
                      });
                      setData(d);
                      chooseProject(d.projects[0].id);
                      setModal("");
                      setRestoreKey("");
                      setAccessKey("");
                    });
                  }}
                >
                  <label>
                    Open an existing workspace
                    <input
                      value={restoreKey}
                      onChange={(e) => setRestoreKey(e.target.value)}
                      type="password"
                      placeholder="Paste your access key"
                      required
                    />
                  </label>
                  <button className="primary" disabled={busy}>
                    Open workspace <ArrowRight size={15} />
                  </button>
                </form>
              </>
            )}
            {error && (
              <p className="modal-error" role="alert">
                {error}
              </p>
            )}
          </section>
        </div>
      )}
    </div>
  );
}
