const { getStore } = require('@netlify/blobs');

const RL_WINDOW_MS = 60 * 1000;
const RL_MAX = 10;

exports.handler = async function handler(event) {
  if (event.httpMethod !== 'POST') {
    return json(405, { error: { message: 'Method not allowed' } });
  }

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json(503, { error: { message: 'ANTHROPIC_API_KEY is not configured' } });
  }

  const ip = event.headers['x-nf-client-connection-ip'] || event.headers['client-ip'] || 'unknown';
  const store = getStore('apexone-copilot-rate-limit');
  const key = `rl:${ip}`;
  const now = Date.now();
  const existing = await store.get(key, { type: 'json' }).catch(() => null);
  const calls = Array.isArray(existing) ? existing.filter((t) => now - t < RL_WINDOW_MS) : [];
  if (calls.length >= RL_MAX) {
    return json(429, { error: { message: 'Rate limit exceeded' } });
  }
  calls.push(now);
  await store.setJSON(key, calls, { metadata: { updatedAt: new Date(now).toISOString() } });

  let body;
  try {
    body = JSON.parse(event.body || '{}');
  } catch {
    return json(400, { error: { message: 'Invalid JSON body' } });
  }

  const payload = {
    model: body.model || 'claude-sonnet-4-6',
    max_tokens: Math.min(Number(body.max_tokens) || 1024, 2048),
    system: String(body.system || '').slice(0, 8000),
    messages: Array.isArray(body.messages) ? body.messages.slice(-12) : [],
  };

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(payload),
  });

  const text = await res.text();
  return {
    statusCode: res.status,
    headers: {
      'content-type': res.headers.get('content-type') || 'application/json',
      'cache-control': 'no-store',
    },
    body: text,
  };
};

function json(statusCode, body) {
  return {
    statusCode,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
    body: JSON.stringify(body),
  };
}
