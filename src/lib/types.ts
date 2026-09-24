export type Kind =
  "environment" | "suggested" | "tried" | "failed" | "resolved";
export type Memory = {
  id: string;
  projectId: string;
  text: string;
  kind: Kind;
  createdAt: string;
  outdated: boolean;
  sync: "local" | "pending" | "saved" | "error";
  blobId?: string;
  jobId?: string;
  sourceMessageId?: string;
};
export type Project = {
  id: string;
  name: string;
  stack: string;
  createdAt: string;
};
export type Message = {
  id: string;
  projectId: string;
  sessionId: string;
  role: "user" | "assistant";
  text: string;
  createdAt: string;
  source: "web" | "telegram";
  memories: string[];
  memoryEnabled: boolean;
  model: string;
};
export type Workspace = {
  projects: Project[];
  memories: Memory[];
  messages: Message[];
  telegramLinked: boolean;
  telegramUsername: string;
  configured: boolean;
};
