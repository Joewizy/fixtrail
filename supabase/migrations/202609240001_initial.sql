-- Server-only schema: intentionally not exposed through the Supabase Data API.
BEGIN;
CREATE SCHEMA IF NOT EXISTS fixtrail;
REVOKE ALL ON SCHEMA fixtrail FROM PUBLIC;
CREATE TABLE IF NOT EXISTS fixtrail.users (
  id text PRIMARY KEY, created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS fixtrail.sessions (
  token text PRIMARY KEY, user_id text NOT NULL REFERENCES fixtrail.users(id), expires bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS fixtrail.projects (
  id text PRIMARY KEY, user_id text NOT NULL REFERENCES fixtrail.users(id), data jsonb NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS fixtrail.memories (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES fixtrail.projects(id), data jsonb NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS fixtrail.messages (
  id text PRIMARY KEY, project_id text NOT NULL REFERENCES fixtrail.projects(id), data jsonb NOT NULL,
  position bigint GENERATED ALWAYS AS IDENTITY
);
CREATE TABLE IF NOT EXISTS fixtrail.links (
  code text PRIMARY KEY, user_id text NOT NULL UNIQUE REFERENCES fixtrail.users(id), expires bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS fixtrail.telegram (
  chat_id text PRIMARY KEY, user_id text NOT NULL UNIQUE REFERENCES fixtrail.users(id),
  project_id text NOT NULL REFERENCES fixtrail.projects(id), session_id text NOT NULL
);
CREATE TABLE IF NOT EXISTS fixtrail.updates (id bigint PRIMARY KEY, status text NOT NULL);
CREATE TABLE IF NOT EXISTS fixtrail.limits (key text PRIMARY KEY, started timestamptz NOT NULL, count integer NOT NULL);
CREATE TABLE IF NOT EXISTS fixtrail.project_locks (
  project_id text PRIMARY KEY REFERENCES fixtrail.projects(id), token text NOT NULL, expires timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON fixtrail.sessions(user_id);
CREATE INDEX IF NOT EXISTS projects_user_idx ON fixtrail.projects(user_id, position);
CREATE INDEX IF NOT EXISTS memories_project_idx ON fixtrail.memories(project_id, position);
CREATE INDEX IF NOT EXISTS messages_project_idx ON fixtrail.messages(project_id, position);
-- No browser/API roles may read private session tokens, messages, or memory metadata.
REVOKE ALL ON ALL TABLES IN SCHEMA fixtrail FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA fixtrail FROM PUBLIC;
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['users','sessions','projects','memories','messages','links','telegram','updates','limits','project_locks'] LOOP
    EXECUTE format('ALTER TABLE fixtrail.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END $$;
COMMIT;
