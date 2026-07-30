/**
 * rateLimiter.js — Concurrency-safe Token Bucket & Sliding Window logic
 *
 * Uses a per-client in-process mutex (promise chain) so that concurrent
 * requests for the SAME client key are serialized — tokens can never be
 * double-spent even under 500+ req/s.
 */

const store = require('./store');

// Per-client mutex map: clientKey -> Promise (tail of the promise chain)
const locks = {};

/**
 * Acquire a per-client mutex and run fn() exclusively.
 * All concurrent callers for the same key are queued and run one-at-a-time.
 */
function withLock(key, fn) {
  const prev = locks[key] || Promise.resolve();
  const next = prev.then(fn).catch(fn); // always release even on error
  locks[key] = next;
  return next;
}

// ─── Token Bucket ────────────────────────────────────────────────────────────

function tokenBucketCheck(client) {
  const now = Date.now();
  const elapsed = (now - client.lastRefill) / 1000; // seconds
  const refill = elapsed * client.rps;

  // Refill tokens (capped at burst)
  client.tokens = Math.min(client.burst, client.tokens + refill);
  client.lastRefill = now;

  if (client.tokens >= 1) {
    client.tokens -= 1;
    return { allowed: true };
  }
  return { allowed: false };
}

// ─── Sliding Window ──────────────────────────────────────────────────────────

function slidingWindowCheck(client) {
  const now = Date.now();
  const windowMs = 1000; // 1-second sliding window

  // Drop timestamps outside the window
  client.windowLog = client.windowLog.filter(ts => now - ts < windowMs);

  if (client.windowLog.length < client.rps) {
    client.windowLog.push(now);
    return { allowed: true };
  }
  return { allowed: false };
}

// ─── Public API ──────────────────────────────────────────────────────────────

/**
 * Check whether clientKey is allowed to make a request.
 * Auto-provisions a new client with defaults if not configured.
 * Returns { allowed, limit, remaining, resetMs }
 */
async function check(clientKey) {
  return withLock(clientKey, () => {
    // Auto-provision with defaults if unknown
    let client = store.getClient(clientKey);
    if (!client) {
      client = store.setClient(clientKey, { rps: 10, burst: 20, mode: 'token_bucket' });
    }

    let result;
    if (client.mode === 'sliding_window') {
      result = slidingWindowCheck(client);
    } else {
      result = tokenBucketCheck(client);
    }

    // Compute header values
    const remaining = client.mode === 'sliding_window'
      ? Math.max(0, client.rps - client.windowLog.length)
      : Math.floor(client.tokens);

    const resetMs = client.mode === 'sliding_window'
      ? (client.windowLog.length > 0 ? 1000 - (Date.now() - client.windowLog[0]) : 0)
      : Math.ceil((1 - (client.tokens % 1)) / client.rps * 1000);

    store.saveClient(clientKey, client);

    return {
      allowed: result.allowed,
      limit: client.rps,
      burst: client.burst,
      remaining,
      resetMs: Math.max(0, resetMs),
      mode: client.mode,
    };
  });
}

module.exports = { check };
