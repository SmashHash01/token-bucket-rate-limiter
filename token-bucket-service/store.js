/**
 * store.js — Persistent JSON state store
 * Survives process restarts by writing to disk on every mutation.
 */

const fs = require('fs');
const path = require('path');

const STATE_FILE = path.join(__dirname, 'state.json');

// In-memory store
let state = {
  clients: {},   // { [clientKey]: { rps, burst, mode, tokens, lastRefill, windowLog } }
};

// Load persisted state on startup
function load() {
  try {
    if (fs.existsSync(STATE_FILE)) {
      const raw = fs.readFileSync(STATE_FILE, 'utf8');
      state = JSON.parse(raw);
      console.log(`[store] Loaded ${Object.keys(state.clients).length} client(s) from disk.`);
    }
  } catch (e) {
    console.warn('[store] Could not load state, starting fresh.', e.message);
  }
}

// Persist state to disk (synchronous for correctness under load)
function persist() {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// Get or create a client config
function getClient(key) {
  return state.clients[key] || null;
}

// Upsert client config (admin)
function setClient(key, { rps = 10, burst = 20, mode = 'token_bucket' }) {
  const existing = state.clients[key] || {};
  state.clients[key] = {
    rps,
    burst,
    mode,
    tokens: existing.tokens !== undefined ? existing.tokens : burst,
    lastRefill: existing.lastRefill || Date.now(),
    windowLog: existing.windowLog || [],   // for sliding window
  };
  persist();
  return state.clients[key];
}

// Save updated client state
function saveClient(key, clientState) {
  state.clients[key] = clientState;
  persist();
}

function getAllClients() {
  return state.clients;
}

load();

module.exports = { getClient, setClient, saveClient, getAllClients };
