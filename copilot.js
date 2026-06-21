/**
 * APEX ONE — AI Copilot Edge Function
 *
 * Proxies requests to the Anthropic API server-side, keeping the API key
 * out of the browser entirely.
 *
 * Deploy requirement: Set ANTHROPIC_API_KEY in Netlify environment variables
 * (Site → Configuration → Environment variables).
 */

export default async function handler(request, context) {
  const origin = request.headers.get('origin') || '';
  const siteUrl = Deno.env.get('URL') || '';

  /* CORS headers defined early so every error response can include them */
  const corsHeaders = {
    'Access-Control-Allow-Origin': siteUrl || '*',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Content-Type': 'application/json'
  };

  if (!siteUrl) {
    return new Response(JSON.stringify({ error: { message: 'Edge function not configured — URL environment variable is not set' } }), {
      status: 503,
      headers: corsHeaders
    });
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  if (request.method !== 'POST') {
    return new Response(JSON.stringify({ error: { message: 'Method not allowed' } }), {
      status: 405,
      headers: corsHeaders
    });
  }

  /* Verify same-origin */
  if (siteUrl && origin && origin !== siteUrl) {
    return new Response(JSON.stringify({ error: { message: 'Forbidden' } }), {
      status: 403,
      headers: corsHeaders
    });
  }

  const apiKey = Deno.env.get('ANTHROPIC_API_KEY');
  if (!apiKey) {
    return new Response(JSON.stringify({ error: { message: 'Copilot not configured — set ANTHROPIC_API_KEY in Netlify environment variables' } }), {
      status: 503,
      headers: corsHeaders
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response(JSON.stringify({ error: { message: 'Invalid JSON body' } }), {
      status: 400,
      headers: corsHeaders
    });
  }

  /* Validate and sanitize messages */
  if (!body.messages || !Array.isArray(body.messages) || body.messages.length === 0) {
    return new Response(JSON.stringify({ error: { message: 'messages array required' } }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const safeMsgs = body.messages
    .filter(m => m.role === 'user' || m.role === 'assistant')
    .slice(-12)
    .map(m => ({
      role: m.role,
      content: String(m.content || '').slice(0, 4000)
    }));

  if (!safeMsgs.length || safeMsgs[0].role !== 'user') {
    return new Response(JSON.stringify({ error: { message: 'First message must be from user' } }), {
      status: 400,
      headers: corsHeaders
    });
  }

  const systemPrompt = String(body.system || '').slice(0, 2000);

  /* SEC-04: Rate limit 10 req/60 s per IP.
     Uses Netlify Blobs via context.blobs (no npm import needed in edge functions).
     Falls back to in-memory if Blobs unavailable. */
  const clientIp = request.headers.get('x-nf-client-connection-ip') || 'unknown';
  const now = Date.now();
  let rateLimited = false;
  try {
    const store = context.blobs;
    if (store) {
      const rlKey = 'rl:' + clientIp;
      let calls = [];
      const raw = await store.get(rlKey);
      if (raw) { try { calls = JSON.parse(raw); } catch {} }
      calls = calls.filter(t => now - t < 60000);
      if (calls.length >= 10) { rateLimited = true; }
      else {
        calls.push(now);
        await store.set(rlKey, JSON.stringify(calls), { ttl: 120 });
      }
    } else {
      /* In-memory fallback — per-instance, resets on cold start */
      if (!handler._rl) handler._rl = {};
      const rl = handler._rl;
      if (!rl[clientIp]) rl[clientIp] = [];
      rl[clientIp] = rl[clientIp].filter(t => now - t < 60000);
      if (rl[clientIp].length >= 10) { rateLimited = true; }
      else { rl[clientIp].push(now); }
    }
  } catch (rlErr) {
    console.warn('[copilot] Rate-limit check failed, allowing request:', rlErr);
  }
  if (rateLimited) {
    return new Response(JSON.stringify({ error: { message: 'Rate limit reached — please wait a moment' } }), {
      status: 429,
      headers: { ...corsHeaders, 'Retry-After': '60' }
    });
  }

  const upstream = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-6',
      max_tokens: 1024,
      system: systemPrompt,
      messages: safeMsgs
    })
  });

  const responseBody = await upstream.text();
  return new Response(responseBody, {
    status: upstream.status,
    headers: corsHeaders
  });
}

export const config = { path: '/api/copilot' };
