# Roadmap

Living document — updated as priorities shift. **Agent-feature-first**: the agent's capabilities drive the order; infrastructure is an enabler, not the goal.

---

## Current State (shipped)

### Agent capabilities
- [x] Tool-calling agent loop · **parallel batch execution** (Promise.allSettled, order-preserving, per-call error capture)
- [x] **Tool policy layer** (`agent/toolPolicy.ts`): duplicate replay (zero API cost), batch-sibling dedup, Deep Research toggle enforcement (deterministic on/off guards)
- [x] **Deep research subagent**: plan → parallel fan-out → synthesize; kill-safe (abort-chained to planner/synthesis sockets), live sub-progress in UI, per-request ON/OFF toggle
- [x] **Scheduled tasks**: delay_task (one-time, seconds-based) + repeat_task (interval & cron+timezone) with mandatory user confirmation gate, labels, per-second countdown, cancel via chat or UI, ghost-job cleanup script
- [x] **Detached execution**: interactive messages run as BullMQ jobs — refresh/close never kills a generation; cancel = full checkpoint rewind (RemoveMessage); one-active-run-per-thread (409); BullMQ jobId dedup + pre-add sweep + busy watchdog (4-layer stuck-busy defense)
- [x] Multi-provider LLM + fallback chain (GLM / MiniMax / MiMo / custom — all OpenAI-compatible)
- [x] Web search tools: Tavily, Exa, Firecrawl (search+scrape), DuckDuckGo — conditional on API keys
- [x] Per-thread checkpoint memory (PostgresSaver) — conversations resume across restarts
- [x] **Context management**: per-call view shaping (`agent/context.ts`) — 24K budget, last-2-turns verbatim floor, old tool results truncated to 400 chars, orphan-safe drops; per-call-type output caps via `MAX_OUTPUT_TOKENS` JSON env (agent 8192 / deep-research synthesis 16384, planner 1024)
- [x] Live token streaming · reasoning/thinking support (replay/collapse UX) · retries + timeouts + result truncation · recursion guard · token usage logging · TTFT/TPS stream metrics
- [x] Error paths rewind failed turns; history hides tool-call-only bubbles

### Frontend (apps/web)
- [x] Vite 6 + React 19 + React Router 7 · Tailwind v4 · light/dark/system theme (no-flash)
- [x] Sidebar (search/rename/delete/schedule badges) · streaming markdown + syntax highlighting
- [x] Thinking dropdown · tool-call panels · smart scroll · pending bubble · input autofocus after responses
- [x] Stop generation (send↔stop morph + Esc)
- [x] Performance: React.memo + content-visibility for long conversations

### Infrastructure
- [x] Monorepo: Turborepo + pnpm + TypeScript (strict, ESM) · Biome · Podman
- [x] Hono · Pino · pg (raw) · node-redis + ioredis · BullMQ (worker concurrency 10)
- [x] Redis pub/sub → SSE events channel (interactive + scheduled unified)
- [x] Detached worker (ROLE=api|worker|all) · unified schedule job registration (`lib/scheduleJobs.ts`)
- [x] Docker Compose (postgres:17 + redis:7) · Flyway V1.0.6 · dev:kill/dev:restart tooling · repo-wide cleanup pass

---

## What Modern Agent Platforms Ship (2026 landscape)

Reference set: ChatGPT (memory, canvas, code interpreter, connectors, GPTs), Claude (artifacts, projects/KD, computer use, MCP), Perplexity (search modes), Manus (VM + multi-agent), Devin (autonomous workspace), OpenClaw/Claude Code (harness + subagents).

**We have:** tool calling, sub-agent, scheduling, streaming, search suite
**We lack:** memory, RAG, MCP, code execution, vision, artifacts, voice, browser, multi-agent, proactive behavior, custom personas

---

## Track A — Agent Core *(make it smarter — the priority)*

