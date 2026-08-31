# Roadmap

Living document — updated as priorities shift.

---

## Current State (shipped)

### Infrastructure
- [x] Monorepo: Turborepo + pnpm + TypeScript (strict, ESM, `.js` ext)
- [x] Lint/format: Biome · Vitest (configured)
- [x] Docker Compose: postgres:17 + redis:7 · Flyway migrations (V1.0.6)
- [x] Multi-stage Dockerfiles (api + web) · API/Worker split via ROLE
- [x] Podman support

### Backend (apps/api)
- [x] Hono · Pino (structured, TTFT/TPS stream metrics) · pg (raw) · node-redis · BullMQ
- [x] Zod env validation · error handler + request-id · CORS · graceful shutdown · /health

### AI Agent (LangGraph)
- [x] Tool-calling agent loop · multi-provider LLM + fallback chain (GLM/MiniMax/MiMo/custom)
- [x] Web search tools: Tavily, Exa, Firecrawl (search+scrape), DuckDuckGo — conditional on API keys
- [x] Scheduled tasks: delay_task (one-time) + repeat_task (interval & cron+timezone) with mandatory confirmation gate, labels, per-second countdown, UI/chat cancel, ghost-job cleanup
- [x] Real-time delivery: Redis pub/sub → SSE, scheduled results stream token-by-token
- [x] Duplicate tool-call replay (custom ToolNode — zero API cost on repeats)
- [x] Live token streaming · reasoning/thinking support · retries + timeouts + truncation
- [x] Client-disconnect abort · recursion guard (25) · token usage logging

### Frontend (apps/web)
- [x] Vite 6 + React 19 + React Router 7 · Tailwind v4 + shadcn framework
- [x] Light/dark/system theme · sidebar (search/rename/delete) · streaming markdown chat + syntax highlighting
- [x] Thinking dropdown (auto-expand/collapse) · tool panels · smart scroll · pending bubble
- [x] Performance: React.memo + content-visibility

### Shared (packages/shared)
- [x] Zod schemas: user, thread, message, schedule

---

## What Modern Agent Platforms Ship (2026 landscape)

Reference set: ChatGPT (memory, canvas, code interpreter, connectors, GPTs), Claude (artifacts, projects/KD, computer use, MCP), Perplexity (search modes), Manus (VM + multi-agent), Devin (autonomous workspace), OpenClaw/Claude Code (harness + subagents).

| Capability | What it is | Our implementation path |
|---|---|---|
| **Memory** | Persistent user facts/preferences across threads | pgvector memory store → inject into system prompt |
| **Knowledge base / RAG** | Upload docs → chat with them, per-project | pgvector + chunking + embedding tool |
| **MCP client** | Connect ANY external MCP server (files, GitHub, DBs, browsers) | `@langchain/langgraph-mcp` adapter → tools appear dynamically |
| **Code execution** | Sandboxed Python/JS runner for analysis | E2B / Deno Deploy sandbox as a tool |
| **Vision / file chat** | Upload image/PDF/doc → agent reads it | Multimodal message content + upload endpoint |
| **Subagents** | Orchestrator spawns specialized workers (deep research) | LangGraph subgraph as a tool |
| **Artifacts / canvas** | Side panel for code/docs that updates live | Frontend panel + artifact-emitting tool |
| **Voice mode** | STT → agent → TTS streaming | Web Speech API + provider TTS |
| **Browser use** | Agent drives a real browser | Playwright + MCP browser server |
| **Custom agents / GPTs** | User-defined personas + tool sets, shareable | Agent config table + builder UI |
| **Actions / integrations** | Gmail, Calendar, Slack connectors | MCP servers cover most; OAuth for the rest |

---

## Dependency Map (drives the order below)

