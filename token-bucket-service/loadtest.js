/**
 * loadtest.js — Validates correctness under 500+ concurrent req/s
 *
 * Fires 500 concurrent requests for the SAME client key simultaneously.
 * A token bucket with rps=10, burst=20 must ALLOW exactly 20 and DENY 480.
 * Any deviation means tokens were double-spent (race condition).
 *
 * Run: node loadtest.js
 */

const http = require('http');

const PORT = 3000;
const CLIENT_KEY = 'load-test-client';
const CONCURRENCY = 500;
const RPS = 10;
const BURST = 20;

function checkRequest() {
  return new Promise((resolve) => {
    const body = JSON.stringify({ clientKey: CLIENT_KEY });
    const options = {
      hostname: 'localhost',
      port: PORT,
      path: '/check',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          const json = JSON.parse(data);
          resolve({ status: res.statusCode, decision: json.decision });
        } catch {
          resolve({ status: res.statusCode, decision: 'ERROR' });
        }
      });
    });

    req.on('error', () => resolve({ status: 0, decision: 'ERROR' }));
    req.write(body);
    req.end();
  });
}

async function configureClient() {
  return new Promise((resolve) => {
    const body = JSON.stringify({ clientKey: CLIENT_KEY, rps: RPS, burst: BURST, mode: 'token_bucket' });
    const options = {
      hostname: 'localhost', port: PORT, path: '/admin/client',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) },
    };
    const req = http.request(options, (res) => {
      res.resume();
      res.on('end', resolve);
    });
    req.on('error', resolve);
    req.write(body);
    req.end();
  });
}

async function run() {
  console.log(`\n⚡ Token Bucket Load Test`);
  console.log(`   Client: ${CLIENT_KEY}`);
  console.log(`   Config: rps=${RPS}, burst=${BURST}`);
  console.log(`   Firing ${CONCURRENCY} concurrent requests...\n`);

  // Configure client first
  await configureClient();
  console.log(`✅ Client configured: rps=${RPS}, burst=${BURST}`);

  // Wait a moment so tokens are at burst capacity
  await new Promise(r => setTimeout(r, 200));

  const start = Date.now();

  // Fire all requests simultaneously
  const results = await Promise.all(
    Array.from({ length: CONCURRENCY }, () => checkRequest())
  );

  const elapsed = Date.now() - start;
  const allowed = results.filter(r => r.decision === 'ALLOW').length;
  const denied  = results.filter(r => r.decision === 'DENY').length;
  const errors  = results.filter(r => r.decision === 'ERROR').length;

  console.log(`\n📊 Results (${elapsed}ms elapsed):`);
  console.log(`   Total requests : ${CONCURRENCY}`);
  console.log(`   ALLOWED        : ${allowed}  (expected: ${BURST})`);
  console.log(`   DENIED         : ${denied}  (expected: ${CONCURRENCY - BURST})`);
  console.log(`   ERRORS         : ${errors}`);
  console.log(`   Throughput     : ${Math.round(CONCURRENCY / (elapsed / 1000))} req/s`);

  const correct = allowed === BURST && denied === CONCURRENCY - BURST && errors === 0;
  console.log(`\n${correct ? '✅ PASS' : '❌ FAIL'} — Tokens ${correct ? 'were NOT' : 'WERE'} double-spent under concurrency.`);

  if (!correct && allowed !== BURST) {
    console.log(`   ⚠️  Expected exactly ${BURST} ALLOW but got ${allowed}. Race condition detected!`);
  }

  process.exit(correct ? 0 : 1);
}

run().catch(err => {
  console.error('Load test error:', err.message);
  process.exit(1);
});
