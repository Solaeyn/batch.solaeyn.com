# batch.solaeyn.com

Solaeyn's .bat Builder — a web app for building, saving, and downloading Windows batch (`.bat`) scripts.

## What this app does

- Uses shared session auth from solaeyn.com via Redis session validation.
- Supports multiple users, each with isolated script libraries.
- Builds `.bat` scripts from typed command blocks (echo, set, prompt, goto, file operations, and more).
- Generates the batch file server-side so the download always matches a validated, sanitized draft.
- Provides a live preview, copy, download, and save/edit workflow.
- Redacts credentials and token-shaped values from request logs.

## Prerequisites

- Node.js 20+
- PostgreSQL for shared auth data (`DATABASE_URL`)
- PostgreSQL for builder data (`BATCH_DATABASE_URL`, can be a separate database/server)
- Redis (same Redis used by solaeyn.com sessions)

## Run locally

1. Install dependencies.

```bash
npm install
```

2. Copy `.env.example` to `.env` and fill the values.

```bash
cp .env.example .env
```

3. Start dev mode.

```bash
npm run dev
```

4. Open `http://localhost:3020/home`.

If session auth is missing, the app redirects to `AUTH_LOGIN_URL`.
When `AUTH_LOGIN_URL` is empty, the app derives the apex domain from the current host (for example `batch.solaeyn.com` -> `https://solaeyn.com`).

## Build and test

```bash
npm run build:client
npm test
```

## Required environment variables

- `DATABASE_URL`
- `BATCH_DATABASE_URL` (recommended for separating builder data; falls back to `DATABASE_URL` when empty)
- `REDIS_URL`
- `AUTH_LOGIN_URL` (optional override; default behavior redirects to the root domain such as `https://solaeyn.com`)
- `CSRF_SECRET` (recommended in production; an ephemeral key is used when empty)
- `SESSION_COOKIE_DOMAIN` (optional; derived from the request host when empty)
- `DATABASE_SSL_MODE` (optional; defaults to `disable` for Coolify/internal PostgreSQL)

## Rate-limit environment variables

| Variable | Default | Purpose |
|---|---:|---|
| `SCRIPT_CREATE_RATE_LIMIT_WINDOW_SECONDS` | `3600` | Fixed window for script creation |
| `SCRIPT_CREATE_RATE_LIMIT_MAX_USER` | `60` | Max script creations per user per window |
| `SCRIPT_READ_RATE_LIMIT_WINDOW_SECONDS` | `300` | Fixed window for reads and previews |
| `SCRIPT_READ_RATE_LIMIT_MAX_USER` | `240` | Max reads/previews per user per window |
| `SCRIPT_MUTATION_RATE_LIMIT_WINDOW_SECONDS` | `900` | Fixed window for updates and deletes |
| `SCRIPT_MUTATION_RATE_LIMIT_MAX_USER` | `240` | Max mutations per user per window |
| `MAX_SCRIPTS_PER_USER` | `200` | Maximum saved scripts per account |

Rate-limit state is stored in Redis. When Redis cannot enforce a limit, protected operations fail closed with HTTP `503`.

## Data model

Builder data lives in a single table:

- `batch_scripts` — `id`, `user_id`, `name`, `description`, `settings` (JSONB), `blocks` (JSONB), timestamps.

`user_id` is a plain indexed column (no cross-database foreign key). Ownership is enforced in application queries.

## Deployment notes

- Keep this app behind HTTPS in production.
- Ensure solaeyn.com sets the `sid` cookie with `Domain=.solaeyn.com`.
- Use the same Redis instance so session keys `sess:<sid>` are visible.
- Coolify/internal PostgreSQL usually does not support SSL. Leave `DATABASE_SSL_MODE` unset or set it to `disable`.
