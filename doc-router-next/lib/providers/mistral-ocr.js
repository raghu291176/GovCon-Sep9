const { env } = require('../env');

async function callMistralOcr(bytes, mime) {
  if (!env.MISTRAL_OCR_ENDPOINT || !env.MISTRAL_OCR_API_KEY) throw new Error('Mistral OCR not configured');
  const resp = await fetch(env.MISTRAL_OCR_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key': env.MISTRAL_OCR_API_KEY,
      'Content-Type': mime || 'application/octet-stream',
      'Accept': 'application/json',
    },
    body: bytes,
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => '');
    throw new Error(`Mistral OCR error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = await resp.json().catch(async () => ({ raw: await resp.text().catch(() => '') }));
  return json;
}

module.exports = { callMistralOcr };

