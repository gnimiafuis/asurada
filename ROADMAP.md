# Roadmap

Living document — updated as priorities shift.

---

## Current State (shipped)

### Infrastructure
- [x] Monorepo: Turborepo + pnpm + TypeScript (strict, ESM, `.js` ext)
- [x] Lint/format: Biome
- [x] Test runner: Vitest (configured, no tests yet)
- [x] Docker Compose: postgres:17 + redis:7 (infra only, apps run host-side)
- [x] Flyway migrations: users + threads tables
- [x] Dockerfiles: multi-stage for both api + web
- [x] Podman support (podman compose)

### Backend (apps/api)
- [x] Hono + @hono/node-server
- [x] Pino structured logging (pino-pretty in dev)
- [x] pg (raw Postgres, no ORM)
- [x] node-redis v5
- [x] BullMQ + ioredis (background jobs — bootstrap only, no workers yet)
- [x] Zod env validation (Node --env-file)
- [x] Centralized error handler, request-id middleware
- [x] CORS, secure-headers
- [x] Graceful shutdown (SIGTERM/SIGINT)
- [x] Health endpoint (`/health`)

### AI Agent (LangGraph)
- [x] Tool-calling agent (agent → toolsCondition → ToolNode → agent loop)
- [x] Multi-provider LLM: GLM (Z.ai), MiniMax (.io), MiMo (Singapore), custom
  - All use OpenAI-compatible API via @langchain/openai
  - Provider registry in `apps/api/src/agent/constants.ts`
- [x] Model fallback chain (primary + fallbacks via LLM_FALLBACK_PROVIDERS)
- [x] System prompt in code (buildSystemPrompt function with fresh timestamp)
- [x] Error handling in callModel (graceful failure, no stream crash)
- [x] PostgresSaver checkpointing (conversation persistence)
- [x] Web search tools (conditional activation based on API keys):
  - DuckDuckGo (always on, free)
  - Tavily (1K searches/mo free)
  - Exa (1K searches/mo free)
  - Firecrawl (search + scrape)
- [x] Scheduled tasks (recurring + one-time via agent tool calls)
  - create_schedule, list_schedules, delete_schedule tools
  - delaySeconds (preferred), runAt (fallback), cron (recurring)
  - BullMQ repeatable + delayed jobs
  - Schedule labels + icons in UI
  - Countdown + auto-update + cancel from UI
- [x] Streaming: SSE with thinking, tool-call, tool-result, token, done events
- [x] Reasoning/thinking support (DeepSeek/MiniMax `reasoning_content`)
- [x] Retry logic with exponential backoff (fetchWithRetry)
- [x] Fetch timeouts on all tools
- [x] Client-disconnect handling (stream abort)
- [x] Recursion limit (10 — 5 tool-call rounds max)
- [x] Bootstrap tool status + model chain display
- [x] API + Worker split via ROLE env var (same Docker image)

### Frontend (apps/web)
- [x] Vite 6 + React 19 + React Router 7
- [x] Tailwind v4 + @tailwindcss/typography
- [x] shadcn/ui framework configured (components.json + cn util)
- [x] Light/dark/system theme (no-flash, localStorage, system detection)
- [x] Sidebar layout: thread list, search, rename (inline), delete, new
- [x] Chat UI: streaming, markdown rendering, syntax highlighting
- [x] Thinking dropdown (auto-expand while thinking, auto-collapse on answer)
- [x] Tool calls display (collapsible, shows results)
- [x] Smart scroll (stick-to-bottom, jump button when scrolled up)
- [x] Messenger-style layout (user right, assistant left with robot avatar)
- [x] Performance: React.memo + content-visibility for long conversations

### Shared (packages/shared)
- [x] Zod schemas: user, thread, message (with thinking)

---

## Architecture Decisions

### PostgresSaver vs Own Messages Table

**Current: PostgresSaver (keep for now)**

- Messages stored in LangGraph's checkpoint tables (opaque format)
- Loaded via `agent.getState()` — no direct SQL access
- Works correctly, conversations persist across restarts

