# asurada

TypeScript monorepo for a solo SaaS — Vite + React frontend, Hono backend, raw Postgres + Redis.

## Stack

| Layer | Choice |
|---|---|
| Monorepo | pnpm workspaces + Turborepo |
| Frontend | Vite 6 + React 19 + React Router 7 + Tailwind v4 + shadcn/ui |
| Backend | Hono + Pino + pg + node-redis + BullMQ |
| Validation | Zod (shared between api + web) |
| Lang | TypeScript (strict, ESM, `.js` ext on imports) |
| Lint/format | Biome |
| Test | Vitest |
| Containers | Podman + podman compose (postgres + redis only) |
| Migrations | Flyway CLI (manual), scripts in `sql/default/` |

## Prerequisites (one-time)

```bash
# Node 22+ (check)
node --version    # must be >=22

# pnpm via corepack
corepack enable
corepack prepare pnpm@9.12.0 --activate

# Podman (for postgres + redis containers)
brew install podman
podman machine init
podman machine start

# Flyway (for DB migrations)
brew install flyway
```

## First-time setup

```bash
# 1. Install dependencies
pnpm install

# 2. Copy env file and adjust if needed
cp .env.example .env

# 3. Start infrastructure (postgres + redis only)
pnpm infra:up

# 4. Apply database migrations (manual, via Flyway CLI)
flyway -configFiles=./flyway.conf migrate
```

## Daily workflow

```bash
# Start infrastructure (postgres + redis) — runs in background
pnpm infra:up

# Run BOTH frontend + backend together (parallel, with hot reload)
pnpm dev

# OR run them separately (recommended for debugging)
pnpm dev:api     # Hono backend on http://localhost:3000
pnpm dev:web     # Vite frontend on http://localhost:5173
```

Then open **http://localhost:5173**. The frontend talks to the backend at `VITE_API_URL` (default `http://localhost:3000`) — CORS is configured on the backend to allow the frontend origin.

## Useful commands

```bash
# Infrastructure
pnpm infra:up       # start postgres + redis (detached)
pnpm infra:down     # stop containers (keep data)
pnpm infra:logs     # tail container logs
pnpm infra:clean    # stop + DELETE volumes (destructive!)

# Database (Flyway — run manually from repo root)
flyway -configFiles=./flyway.conf migrate     # apply pending migrations
flyway -configFiles=./flyway.conf info        # show migration status
flyway -configFiles=./flyway.conf repair      # fix failed migrations
flyway -configFiles=./flyway.conf clean       # DROP all schema (destructive!)

# Quality
pnpm typecheck      # tsc --noEmit across all packages
pnpm lint           # biome check
pnpm format         # biome format --write
pnpm build          # build all packages (shared → api → web)
pnpm test           # vitest run across all packages
```

## Project structure