| # | Feature | Effort | Status | Depends on | Why |
|---|---|---|---|---|---|
| A1 | **Context management** (trimming + maxTokens) | S | ✅ | — | `agent/context.ts` (24K budget, last-2-turns verbatim floor, asymmetric old-tool-result truncation, orphan-safe drops) + `MAX_OUTPUT_TOKENS` JSON env `{"agent":8192,"deep_research":16384}` (fail-fast Zod). Checkpoint keeps full history — memory/dedup/rewind unaffected. 11-scenario unit suite + live-verified. |
| A2 | **MCP client support** | M | ⬜ NEXT | — (zero deps, parallel-safe) | Force multiplier: one feature adds hundreds of tools (GitHub, filesystem, DBs, Slack…). Config via `MCP_SERVERS` env → tools registered at agent build. Also the easy path for browser automation later. |
| A3 | **Infra prep**: pgvector + embedding client + file upload/storage | M | ⬜ | — | Shared foundation for memory / RAG / vision — build once. Embeddings via GLM/MiniMax/SiliconFlow (OpenAI-compatible `/embeddings`). Upload: local disk now, S3-compatible later. |
| A4 | **Long-term memory** | M | ⬜ | A3 | The #1 "chat wrapper vs agent" differentiator. Memory extraction after each exchange → pgvector store → inject relevant memories into system prompt. **Plan: single-user/global keying first; re-key per-user when auth lands** *(decision flagged)*. Unlocks proactive behaviors + memory graph later. |
| A5 | **Document chat (RAG)** | L | ⬜ | A3 | Upload PDF/txt/md/docx → chunk → embed → pgvector → `search_documents` tool. Per-thread scope now, projects later. |
| A6 | **Vision (image understanding)** | M | ⬜ | A3 (shares upload) | Image upload/paste → multimodal `image_url` blocks → GLM/MiniMax/MiMo vision models. Screenshot debugging, chart reading. |
| A7 | **Code execution sandbox** | M | ⬜ | — (anytime) | `run_code` tool (E2B or Deno Deploy). Pairs with scheduling for recurring analysis. |

**Order: A1 → (A2 ∥ A3) → A4 → A5** · A6/A7 anytime in parallel.

## Track B — Agent Experience *(make it flagship)*

| # | Feature | Effort | Status | Depends on |
|---|---|---|---|---|
| B1 | Edit & resend · regenerate | S | ⬜ | — (rewind infra already built — near-free) |
| B2 | Model switching per thread + custom prompts | S | ⬜ | — |
| B3 | Artifacts / canvas panel | M | ⬜ | — |
| B4 | Scheduled digest artifacts | S | ⬜ | B3 |
| B5 | Export conversations (MD/JSON) | S | ⬜ | — |
| B6 | Voice mode (Web Speech STT → agent → TTS) | M | ⬜ | — |
| B7 | Proactive behaviors ("you asked about X — it changed") | M | ⬜ | A4 |

## Track C — Agent Platform *(make it a product)*

| # | Feature | Effort | Status | Depends on |
|---|---|---|---|---|
| C1 | Custom agents / personas (GPTs-style, shareable) | M | ⬜ | B2, F1 |
| C2 | Projects / teamspaces + shared knowledge base | M | ⬜ | A5, F1 |
| C3 | Multi-agent orchestration (supervisor + workers) | L | ⬜ | — |
| C4 | A2A protocol | M | ⬜ | — |

## Foundation sidebar *(enablers — pull in when a track needs them, not before)*

| # | Feature | Effort | Status | Unblocks |
|---|---|---|---|---|
| F1 | Auth (email/password + JWT) + per-user isolation | M | ⬜ | per-user memory keying (A4 upgrade), C1/C2 ownership |
| F2 | Rate limiting (per user/IP) | S | ⬜ | going public |
| F3 | Deploy (Fly.io/Railway, managed pgvector) + **Dockerfile fix** (HIGH finding: runner can't resolve `@asurada/shared`) | M | ⬜ | live URL |
| F4 | Mobile responsive (sidebar → drawer) | M | ⬜ | mobile usage |

**Deferred cleanup decisions (user call):** users CRUD removal · DB users table drop · vitest removal.

---

## Key architecture decisions (live)

- **PostgresSaver stays** for per-thread memory until RAG/analytics demand SQL message access → then own `messages` table migration.
- **Detached execution is permanent** — all streaming flows through Redis pub/sub → the single `/threads/:id/events` SSE channel. No request-tied generation.
- **Tool policy layer** (`toolPolicy.ts`) is the interception point for all future tool concerns (rate limits, HITL approval, new guards).
- **Memory without auth**: single-user/global first *(flagged for confirmation when A4 starts)*.

---

## Legend

- **Effort:** S = half day, M = 1–3 days, L = 1+ week
- **Status:** ✅ done, ⬜ todo, ⏸ deferred pending decision