**Decision: keep PostgresSaver, migrate later when there's a concrete need.**

Triggers for migration:
- Need `SELECT`-level access to messages (search, analytics, export)
- 10K+ conversations and checkpoint bloat impacts DB costs
- Want to decouple from LangGraph

Migration path when ready:
1. Add `messages` table (thread_id, role, content, thinking, tool_calls, tool_results)
2. Save each message via `INSERT` after agent responds
3. Load via `SELECT` instead of `agent.getState()`
4. Switch graph from `PostgresSaver` to `MemorySaver`
5. One-time script to migrate existing checkpoint data

---

## Phase 1 — Ship-Ready

**Goal:** real product, real users, real deployment.

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 1 | Stop generation button | S | ⬜ | Cancel mid-stream. Most jarring missing UX. |
| 2 | Regenerate response | S | ⬜ | Retry with same prompt if answer was bad. |
| 3 | Auth (email/password + JWT) | M | ⬜ | Can't ship multi-user without it. |
| 4 | Per-user thread isolation | S | ⬜ | `WHERE user_id = $1` on all queries. |
| 5 | Mobile responsive layout | M | ⬜ | Sidebar → drawer on small screens. |
| 6 | Deploy (Fly.io or Railway) | M | ⬜ | Get it live. |

---

## Phase 2 — Product Polish

**Goal:** product people enjoy using daily.

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 7 | Model switching per thread | S | ⬜ | Pick GLM vs MiniMax vs MiMo per conversation. |
| 8 | Edit & resend previous message | S | ⬜ | Fix typos without new thread. |
| 9 | Export conversation (Markdown/JSON) | S | ⬜ | Save/share conversations. |
| 10 | Search across threads | S | ⬜ | Find old conversations. |
| 11 | System prompt customization | S | ⬜ | Per-thread or per-user persona. |
| 12 | Rate limiting (per user) | S | ⬜ | Prevent abuse once public. |
| 13 | Keyboard shortcuts | S | ⬜ | Cmd+K new thread, Esc stop, etc. |
| 14 | **Prompt caching** | S | ⬜ | Cache system prompt + early messages to cut cost and latency on long conversations. Most providers support it natively or via prefix matching. |
| 15 | **Embeddings infrastructure** | M | ⬜ | Set up embedding generation for messages/threads (pgvector). Foundation for semantic search, RAG, and agent memory. |

---

## Phase 3 — Growth & Monetization

**Goal:** revenue-generating SaaS.

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 16 | Usage tracking + quotas | M | ⬜ | Track API calls per user. Basis for billing. |
| 17 | Stripe integration | M | ⬜ | Free tier + paid tiers. |
| 18 | Share thread via public link | M | ⬜ | Viral growth. |
| 19 | Admin dashboard | S | ⬜ | Users, threads, usage, revenue. |
| 20 | Email notifications | S | ⬜ | Welcome, quota warnings, receipts. |

---

## Phase 4 — Advanced Agent

**Goal:** differentiated product, not just another chat wrapper.

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 21 | Migrate to own messages table | M | ⬜ | Full SQL control, drop LangGraph lock-in. |
| 22 | RAG / knowledge base | L | ⬜ | Upload docs, agent searches them (pgvector + embeddings). |
| 23 | More tools | M | ⬜ | Calculator, code execution, image gen, calendar. |
| 24 | Multi-agent orchestration | L | ⬜ | Researcher + writer + reviewer pipeline. |
| 25 | Agent memory (cross-thread) | M | ⬜ | Remember user preferences across conversations (embeddings-based). |
| 26 | Human-in-the-loop approval | S | ⬜ | Confirm before sensitive tool calls. |
| 27 | Scheduled / triggered runs | M | ✅ | Cron + one-time (delaySeconds) via agent tool calls + BullMQ. |

---

## Legend

- **Effort:** S = half day, M = 1-3 days, L = 1+ week
- **Status:** ✅ done, ⬜ todo, 🚫 deferred/skipped