```
0.3 auth ──┬── 0.4 rate limiting ── 0.5 deploy (public URL without both = credit-burning risk)
           ├── 1.1 memory (per-user keying)
           ├── 2.7 usage metering → 3.4 Stripe
           └── 3.1 custom agents · 3.2 teamspaces

1.0 infra prep (pgvector + embedding client + upload/storage)
    ├── 1.1 memory ──┬── 4.3 proactive behaviors
    │                └── 4.4 relational memory graph
    ├── 1.3 RAG ─────── 3.1 custom agents (knowledge files)
    └── 1.4 vision (shares upload endpoint + UI)

1.2 MCP client ── 4.1 browser automation (easiest path: MCP browser server)
2.1 artifacts ── 2.3 scheduled digest artifacts
2.2 subagent ─── 4.2 multi-agent orchestration
4.5 messages table ── enables full-text thread search (2.6) + analytics (3.x)
```

Key corrections vs previous ordering:
- **Auth must precede deploy** — a public LLM app without auth + rate limiting invites instant API-credit abuse.
- **Memory is NOT dependency-free** — it needs pgvector + an embedding provider + auth (per-user keying). Previously mis-ranked as first.
- **pgvector + embeddings + upload/storage are shared infra** for memory, RAG, and vision — build once as 1.0.
- **Vision shares upload infra with RAG** — do immediately after, not last.
- **Sandbox has zero deps** — genuinely parallelizable anytime.

---

## Phase 0 — Foundation (ship-ready table stakes)

| # | Feature | Effort | Status | Depends on | Why |
|---|---|---|---|---|---|
| 0.1 | Stop generation button | S | ✅ | — | Shipped (e6c6760): send↔stop morph + Esc; kills stream AND in-flight deep_research (verified zero zombie tokens). |
| 0.2 | Message trimming + maxTokens | S | ⬜ | — | Cost safety — deep research reports (~4KB each) persist in history and re-send on every call. URGENT now. |
| 0.3 | Auth (email/password + JWT) + per-user isolation | M | ⬜ | — | **Moved up**: dependency of memory, rate limiting, usage metering, custom agents, teamspaces. |
| 0.4 | Basic rate limiting (per user/IP) | S | ⬜ | 0.3 | **Pulled forward from Phase 2**: public deploy without it = abuse. |
| 0.5 | Deploy (Fly.io or Railway) | M | ⬜ | 0.3, 0.4 | After auth + rate limit so the live URL can't burn credits. Pick a platform with managed pgvector (Neon/Supabase/Fly PG) — needed in Phase 1. |
| 0.6 | Mobile responsive (sidebar → drawer) | M | ⬜ | — | Half of all usage. Can slip past deploy if needed. |

**Order: 0.1 → 0.2 → 0.3 → 0.4 → 0.5 → 0.6** (0.6 parallelizable)

---

## Phase 1 — Agent Core (the features that make it an agent platform)

**Goal: match the baseline capabilities users expect from any serious agent product.**

| # | Feature | Effort | Status | Depends on | Why it's core |
|---|---|---|---|---|---|
| 1.0 | **Infra prep: pgvector + embedding client + file upload/storage** | M | ⬜ | 0.5 (pgvector on managed PG) | Shared foundation for memory, RAG, and vision — build once. Embeddings via GLM/MiniMax/SiliconFlow (OpenAI-compatible `/embeddings`). Upload: local disk now, S3-compatible later. |
| 1.1 | **Long-term memory** | M | ⬜ | 1.0, 0.3 | The #1 differentiator between "chat wrapper" and "agent". Memory extraction after each exchange → pgvector store keyed by user → inject relevant memories into system prompt. Also unlocks 4.3 + 4.4 later. |
| 1.2 | **MCP client support** | M | ⬜ | — (parallel-safe) | Force multiplier: one feature adds hundreds of tools (GitHub, filesystem, DBs, Slack…). Config via MCP_SERVERS env → tools registered at agent build. No deps — can run in parallel with 1.1. Also the easy path for 4.1 browser later. |
| 1.3 | **File uploads + document chat (RAG)** | L | ⬜ | 1.0 | Upload PDF/txt/md/docx → chunk → embed → pgvector → `search_documents` tool. Per-thread scope now, projects later. Reuses 1.0 upload + embeddings. |
| 1.4 | **Vision (image understanding)** | M | ⬜ | 1.0 (upload), after 1.3 (shares upload UI) | Image upload/paste → multimodal `image_url` content blocks → GLM/MiniMax/MiMo vision models. Screenshot debugging, chart reading. |
| 1.5 | **Code execution sandbox** | M | ⬜ | — (zero deps, anytime) | "Analyze this data", "plot Y" — agents without execution feel dumb. E2B or Deno Deploy as `run_code` tool. Pairs with existing scheduling for recurring analysis. |

