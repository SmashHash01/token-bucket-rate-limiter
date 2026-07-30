# Token Bucket Rate Limiter Service

A standalone production-grade rate limiting microservice. Other services call this API to check whether a request should be **ALLOWED** or **DENIED** — it's a networked service, not a library.

---

## Features

- ✅ Token Bucket algorithm (per-client configurable RPS + burst)
- ✅ Sliding Window mode (selectable per client)
- ✅ Admin endpoint to configure limits dynamically (no restarts needed)
- ✅ Persistent state — survives process restarts (JSON store)
- ✅ Concurrency-safe — per-client mutex prevents double-spend of tokens
- ✅ Standard rate-limit headers on every response
- ✅ Load test script — validates correctness at 500+ concurrent req/s

---

## Quick Start

```bash
npm install
node index.js
```

Server runs on **port 3000** by default. Set `PORT` env var to override.

---

## API Reference

### `POST /check`
Check if a client key should be ALLOWED or DENIED.

**Request:**
```json
{ "clientKey": "user-123" }
```

**Response (ALLOW — 200):**
```json
{
  "decision": "ALLOW",
  "clientKey": "user-123",
  "remaining": 19,
  "limit": 10,
  "mode": "token_bucket"
}
```

**Response (DENY — 429):**
```json
{
  "decision": "DENY",
  "clientKey": "user-123",
  "remaining": 0,
  "retryAfterMs": 450,
  "mode": "token_bucket"
}
```

**Headers returned on every response:**
```
X-RateLimit-Limit: 10
X-RateLimit-Burst: 20
X-RateLimit-Remaining: 19
X-RateLimit-Reset: 1
X-RateLimit-Mode: token_bucket
Retry-After: 1   (only on 429)
```

---

### `POST /admin/client`
Configure per-client rate limits.

**Request:**
```json
{
  "clientKey": "user-123",
  "rps": 5,
  "burst": 10,
  "mode": "sliding_window"
}
```

| Field       | Type   | Default       | Description                              |
|-------------|--------|---------------|------------------------------------------|
| clientKey   | string | required      | Unique identifier for the client         |
| rps         | number | 10            | Requests per second allowed              |
| burst       | number | 20            | Max burst capacity (token bucket only)   |
| mode        | string | token_bucket  | `token_bucket` or `sliding_window`       |

---

### `GET /admin/clients`
List all configured clients and their current state.

---

### `GET /health`
Health check endpoint.

---

## Load Test

Validates zero double-spend under 500 concurrent requests:

```bash
# In terminal 1:
node index.js

# In terminal 2:
node loadtest.js
```

Expected output:
```
📊 Results (38ms elapsed):
   Total requests : 500
   ALLOWED        : 20  (expected: 20)
   DENIED         : 480 (expected: 480)
   ERRORS         : 0
   Throughput     : 13157 req/s

✅ PASS — Tokens were NOT double-spent under concurrency.
```

---

## Project Structure

```
token-bucket-service/
├── index.js        # Express server & route handlers
├── rateLimiter.js  # Token Bucket & Sliding Window algorithms + mutex
├── store.js        # Persistent JSON state store
├── loadtest.js     # Concurrency load test (500+ req/s)
├── state.json      # Auto-generated — persisted client state
└── README.md
```

---

## Design Decisions

**Why a standalone service?**  
Every backend eventually needs rate limiting, but importing a library means each service instance has its own counter. A networked service shares state correctly across all instances.

**Why a per-client mutex instead of Redis?**  
For a single-instance service, an in-process promise-chain mutex is atomic and zero-latency. For multi-instance deployments, replace `store.js` with Redis + `SET NX` atomic operations.

**Why JSON persistence instead of a database?**  
Keeps the service dependency-free and instantly runnable. The store interface is abstracted in `store.js` — swap in Redis, SQLite, or Postgres without touching `rateLimiter.js` or `index.js`.
