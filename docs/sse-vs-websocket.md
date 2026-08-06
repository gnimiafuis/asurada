# Real-Time Transport: SSE vs WebSocket

Decision document for choosing the real-time communication protocol.

---

## Current Architecture: SSE (2 connections)

```
Client                          Server
  │                               │
  │── POST /threads/:id/messages ─→  (SSE #1: streaming response)
  │←── tokens, thinking, tools ────│
  │                               │
  │── GET /threads/:id/events ────→  (SSE #2: persistent subscription)
  │←── new-message, thread-updated ─│  (stays open)
  │                               │
```

---

## Comparison

| | **SSE** (current) | **WebSocket** |
|---|---|---|
| **Direction** | Server → client only | Bidirectional (full duplex) |
| **Protocol** | HTTP (works everywhere) | ws:// (needs upgrade handshake) |
| **Client sends messages** | Separate POST request | Through the same socket |
| **Connections per thread** | 2 (POST response + subscription) | 1 (handles everything) |
| **Auto-reconnect** | Built-in (EventSource API) | Manual implementation |
| **Behind proxies/CDNs** | Works (it's just HTTP) | Some corporate firewalls block it |
| **Load balancers** | Any HTTP LB works | Needs WS upgrade support |
| **Authentication** | HTTP headers/cookies (existing middleware) | Trickier (no HTTP middleware after upgrade) |
| **Debugging** | `curl -N` (easy) | Need special WS client |
| **Server complexity** | Low (HTTP response) | Medium (connection lifecycle, ping/pong) |
| **Binary data** | Text only | Binary + text |
| **Extra dependencies** | None (native EventSource) | `ws` or similar library |

---

## Feature Matrix for This App

| Feature | SSE (2 connections) | WebSocket (1 connection) |
|---|---|---|
| User sends message | POST → SSE response stream | Send through socket |
| Scheduled task push | GET SSE subscription | Same socket |
| Token streaming | Works great | Works great |
| Typing indicators | Not practical | Native |
| Presence (online/offline) | Hard | Native |
| Live collaboration | Not practical | Native |
| Horizontal scaling | Redis pub/sub (current) | Redis adapter needed |

---

## Decision: Stay on SSE

**Rationale:**

1. **It works** — the two-connection pattern is functional and tested
2. **Simpler infrastructure** — no WebSocket upgrade, no sticky sessions, no special LB config
3. **Better debugging** — `curl -N` vs needing a WS client
4. **Auto-reconnect** — EventSource does it for free; WebSocket requires manual implementation
5. **Scales behind any CDN/proxy** — SSE is just HTTP, works through Cloudflare, nginx, etc.
6. **Auth is simpler** — existing CORS + cookie middleware applies; WebSocket needs token-in-query-param or post-upgrade auth
7. **No extra dependencies** — native browser API, no `ws` library

---

## When to Migrate to WebSocket

Trigger any of these:

| Trigger | Why |
|---|---|
| **Typing indicators** needed | "User is typing..." requires frequent client→server messages — impractical with POST |
| **Presence** needed (who's online) | WebSocket connection state = presence; SSE can't detect cleanly |
| **Live collaboration** (multiple users editing) | Full-duplex low-latency bidirectional |
| **2-connection overhead** measurably hurts | At high concurrency (1000+ concurrent users per server) |
| **Mobile app** with flaky connections | WebSocket reconnection can be more aggressive/customizable |

---

## Migration Path (when ready)

1. Add `ws` library to the API
2. Create `GET /ws` WebSocket upgrade endpoint
3. Connection authenticates via query param token or initial message
4. Client sends messages as JSON: `{ type: 'message', threadId, content }`
5. Server streams response as JSON frames: `{ type: 'token', text }`, `{ type: 'thinking', text }`, etc.
6. Redis pub/sub adapter for multi-instance (so a message published on instance A reaches the WS connection on instance B)
7. Remove both SSE endpoints
8. Frontend: replace `EventSource` + `fetch` with single `WebSocket`

**Estimated effort:** 2-3 days (including testing, reconnection logic, auth)

---

## Libraries for Future Migration

| Library | Purpose |
|---|---|
| `ws` | WebSocket server for Node.js |
| `@hono/ws` | Hono-native WebSocket helper |
| `ioredis` (already installed) | Redis adapter for multi-instance WS broadcast |
| Browser `WebSocket` API | No client library needed (native) |
