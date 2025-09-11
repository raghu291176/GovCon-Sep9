export async function azureReview(rows, cfg) {
  const endpoint = (cfg?.endpoint || '').replace(/\/?$/, '');
  const deployment = cfg?.deployment || '';
  const apiVersion = cfg?.apiVersion || '2024-06-01';
  const apiKey = cfg?.apiKey || '';
  if (!endpoint || !deployment || !apiKey) throw new Error('Missing Azure config');

  const url = `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`;

  const systemMsg = {
    role: 'system',
    content: 'You are a compliance assistant for FAR cost allowability. Classify each ledger row as ALLOWED, UNALLOWABLE, NEEDS_REVIEW, or RECEIPT_REQUIRED. Provide a brief rationale and include FAR section if clearly applicable. Output strictly JSON: {"results":[{"index":0,"classification":"ALLOWED|UNALLOWABLE|NEEDS_REVIEW|RECEIPT_REQUIRED","rationale":"...","farSection":"31.xxx"}]}.'
  };
  const examples = (rows || []).slice(0, 50).map((r, i) => ({
    index: i,
    accountNumber: r.accountNumber,
    description: r.description,
    amount: r.amount,
    date: r.date,
    category: r.category,
    vendor: r.vendor,
    contractNumber: r.contractNumber,
  }));
  const userMsg = {
    role: 'user',
    content: `Classify these rows. Reply JSON only.\n${JSON.stringify({ rows: examples })}`,
  };

  const body = {
    messages: [systemMsg, userMsg],
    temperature: 0,
    top_p: 0,
    max_tokens: 800,
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': apiKey,
    },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`Azure OpenAI error ${res.status}: ${t}`);
  }
  const data = await res.json();
  const content = data?.choices?.[0]?.message?.content || '';
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {}
  if (!parsed) {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {}
    }
  }
  if (!parsed || !Array.isArray(parsed.results)) throw new Error('Invalid model response');
  return parsed.results;
}

