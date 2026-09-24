# FixTrail

**Stop debugging the same problem twice.**

FixTrail is an AI troubleshooting assistant for developers. It keeps a record of your environment, failed attempts, and working fixes so each conversation can pick up where the last one ended.

## How it works

Create a project and describe the issue. As you work through it, FixTrail builds a memory trail of what you suggested, tried, and resolved. When the issue comes back, that history helps guide the next answer.

- **Project memory** — keep troubleshooting context across conversations.
- **A visible memory trail** — review saved context and mark outdated information.
- **Memory on or off** — compare responses with and without previous context.
- **Telegram companion** — continue troubleshooting with access to the same project memory.

## Setup

Requires **Node.js 22.13+ on the 22.x release line** and npm. The `.nvmrc` file selects Node 22.

```bash
git clone https://github.com/Joewizy/fixtrail.git
cd fixtrail
nvm install
nvm use
npm ci
cp .env.example .env.local
```

Configure the credentials below, run `npm run db:migrate` once to create the database schema, then run `npm run dev` and open **http://localhost:3000**.

### Configuration

Set these values in `.env.local`, then restart the server:

Get your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and create a delegate key in the [Walrus Memory dashboard](https://memory.walrus.xyz/dashboard) to obtain your delegate private key and MemWalAccount ID.

| Variable             | Value                                                  |
| -------------------- | ------------------------------------------------------ |
| `DATABASE_URL`       | Supabase Postgres transaction-pooler connection string |
| `GEMINI_API_KEY`     | Your Gemini API key                                    |
| `GEMINI_MODEL`       | `gemini-3.5-flash-lite` (default)                       |
| `MEMWAL_PRIVATE_KEY` | Your Walrus Memory delegate private key                |
| `MEMWAL_ACCOUNT_ID`  | Your MemWalAccount object ID                           |

Create a [Supabase project](https://supabase.com/dashboard), open **Connect → Transaction pooler**, and copy the connection string into `DATABASE_URL`. Replace the password placeholder (URL-encode special characters) and append `?sslmode=verify-full` for verified TLS. This is a server-only connection; no Supabase browser keys are needed.

Set the fallback models in `.env.example` to models available to your account as well. `MEMWAL_SERVER_URL` is optional; leave it blank to use the SDK default. Keep credentials server-side in `.env.local`, which Git ignores. Telegram is optional and has separate settings in `.env.example`.

### Checks

```bash
npm run lint
npm test
npm run build
npm run typecheck
```

`npm test` requires PostgreSQL tools (`initdb` and `pg_ctl`) on PATH. It creates and removes an isolated test database and mocks Gemini/Walrus; it never uses your Supabase database. The build generates the Next.js types required by the typecheck. For browser tests, run `npm run test:browser` with Google Chrome installed and the development server running. Provider integration browser tests require `FIXTRAIL_TEST_LIVE=1` and make real Gemini and Walrus calls.

### Deployment

1. Apply [the database migration](supabase/migrations/202609240001_initial.sql) in the Supabase SQL Editor, or run `npm run db:migrate` locally. `DIRECT_DATABASE_URL` can supply a direct/session connection for migrations.
2. Import the GitHub repository into Vercel using the **Next.js** preset and **Node.js 22.x**. Keep the default build command (`npm run build`) and enable Fluid Compute for the route’s 300-second limit.
3. Add `DATABASE_URL` and the provider variables from `.env.example` to Vercel. Set `APP_URL` to the exact public HTTPS origin (for example `https://fixtrail.vercel.app`), then deploy. Use a separate database for preview deployments.
4. Open the app, send a message, confirm its Walrus receipt, then start a new conversation and verify recall.

Supabase stores application state and memory receipts in the private `fixtrail` schema; Walrus handles memory storage and recall. Existing local SQLite data is not imported automatically. No persistent disk is required. If using Telegram, register `/api/telegram/webhook` at your public URL with the configured webhook secret.

## Built with

Next.js · TypeScript · Supabase Postgres · Gemini · Walrus Memory

Gemini powers the responses. Walrus Memory stores and recalls persistent memory. Both providers must be configured; there is no scripted fallback.

Each confirmed memory has a **View blob** link in the Memory trail. It opens the corresponding mainnet record on [Walruscan](https://walruscan.com/mainnet/accounts). Walrus Memory encrypts the stored payload, so the public page verifies the blob handle and network record; the readable text and conversation context are included in FixTrail’s exported evidence JSON.

Built for **Walrus Session 8: Chatbots That Remember**.
