// GPT-assisted vendor equivalence and canonicalization
// Uses Azure OpenAI (chat completions) configured via environment variables

const cache = new Map(); // key: a||b (lowercased, trimmed) -> { ts, result }
const TTL_MS = 60 * 60 * 1000; // 1 hour

function getAzureConfig() {
  const base = (process.env.AZURE_OPENAI_ENDPOINT || '').trim().replace(/\/$/, '');
  const key = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY || '';
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || '';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2024-04-01-preview';
  return { base, key, deployment, apiVersion };
}

function enabled() {
  const flag = String(process.env.VENDOR_NAME_GPT_ENABLED || '').toLowerCase();
  const { base, key, deployment } = getAzureConfig();
  return (flag === 'true' || flag === '1' || flag === 'yes') && !!base && !!key && !!deployment;
}

function cacheKey(a, b) {
  const norm = (s) => String(s || '').toLowerCase().trim();
  const x = norm(a), y = norm(b);
  return x <= y ? `${x}||${y}` : `${y}||${x}`;
}

export async function areVendorsEquivalent(a, b) {
  if (!enabled()) return { equivalent: false, canonical: null, reason: 'disabled' };
  const key = cacheKey(a, b);
  const now = Date.now();
  const cached = cache.get(key);
  if (cached && (now - cached.ts) < TTL_MS) return cached.result;

  const { base, key: apiKey, deployment, apiVersion } = getAzureConfig();
  if (!base || !apiKey || !deployment) return { equivalent: false, canonical: null, reason: 'missing_config' };

  const url = `${base}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;
  const system = {
    role: 'system',
    content: 'You decide if two vendor names refer to the same business. Consider abbreviations, suffixes (Inc, LLC), and common descriptors (Business, Online, Marketplace). Respond strictly in JSON: {"equivalent": true|false, "canonical": "short root name"}. Keep canonical short (e.g., "Staples").'
  };
  const user = {
    role: 'user',
    content: `A: ${a}\nB: ${b}`
  };

  try {
    const resp = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'api-key': apiKey },
      body: JSON.stringify({ messages: [system, user], temperature: 0, max_tokens: 100 })
    });
    if (!resp.ok) {
      const t = await resp.text().catch(() => '');
      const result = { equivalent: false, canonical: null, reason: `http_${resp.status}`, detail: t.slice(0, 200) };
      cache.set(key, { ts: now, result });
      return result;
    }
    const data = await resp.json();
    const content = data?.choices?.[0]?.message?.content || '';
    let parsed = null;
    try { parsed = JSON.parse(content); }
    catch(_) { const m = content.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch(_) {} } }
    const out = {
      equivalent: !!parsed?.equivalent,
      canonical: parsed?.canonical ? String(parsed.canonical).trim() : null
    };
    cache.set(key, { ts: now, result: out });
    return out;
  } catch (e) {
    const result = { equivalent: false, canonical: null, reason: 'exception', detail: e?.message };
    cache.set(key, { ts: now, result });
    return result;
  }
}

export default { areVendorsEquivalent };

