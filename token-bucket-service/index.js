/**
 * index.js — Token Bucket Rate Limiter Service
 *
 * Endpoints:
 *   POST /check          — Check if a client key is ALLOWED or DENIED
 *   POST /admin/client   — Configure per-client rate limits
 *   GET  /admin/clients  — List all configured clients
 *   GET  /health         — Health check
 */

const express = require('express');
const rateLimiter = require('./rateLimiter');
const store = require('./store');

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

// ─── Health ──────────────────────────────────────────────────────────────────

app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ─── Rate Limit Check ────────────────────────────────────────────────────────

/**
 * POST /check
 * Body: { "clientKey": "user-123" }
 * Response: ALLOW or DENY with rate-limit headers
 */
app.post('/check', async (req, res) => {
  const { clientKey } = req.body;

  if (!clientKey || typeof clientKey !== 'string') {
    return res.status(400).json({ error: 'clientKey (string) is required in request body.' });
  }

  try {
    const result = await rateLimiter.check(clientKey);

    // Standard rate-limit headers (RFC 6585 / de-facto standard)
    res.set('X-RateLimit-Limit', String(result.limit));
    res.set('X-RateLimit-Burst', String(result.burst));
    res.set('X-RateLimit-Remaining', String(result.remaining));
    res.set('X-RateLimit-Reset', String(Math.ceil(result.resetMs / 1000)));
    res.set('X-RateLimit-Mode', result.mode);

    if (result.allowed) {
      return res.status(200).json({
        decision: 'ALLOW',
        clientKey,
        remaining: result.remaining,
        limit: result.limit,
        mode: result.mode,
      });
    } else {
      res.set('Retry-After', String(Math.ceil(result.resetMs / 1000)));
      return res.status(429).json({
        decision: 'DENY',
        clientKey,
        remaining: 0,
        retryAfterMs: result.resetMs,
        mode: result.mode,
      });
    }
  } catch (err) {
    console.error('[/check] Error:', err);
    return res.status(500).json({ error: 'Internal server error.' });
  }
});

// ─── Admin: Configure Client ─────────────────────────────────────────────────

/**
 * POST /admin/client
 * Body: { "clientKey": "user-123", "rps": 5, "burst": 10, "mode": "token_bucket" | "sliding_window" }
 */
app.post('/admin/client', (req, res) => {
  const { clientKey, rps, burst, mode } = req.body;

  if (!clientKey || typeof clientKey !== 'string') {
    return res.status(400).json({ error: 'clientKey (string) is required.' });
  }

  const validModes = ['token_bucket', 'sliding_window'];
  if (mode && !validModes.includes(mode)) {
    return res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
  }

  if (rps !== undefined && (typeof rps !== 'number' || rps <= 0)) {
    return res.status(400).json({ error: 'rps must be a positive number.' });
  }

  if (burst !== undefined && (typeof burst !== 'number' || burst <= 0)) {
    return res.status(400).json({ error: 'burst must be a positive number.' });
  }

  const client = store.setClient(clientKey, {
    rps: rps || 10,
    burst: burst || 20,
    mode: mode || 'token_bucket',
  });

  return res.status(200).json({
    message: `Client "${clientKey}" configured successfully.`,
    config: { clientKey, rps: client.rps, burst: client.burst, mode: client.mode },
  });
});

// ─── Admin: List Clients ─────────────────────────────────────────────────────

/**
 * GET /admin/clients
 * Returns all configured clients and their current state
 */
app.get('/admin/clients', (req, res) => {
  const clients = store.getAllClients();
  const summary = Object.entries(clients).map(([key, c]) => ({
    clientKey: key,
    rps: c.rps,
    burst: c.burst,
    mode: c.mode,
    tokens: Math.floor(c.tokens || 0),
    windowLog: c.windowLog ? c.windowLog.length : 0,
  }));
  return res.json({ total: summary.length, clients: summary });
});

// ─── Start ───────────────────────────────────────────────────────────────────

app.listen(PORT, () => {
  console.log(`\n🚀 Token Bucket Rate Limiter Service running on port ${PORT}`);
  console.log(`   POST /check           — Check ALLOW/DENY for a client key`);
  console.log(`   POST /admin/client    — Configure per-client limits`);
  console.log(`   GET  /admin/clients   — List all clients`);
  console.log(`   GET  /health          — Health check\n`);
});

module.exports = app;
