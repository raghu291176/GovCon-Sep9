function buildUrl(apiBaseUrl, path) {
  const base = (apiBaseUrl || '').trim();
  if (!base) return path; // use same-origin relative
  return `${base.replace(/\/$/, '')}${path}`;
}

export async function saveGLEntries(apiBaseUrl, entries) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/gl`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ entries })
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(text || `Failed to save GL entries (${res.status})`);
  }
  return res.json();
}

// Normalize GL spreadsheet on the server (CSV/XLSX)
export async function normalizeGLSpreadsheet(apiBaseUrl, file, options = {}) {
  const form = new FormData();
  form.append('file', file);
  const useLLM = options.useLLM !== false;
  const url = buildUrl(apiBaseUrl, `/api/gl/normalize?useLLM=${useLLM ? 'true' : 'false'}`);
  const res = await fetch(url, { method: 'POST', body: form });
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { ok: false, error: text || 'Invalid response' }; }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `Normalization failed (${res.status})`);
  }
  return data; // { ok, rows, mapping, headerRowIndex, logs, warnings, errors }
}

export async function loadServerConfig(apiBaseUrl) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/config`));
  if (!res.ok) return {};
  return res.json();
}

export async function saveServerConfig(apiBaseUrl, config) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/config`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config)
  });
  if (!res.ok) throw new Error('Failed to save server config');
  return res.json();
}

export async function loadLLMConfig(apiBaseUrl) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/llm-config`));
  if (!res.ok) return {};
  return res.json();
}

export async function saveLLMConfig(apiBaseUrl, config) {
  const headers = { 'Content-Type': 'application/json' };
  const res = await fetch(buildUrl(apiBaseUrl, `/api/llm-config`), {
    method: 'PUT',
    headers,
    body: JSON.stringify(config || {}),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Failed to save LLM config (${res.status})`);
  }
  return res.json();
}

export async function serverLLMReview(apiBaseUrl, rows) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/llm-review`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rows })
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Failed LLM review (${res.status})`);
  }
  const data = await res.json();
  return data; // includes results and diagnostic fields when provided
}

export async function serverLLMMapColumns(apiBaseUrl, headers, sampleRows) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/llm-map`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ headers, sampleRows: sampleRows || [] }),
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Failed LLM mapping (${res.status})`);
  }
  const data = await res.json();
  return { mapping: data.mapping || {}, headerRowIndex: Number(data.headerRowIndex || 0) || 0 };
}

export async function testLLM(apiBaseUrl) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/llm-test`));
  const text = await res.text();
  let data = {};
  try { data = JSON.parse(text); } catch { data = { ok: false, error: text || 'Invalid response' }; }
  if (!res.ok || data.ok === false) {
    throw new Error(data.error || `LLM test failed (${res.status})`);
  }
  return data;
}

// Documents API
export async function ingestDocuments(apiBaseUrl, files, options = {}) {
  const form = new FormData();
  (files || []).forEach((f) => form.append('files', f));
  let path = `/api/docs/ingest`;
  if (options.duplicateAction) {
    const q = new URLSearchParams({ duplicateAction: String(options.duplicateAction) });
    path += `?${q.toString()}`;
  }
  const res = await fetch(buildUrl(apiBaseUrl, path), {
    method: 'POST',
    body: form,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(t || `Failed to ingest documents (${res.status})`);
  }
  return res.json();
}

export async function listDocItems(apiBaseUrl) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/docs/items`));
  if (!res.ok) return { items: [], links: [], documents: [] };
  return res.json();
}

export async function linkDocItem(apiBaseUrl, document_item_id, gl_entry_id) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/docs/link`), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_item_id, gl_entry_id })
  });
  if (!res.ok) throw new Error('Failed to link');
  return res.json();
}

export async function unlinkDocItem(apiBaseUrl, document_item_id, gl_entry_id) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/docs/link`), {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ document_item_id, gl_entry_id })
  });
  if (!res.ok) throw new Error('Failed to unlink');
  return res.json();
}

export async function getRequirements(apiBaseUrl) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/requirements`));
  if (!res.ok) return { rows: [], policy: {} };
  return res.json();
}

// Azure Document Intelligence config
export async function loadDIConfig(apiBaseUrl) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/di-config`));
  if (!res.ok) return {};
  return res.json();
}

export async function saveDIConfig(apiBaseUrl, config) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/di-config`), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(config || {}),
  });
  if (!res.ok) throw new Error('Failed to save DI config');
  return res.json();
}

export async function fetchGLEntries(apiBaseUrl, limit = 500, offset = 0) {
  const res = await fetch(buildUrl(apiBaseUrl, `/api/gl?limit=${encodeURIComponent(limit)}&offset=${encodeURIComponent(offset)}`));
  if (!res.ok) return { rows: [] };
  return res.json();
}
