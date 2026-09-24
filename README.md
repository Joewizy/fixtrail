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

Configure the credentials below, then run `npm run dev` and open **http://localhost:3000**. SQLite data is created automatically in `data/`.

### Configuration

Set these values in `.env.local`, then restart the server:

Get your Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) and create a delegate key in the [Walrus Memory dashboard](https://memory.walrus.xyz/dashboard) to obtain your delegate private key and MemWalAccount ID.

| Variable             | Value                                    |
| -------------------- | ---------------------------------------- |
| `GEMINI_API_KEY`     | Your Gemini API key                      |
| `GEMINI_MODEL`       | A model available to your Google account |
| `MEMWAL_PRIVATE_KEY` | Your Walrus Memory delegate private key  |
| `MEMWAL_ACCOUNT_ID`  | Your MemWalAccount object ID             |

Set the fallback models in `.env.example` to models available to your account as well. `MEMWAL_SERVER_URL` is optional; leave it blank to use the SDK default. Keep credentials server-side in `.env.local`, which Git ignores. Telegram is optional and has separate settings in `.env.example`.

### Checks

```bash
npm run lint
npm test
npm run build
npm run typecheck
```

The build generates the Next.js types required by the typecheck. For browser tests, run `npm run test:browser` with Google Chrome installed and the development server running. Provider integration browser tests require `FIXTRAIL_TEST_LIVE=1` and make real Gemini and Walrus calls.

### Deployment

Run `npm ci`, `npm run build`, and `npm start` on a Node.js host. Configure the live environment variables above, set `APP_URL` to the public HTTPS URL, and set `FIXTRAIL_DATABASE_PATH` to a writable path on a persistent volume. Run a single app instance so all sessions use the same SQLite database.

## Built with

Next.js · TypeScript · SQLite · Gemini · Walrus Memory

Gemini powers the responses. Walrus Memory stores and recalls persistent memory. Both providers must be configured; there is no scripted fallback.

Built for **Walrus Session 8: Chatbots That Remember**.
