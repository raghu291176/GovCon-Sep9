// Azure OpenAI GPT-4o Chat Service

function getAzureConfig() {
  const baseUrl = (process.env.AZURE_OPENAI_ENDPOINT || process.env.azure_ai_endpoint || '').trim().replace(/\/$/, '');
  const apiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY || '';
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  return { baseUrl, apiKey, deployment, apiVersion };
}

export async function azureChat(messages, { temperature = 0, max_tokens = 600, jsonMode = true } = {}) {
  const cfg = getAzureConfig();
  if (!cfg.baseUrl || !cfg.apiKey || !cfg.deployment) {
    return null; // treat as unavailable
  }
  if (/\/openai\//i.test(cfg.baseUrl)) {
    throw new Error('AZURE_OPENAI_ENDPOINT must be the resource base URL, not a full /openai path');
  }
  const url = `${cfg.baseUrl}/openai/deployments/${encodeURIComponent(cfg.deployment)}/chat/completions?api-version=${encodeURIComponent(cfg.apiVersion)}`;
  const body = {
    messages,
    temperature,
    max_tokens,
    response_format: jsonMode ? { type: 'json_object' } : undefined,
  };
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': cfg.apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new Error(`Azure OpenAI error ${resp.status}`);
  }
  const data = await resp.json();
  const content = data?.choices?.[0]?.message?.content || '';
  return content;
}