```
asurada/
├── apps/
│   ├── api/                      # @asurada/api — Hono backend
│   │   ├── src/
│   │   │   ├── env.ts            # Zod-validated env vars
│   │   │   ├── app.ts            # Hono app + middleware (CORS, error, requestId)
│   │   │   ├── index.ts          # bootstrap + graceful shutdown
│   │   │   ├── lib/
│   │   │   │   ├── logger.ts     # Pino instance
│   │   │   │   ├── postgres.ts   # pg Pool + query helper
│   │   │   │   ├── redis.ts      # node-redis client
│   │   │   │   ├── queue.ts      # BullMQ queue + worker + canonical agent singleton
│   │   │   │   ├── pubsub.ts     # Redis pub/sub → SSE events
│   │   │   │   ├── scheduleJobs.ts # unified schedule→BullMQ registration
│   │   │   │   ├── checkpointer.ts  # LangGraph PostgresSaver singleton
│   │   │   │   └── errors.ts     # HttpError classes
│   │   │   ├── agent/
│   │   │   │   ├── constants.ts  # provider registry (LLM_PROVIDERS, PROVIDER_DEFAULTS)
│   │   │   │   ├── llm.ts        # model chain factory (OpenAI-compatible)
│   │   │   │   ├── graph.ts      # LangGraph StateGraph + system prompt
│   │   │   │   ├── extract.ts    # reasoning/content extraction (shared)
│   │   │   │   ├── toolPolicy.ts # guarded tool node (dedup, DR toggle, parallel)
│   │   │   │   └── tools/        # search + deep research + scheduling tools
│   │   │   ├── middleware/
│   │   │   │   ├── error.ts      # centralized error handler
│   │   │   │   └── requestId.ts
│   │   │   └── routes/
│   │   │       ├── health.ts     # GET /health
│   │   │       ├── users.ts      # CRUD sample: /users
│   │   │       ├── threads.ts    # threads CRUD + detached chat + events SSE
│   │   │       └── schedules.ts  # schedules CRUD
│   │   └── Dockerfile            # multi-stage, pnpm fetch
│   └── web/                      # @asurada/web — Vite frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── router.tsx        # React Router config
│       │   ├── pages/            # ChatLayout, ThreadChat, EmptyState, NotFound
│       │   ├── components/       # MessageBubble, Markdown, ThinkingBlock, ToolCallsBlock, Sidebar
│       │   ├── theme/            # ThemeProvider + ThemeToggle
│       │   └── styles/globals.css
│       ├── nginx.conf            # SPA fallback for prod image
│       └── Dockerfile            # multi-stage → nginx
├── packages/
│   └── shared/                   # @asurada/shared — Zod schemas + types
│       └── src/schemas/
│           ├── user.ts
│           ├── thread.ts
│           └── schedule.ts
├── scripts/                      # dev-kill, dev-restart
├── sql/default/                  # Flyway migrations (V1.0.0–V1.0.6)
├── docker-compose.yml            # postgres:17 + redis:7 ONLY
├── flyway.conf
├── turbo.json
├── biome.json
├── pnpm-workspace.yaml
└── tsconfig.base.json
```

## API endpoints

| Method | Path | Description |
|---|---|---|
| `GET` | `/health` | Health check (api + postgres + redis) |
| `GET` | `/users` | List users |
| `GET` | `/users/:id` | Get one user |
| `POST` | `/users` | Create user — body: `{ email, name }` |
| `PATCH` | `/users/:id` | Update user — body: `{ email?, name? }` |
| `DELETE` | `/users/:id` | Delete user |
| `GET` | `/threads` | List chat threads |
| `POST` | `/threads` | Create thread — body: `{ title? }` (default: "New chat") |
| `GET` | `/threads/:id` | Get thread + full message history (from LangGraph state) |
| `PATCH` | `/threads/:id` | Rename thread — body: `{ title }` |
| `DELETE` | `/threads/:id` | Delete thread + all LangGraph checkpoint state |
| `POST` | `/threads/:id/messages` | Send a message — body: `{ content, deepResearch? }` → **202**; the detached worker run streams via `GET /threads/:id/events`. 409 if a run is already active. |
| `POST` | `/threads/:id/cancel` | Cancel the active run — worker aborts, rewinds the cancelled turn (removed from history), publishes `cancelled`. |

**Try it:**
```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","name":"Alice"}'
curl http://localhost:3000/users

# Create a chat thread and talk to the agent (detached: 202 + jobId)
THREAD_ID=$(curl -s -X POST http://localhost:3000/threads \
  -H 'Content-Type: application/json' -d '{}' | jq -r .id)

# Subscribe to the event stream (tokens/thinking/tools stream here)
curl -N http://localhost:3000/threads/$THREAD_ID/events &

curl -s -X POST http://localhost:3000/threads/$THREAD_ID/messages \
  -H 'Content-Type: application/json' \
  -d '{"content":"Hello, who are you?"}'
# → {"jobId":"chat-..."} 202; watch the answer stream on the events connection

# Cancel the active run
curl -X POST http://localhost:3000/threads/$THREAD_ID/cancel
```

**Detached execution:** runs are tied to the BullMQ job, not the HTTP connection — refreshing or closing the tab never kills a generation; the answer lands in the thread on completion. Sending while a run is active returns 409; stop it first (cancel endpoint / UI Stop button), which also rewinds the cancelled turn so your next message starts with clean context.

## AI Agent (LangGraph)

The agent is a LangGraph graph (`apps/api/src/agent/`) backed by any **OpenAI-compatible** LLM, with state persisted to Postgres via `@langchain/langgraph-checkpoint-postgres`. Each thread is a resumable conversation identified by a UUID.

### Supported providers

All expose an OpenAI-compatible `/chat/completions` API. Pick one via `LLM_PROVIDER`:

