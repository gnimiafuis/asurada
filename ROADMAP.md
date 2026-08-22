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

Reference set: ChatGPT (memory, canvas, code interpreter, connectors, GPTs), Claude (artifacts, projects/KD, computer use, MCP), Perplexity (search modes), Manus (VM + multi-agent), Devin (autonomous workspace), OpenClaw/Claude Code (harness + subagents). The table below maps those capabilities to our stack.

| Capability | What it is | Our implementation path |
|---|---|---|
| **Memory** | Persistent user facts/preferences across threads | LangGraph Store API or custom pgvector table |
| **Knowledge base / RAG** | Upload docs → chat with them, per-project | pgvector + chunking + embedding tool |
| **MCP client** | Connect ANY external MCP server (files, GitHub, DBs, browsers) | `@langchain/langgraph-mcp` adapter → tools appear dynamically |
| **Code execution** | Sandboxed Python/JS runner for analysis | E2B / Deno Deploy sandbox as a tool |
| **Vision / file chat** | Upload image/PDF/doc → agent reads it | Multimodal message content (image_url) + upload endpoint |
| **Subagents** | Orchestrator spawns specialized workers (deep research) | LangGraph subgraph as a tool |
| **Artifacts / canvas** | Side panel for code/docs that updates live | Frontend panel + artifact-emitting tool |
| **Voice mode** | STT → agent → TTS streaming | Web Speech API + provider TTS |
| **Browser use** | Agent drives a real browser | Playwright + MCP browser server |
| **Custom agents / GPTs** | User-defined personas + tool sets, shareable | Agent config table + builder UI |
| **Actions / integrations** | Gmail, Calendar, Slack connectors | MCP servers cover most; OAuth for the rest |

---

## Phase 0 — Foundation (ship-ready table stakes)

Small, required before anything else matters on a live URL.

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 0.1 | Stop generation button | S | ⬜ | Server abort exists; needs UI only. |
| 0.2 | Message trimming + maxTokens | S | ⬜ | Cost safety — full history sent every call today. |
| 0.3 | Deploy (Fly.io or Railway) | M | ⬜ | Dockerfiles + ROLE split done. |
| 0.4 | Auth (email/password + JWT) + per-user isolation | M | ⬜ | Multi-user gate. |
| 0.5 | Mobile responsive (sidebar → drawer) | M | ⬜ | Half of all usage. |

---

## Phase 1 — Agent Core (the features that make it an agent platform)

**Goal: match the baseline capabilities users expect from any serious agent product.**

| # | Feature | Effort | Status | Why it's core |
|---|---|---|---|---|
| 1.1 | **Long-term memory** | M | ⬜ | The #1 differentiator between "chat wrapper" and "agent". Remember name, preferences, ongoing projects across ALL threads. Implementation: memory extraction after each exchange → pgvector store → inject relevant memories into system prompt per query. |
| 1.2 | **MCP client support** | M | ⬜ | Force multiplier: one feature adds hundreds of tools (GitHub, filesystem, browser, DBs, Slack…). Config: MCP_SERVERS env or per-thread UI → tools registered dynamically at agent build. This is how we escape building every integration by hand. |
| 1.3 | **File uploads + document chat (RAG)** | L | ⬜ | Upload PDF/txt/md/docx → chunk → embed → pgvector → agent searches user docs via a `search_documents` tool. Per-thread scope now, projects later. |
| 1.4 | **Code execution sandbox** | M | ⬜ | "Analyze this data", "compute X", "plot Y" — agents without execution feel dumb. E2B (managed) or Deno Deploy sandbox as a `run_code` tool. Pairs with scheduling: "every morning crunch this API and summarize". |
| 1.5 | **Vision (image understanding)** | M | ⬜ | Upload/paste image → multimodal message content → all our providers (GLM/MiniMax/MiMo) have vision models. Unlocks screenshot debugging, chart reading, OCR-ish flows. |

**Recommended order: 1.1 → 1.2 → 1.3 → 1.4 → 1.5** (memory has zero infra deps; MCP unlocks the most; RAG needs pgvector; sandbox + vision are additive)

---

## Phase 2 — Experience (feel like a flagship product)

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 2.1 | **Artifacts / canvas panel** | M | ⬜ | Claude-style side panel for code blocks, long docs, generated files. Tool output tagged as artifact → renders in panel, editable, versioned per turn. Transforms chat→workspace. |
| 2.2 | **Deep research subagent** | M | ⬜ | `deep_research` tool spawns a subgraph: plan → parallel searches (fan-out) → synthesize. LangGraph-native (supervisor pattern). Combined with 1.4 = real analyst workflows. |
| 2.3 | **Scheduled digests with artifacts** | S | ⬜ | Extension of existing scheduling: morning report arrives as formatted artifact + push (email/Telegram). Scheduling infra is done — this is productization. |
| 2.4 | **Voice mode** | M | ⬜ | Web Speech API STT (free) → agent → provider TTS. Push-to-talk first, full-duplex later. |
| 2.5 | Model switching per thread + prompt customization | S | ⬜ | Pick GLM/MiniMax/MiMo + custom system prompt per thread. |
| 2.6 | Edit & resend · regenerate · export (MD/JSON) · thread search | S | ⬜ | The polish bundle from the old roadmap. |
| 2.7 | Rate limiting + prompt caching | S | ⬜ | Cost control once public. |

---

## Phase 3 — Platform (multi-user product & revenue)

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 3.1 | **Custom agents / personas (GPTs-style)** | M | ⬜ | Users create named agents (system prompt + tool toggles + knowledge files), shareable by link. Turns the app into a platform. Builds on 1.3 + 2.5. |
| 3.2 | **Projects / teamspaces** | M | ⬜ | Group threads + shared knowledge base per project. Claude Projects equivalent. |
| 3.3 | Usage tracking + quotas | M | ⬜ | Token/search/sandbox-seconds metering per user → billing basis. |
| 3.4 | Stripe (free tier + paid) | M | ⬜ | Monetization. |
| 3.5 | Public share links for threads/artifacts | S | ⬜ | Viral loop. |
| 3.6 | Admin dashboard + email notifications | S | ⬜ | Ops. |

---

## Phase 4 — Frontier (differentiators)

| # | Feature | Effort | Status | Why |
|---|---|---|---|---|
| 4.1 | **Browser automation** | L | ⬜ | Playwright-driven browsing agent (via MCP browser server) — "watch this price page and alert me" pairs with scheduling. |
| 4.2 | **Multi-agent orchestration** | L | ⬜ | Beyond one subagent: supervisor + specialized workers (researcher/writer/critic) with streaming progress. |
| 4.3 | **Proactive agent behaviors** | M | ⬜ | Agent-initiated: anomaly alerts, follow-ups on past tasks ("you asked about X yesterday — it changed"). Scheduling + memory combined. |
| 4.4 | Agent memory graph (relational, not just vector) | M | ⬜ | Entities + relations (Mem0/Letta-style) instead of flat memory snippets. |
| 4.5 | Own messages table migration | M | ⬜ | SQL access to messages (search/export/analytics), drop LangGraph checkpoint lock-in. Trigger: Phase 3 analytics needs. |

---

## Legend

- **Effort:** S = half day, M = 1-3 days, L = 1+ week
- **Status:** ✅ done, ⬜ todo, 🚫 deferred
