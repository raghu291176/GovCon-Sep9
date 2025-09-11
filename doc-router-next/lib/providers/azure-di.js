const { env } = require('../env');

async function analyzeWithDI(modelId, bytes, mime) {
  if (!env.AZURE_DI_ENDPOINT || !env.AZURE_DI_KEY) throw new Error('Azure DI not configured');
  const base = env.AZURE_DI_ENDPOINT.replace(/\/$/, '');
  const url = `${base}/documentintelligence/documentModels/${encodeURIComponent(modelId)}:analyze?api-version=${encodeURIComponent(env.AZURE_DI_API_VERSION)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY,
      'Content-Type': mime || 'application/octet-stream',
    },
    body: bytes,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Azure DI analyze error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const op = resp.headers.get('operation-location');
  if (!op) throw new Error('Azure DI missing operation-location');
  let tries = 0;
  while (tries++ < 60) {
    await new Promise((r) => setTimeout(r, 1000));
    const r = await fetch(op, { headers: { 'Ocp-Apim-Subscription-Key': env.AZURE_DI_KEY } });
    if (!r.ok) throw new Error(`Azure DI poll error ${r.status}`);
    const j = await r.json();
    const status = j?.status || j?.result?.status || j?.analyzeResult?.status;
    if (status === 'succeeded') return j.result || j.analyzeResult || j;
    if (status === 'failed') throw new Error('Azure DI analysis failed');
  }
  throw new Error('Azure DI timeout');
}

module.exports = { analyzeWithDI };