| `LLM_PROVIDER` | Base URL (international) | Default model | Where to get a key |
|---|---|---|---|
| `glm` (default) | `https://api.z.ai/api/paas/v4` | `glm-5.2` | https://z.ai |
| `minimax` | `https://api.minimax.io/v1` | `MiniMax-M3` | https://www.minimax.io |
| `mimo` | `https://token-plan-sgp.xiaomimimo.com/v1` (Singapore) | `mimo-v2.5-pro` | Xiaomi MiMo portal (Singapore region, `tp-` keys) |
| `custom` | `http://localhost:11434/v1` (Ollama) | `gpt-4o-mini` | Bring your own — OpenRouter, Together, vLLM, Ollama, etc. |

> 🌐 **International-first:** all Chinese providers default to their international endpoint. China alternatives (e.g. `open.bigmodel.cn`, `api.minimax.chat`, `api.moonshot.cn`) are documented in [`docs/llm-providers.md`](./docs/llm-providers.md) — override with `LLM_BASE_URL` if you need them.

Override any provider default with `LLM_BASE_URL` and `LLM_MODEL`.

### Configuration

Required env (see `.env.example`):
```
LLM_PROVIDER=glm          # glm | minimax | mimo | custom
LLM_API_KEY=your-key      # required
# LLM_BASE_URL=...        # override provider default
# LLM_MODEL=...           # override provider default
```

### Architecture notes

- **Detached execution**: `POST /threads/:id/messages` returns `202 + jobId`; the BullMQ worker runs the agent and streams via Redis pub/sub → `GET /threads/:id/events` (SSE events: `stream-start`, `thinking-start/token`, `tool-call/result`, `token`, `stream-done`, `cancelled`, `error`, `sub-progress`, `thread-updated`)
- **State persistence**: Postgres tables (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`) auto-created on first run
- **Adding a new provider**: add an entry to `PROVIDER_DEFAULTS` in `apps/api/src/agent/constants.ts` + the `LLM_PROVIDERS` tuple. As long as the provider is OpenAI-compatible, that's all. See [`docs/llm-providers.md`](./docs/llm-providers.md) for a full reference of trending models, base URLs, and model IDs across 30+ providers.
- **Adding tools**: add a tool factory in `apps/api/src/agent/tools/` and register it in `tools/index.ts` (`buildTools`). The guarded tool node (`toolPolicy.ts`) handles dedup replay, Deep Research toggle enforcement, and parallel batch execution automatically.

## Adding a database migration

```bash
# Create new migration file (follow Flyway naming convention — next free version)
touch sql/default/V1.0.7__add_accounts_table.sql

# Edit the file with your SQL, then apply
flyway -configFiles=./flyway.conf migrate
```

## Why two Redis clients in the API?

- **`node-redis`** (the `redis` package) — general-purpose Redis usage, per project convention.
- **`ioredis`** — required internally by **BullMQ** (its hard dependency for background jobs).

Both connect to the same Redis instance; this is the standard pattern and uses only 2 connections.

## Production deployment

Both apps are dockerized. Build images from repo root:

```bash
# Backend
podman build -f apps/api/Dockerfile -t asurada-api .

# Frontend (static files served by nginx)
podman build -f apps/web/Dockerfile -t asurada-web .
```

Deploy target is deferred — see Fly.io, Railway, Render, or any Docker host.

## Troubleshooting

**`podman: command not found`** — install via `brew install podman` and start the machine with `podman machine start`.

**`flyway: command not found`** — install via `brew install flyway`.

**Redis connection refused on `pnpm dev:api`** — make sure infra is up: `pnpm infra:up`.

**Port already in use / server won't die** — a detached (nohup) or orphaned `tsx watch` tree can hold :3000 unreachable from your terminal's Ctrl+C. Kill the FULL tree with:
```bash
pnpm dev:kill      # watchers + wrappers + node child, project-scoped (editor tsserver safe)
pnpm dev:restart   # clean kill + background start + health check (log: /tmp/asurada-api.log)
```
Killing only `lsof -ti:3000 | xargs kill` orphans the `tsx watch` parent, which lingers as a zombie and can stack up across restarts.

**Type errors after editing shared schemas** — rebuild shared package: `pnpm --filter @asurada/shared build`.
