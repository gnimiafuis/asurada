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
│   │   │   │   ├── queue.ts      # BullMQ queue + worker
│   │   │   │   └── errors.ts     # HttpError classes
│   │   │   ├── middleware/
│   │   │   │   ├── error.ts      # centralized error handler
│   │   │   │   └── requestId.ts
│   │   │   └── routes/
│   │   │       ├── health.ts     # GET /health
│   │   │       └── users.ts      # CRUD sample: /users
│   │   └── Dockerfile            # multi-stage, pnpm fetch
│   └── web/                      # @asurada/web — Vite frontend
│       ├── src/
│       │   ├── main.tsx
│       │   ├── App.tsx
│       │   ├── router.tsx        # React Router config
│       │   ├── pages/
│       │   ├── lib/utils.ts      # cn() helper for shadcn/ui
│       │   └── styles/globals.css
│       ├── components.json       # shadcn/ui config
│       ├── nginx.conf            # SPA fallback for prod image
│       └── Dockerfile            # multi-stage → nginx
├── packages/
└── shared/                       # @asurada/shared — Zod schemas + types
    └── src/schemas/
        └── user.ts
├── sql/default/                  # Flyway migrations
│   └── V1.0.0__init.sql
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

**Try it:**
```bash
curl http://localhost:3000/health
curl -X POST http://localhost:3000/users \
  -H 'Content-Type: application/json' \
  -d '{"email":"alice@example.com","name":"Alice"}'
curl http://localhost:3000/users
```

## Adding shadcn/ui components

```bash
cd apps/web
pnpm dlx shadcn@latest add button input card dialog
```

Components land in `apps/web/src/components/ui/`.

## Adding a database migration

```bash
# Create new migration file (follow Flyway naming convention)
touch sql/default/V1.0.1__add_accounts_table.sql

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

**Port already in use** — check `.env` (`PORT=3000`) and `apps/web/vite.config.ts` (`port: 5173`).

**Type errors after editing shared schemas** — rebuild shared package: `pnpm --filter @asurada/shared build`.