**Order: 1.0 → (1.1 ∥ 1.2) → 1.3 → 1.4** · 1.5 parallel anytime.

---

## Phase 2 — Experience (feel like a flagship product)

| # | Feature | Effort | Status | Depends on | Why |
|---|---|---|---|---|---|
| 2.1 | **Artifacts / canvas panel** | M | ⬜ | — | Claude-style side panel for code blocks, long docs, generated files — editable, versioned per turn. Transforms chat → workspace. Prereq for 2.3. |
| 2.2 | **Deep research subagent** | M | ✅ | — | Shipped: plan→parallel fan-out→synthesize, kill-safe (abort-chained), live sub-progress in UI, per-request ON/OFF toggle with deterministic policy enforcement, DR toggle UI, parallel batch tool execution, TTFT/TPS metrics. |
| 2.3 | **Scheduled digests with artifacts** | S | ⬜ | 2.1 | Morning report as formatted artifact + push (email/Telegram). Scheduling infra done — pure productization. |
| 2.4 | **Voice mode** | M | ⬜ | — | Web Speech API STT (free) → agent → provider TTS. Push-to-talk first. |
| 2.5 | Model switching per thread + prompt customization | S | ⬜ | — | Prereq for 3.1 custom agents. |
| 2.6 | Edit & resend · regenerate · export (MD/JSON) · thread search | S | ⬜ | full-text search needs 4.5 | Do edit/regenerate/export early; scope thread search to titles until 4.5 lands. |
| 2.7 | Prompt caching | S | ⬜ | — | Cost/latency cut on long conversations. (Rate limiting moved to 0.4.) |

---

## Phase 3 — Platform (multi-user product & revenue)

| # | Feature | Effort | Status | Depends on | Why |
|---|---|---|---|---|---|
| 3.1 | **Custom agents / personas (GPTs-style)** | M | ⬜ | 0.3, 2.5, 1.3 | Named agents (prompt + tool toggles + knowledge files), shareable by link. Turns the app into a platform. |
| 3.2 | **Projects / teamspaces** | M | ⬜ | 0.3, 1.3 | Group threads + shared knowledge base per project. Claude Projects equivalent. |
| 3.3 | Usage tracking + quotas | M | ⬜ | 0.3 | Token/search/sandbox-seconds metering per user. Token logging exists — needs persistence. |
| 3.4 | Stripe (free tier + paid) | M | ⬜ | 3.3 | Bill against the quotas 3.3 defines. |
| 3.5 | Public share links for threads/artifacts | S | ⬜ | — | Viral loop. |
| 3.6 | Admin dashboard + email notifications | S | ⬜ | 3.3 | Ops on top of usage data. |

---

## Phase 4 — Frontier (differentiators)

| # | Feature | Effort | Status | Depends on | Why |
|---|---|---|---|---|---|
| 4.1 | **Browser automation** | L | ⬜ | 1.2 (MCP browser server) | Playwright-driven browsing — "watch this price page and alert me" pairs with scheduling. |
| 4.2 | **Multi-agent orchestration** | L | ⬜ | 2.2 | Supervisor + specialized workers (researcher/writer/critic) with streaming progress. |
| 4.3 | **Proactive agent behaviors** | M | ⬜ | 1.1 | Agent-initiated: anomaly alerts, follow-ups ("you asked about X yesterday — it changed"). Memory + scheduling combined. |
| 4.4 | Relational memory graph | M | ⬜ | 1.1 | Entities + relations (Mem0/Letta-style) beyond flat vector memory. |
| 4.5 | Own messages table migration | M | ⬜ | — (pull forward when 2.6/3.x need it) | SQL access to messages (full-text search, export, analytics), drops LangGraph checkpoint lock-in. |

---

## Legend

- **Effort:** S = half day, M = 1-3 days, L = 1+ week
- **Status:** ✅ done, ⬜ todo, 🚫 deferred
