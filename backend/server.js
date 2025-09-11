import 'dotenv/config';
import express from 'express';
import crypto from 'crypto';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
// import pdfParse from 'pdf-parse'; // Temporarily disabled due to module issues
import mammoth from 'mammoth';
import { classifyByText, extractApprovalsFromText } from './services/approvals.js';
import { scoreMatch, hasUnallowableKeyword } from './services/match.js';
import { setupSQLite } from './persistence/sqlite.js';
import { loadAllConfigs as loadFileConfigs, saveConfig as saveFileConfig } from './persistence/fileStore.js';
import documentRoutes from './routes/documentRoutes.js';
import { processDocumentWorkflow } from './services/documentWorkflow.js';

const app = express();
const port = process.env.PORT || 3000;
// Resolve repo root to serve static frontend
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = path.join(__dirname, '..');
app.use(express.json({ limit: '10mb' }));

// Serve static frontend assets (single-process deployment)
app.get('/', (req, res) => res.sendFile(path.join(ROOT_DIR, 'index.html')));
app.use('/app.js', express.static(path.join(ROOT_DIR, 'app.js')));
app.use('/style.css', express.static(path.join(ROOT_DIR, 'style.css')));
app.use('/modules', express.static(path.join(ROOT_DIR, 'modules')));
app.use('/config', express.static(path.join(ROOT_DIR, 'config')));

// Document processing routes
app.use('/api/document-processing', documentRoutes);
// Serve uploaded documents (receipts) for preview — prefer persistent storage
const PERSIST_DIR = process.env.UPLOAD_DIR || '/home/uploads';
let UPLOAD_DIR = PERSIST_DIR;
try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); }
catch (_) {
  // Fallback to local folder for dev environments where /home is not writable
  UPLOAD_DIR = path.join(__dirname, 'uploads');
  try { fs.mkdirSync(UPLOAD_DIR, { recursive: true }); } catch (_) {}
}
app.use('/uploads', express.static(UPLOAD_DIR));

// Hardcoded Azure OpenAI settings
const apiVersion = "2024-04-01-preview";
const modelName = "gpt-4o";
const deployment = "gpt-4o";

// In-memory storage (no database)
const memory = {
  glEntries: [], // { id, account_number, description, amount, date, category, vendor, contract_number, created_at, doc_summary, doc_flag_unallowable }
  appConfig: {}, // free-form config from /api/config
  llm: {},       // llm config from /api/llm-config
  documents: [], // { id, filename, mime_type, text_content, meta, created_at, doc_type, approvals: [] }
  docItems: [],  // { id, document_id, kind, vendor, date, amount, currency, details, text_excerpt }
  glDocLinks: [],// { document_item_id, gl_entry_id, score, doc_summary, doc_flag_unallowable }
  di: {},        // Azure Document Intelligence config
};

// Optional SQLite persistence (loads existing state into memory)
const sqlite = setupSQLite(memory);
// Load persisted configs if SQLite is unavailable
if (!sqlite) {
  loadFileConfigs(memory);
}

function recomputeAttachmentFlags() {
  try {
    const byGl = new Map();
    for (const link of memory.glDocLinks) {
      const k = String(link.gl_entry_id);
      const arr = byGl.get(k) || [];
      arr.push(link);
      byGl.set(k, arr);
    }
    // Build helper maps for approvals
    const docItemById = new Map(memory.docItems.map(d => [String(d.id), d]));
    const docById = new Map(memory.documents.map(d => [String(d.id), d]));
    for (const e of memory.glEntries) {
      const links = byGl.get(String(e.id)) || [];
      e.attachmentsCount = links.length;
      e.hasReceipt = links.length > 0;
      // Aggregate approvals from linked documents
      let approvalsCount = 0;
      for (const L of links) {
        const di = docItemById.get(String(L.document_item_id));
        const doc = di ? docById.get(String(di.document_id)) : null;
        const n = Array.isArray(doc?.approvals) ? doc.approvals.length : 0;
        approvalsCount += n;
      }
      e.approvalsCount = approvalsCount;
      e.hasApproval = approvalsCount > 0;
    }
  } catch (_) {}
}

app.get('/api/health', async (req, res) => {
  res.json({ ok: true, counts: { gl: memory.glEntries.length, docs: memory.documents.length } });
});

// Persist GL entries (expects { entries: [...] })
app.post('/api/gl', async (req, res) => {
  const entries = req.body?.entries;
  if (!Array.isArray(entries)) return res.status(400).json({ error: 'entries must be an array' });
  try {
    const ids = [];
    for (const e of entries) {
      const id = crypto.randomUUID();
      memory.glEntries.push({
        id,
        account_number: e.accountNumber ?? null,
        description: e.description ?? null,
        amount: (typeof e.amount === 'number' ? e.amount : Number(e.amount)) || 0,
        date: e.date ? new Date(e.date) : null,
        category: e.category ?? null,
        vendor: e.vendor ?? null,
        contract_number: e.contractNumber ?? null,
        created_at: new Date(),
      });
      ids.push(id);
    }
    try {
      if (sqlite) {
        const rows = ids.map((id) => {
          const e = memory.glEntries.find(x => x.id === id);
          return {
            id,
            account_number: e.account_number,
            description: e.description,
            amount: e.amount,
            date: e.date ? new Date(e.date).toISOString() : null,
            category: e.category,
            vendor: e.vendor,
            contract_number: e.contract_number,
            created_at: e.created_at ? new Date(e.created_at).toISOString() : new Date().toISOString(),
            doc_summary: e.doc_summary || null,
            doc_flag_unallowable: e.doc_flag_unallowable ? 1 : 0,
          };
        });
        sqlite.insertGLEntries(rows);
      }
    } catch (_) {}
    res.json({ inserted: ids.length, ids });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Fetch GL entries (basic pagination)
app.get('/api/gl', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 100, 1000);
  const offset = Number(req.query.offset) || 0;
  try {
    const sorted = [...memory.glEntries].sort((a, b) => {
      const da = a.date ? new Date(a.date).getTime() : 0;
      const dbt = b.date ? new Date(b.date).getTime() : 0;
      if (dbt !== da) return dbt - da;
      return String(b.id).localeCompare(String(a.id));
    });
    const page = sorted.slice(offset, offset + limit);
    res.json({ rows: page, limit, offset });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// App config (persist thresholds/anomaly config)
app.get('/api/config', async (req, res) => {
  try {
    res.json(memory.appConfig || {});
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/config', async (req, res) => {
  const value = req.body || {};
  try {
    memory.appConfig = value;
    try {
      if (sqlite) sqlite.saveConfig('app_config', memory.appConfig);
      else saveFileConfig('app_config', memory.appConfig);
    } catch (_) {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Azure OpenAI settings (overridable via /api/llm-config)
const OAI_DEFAULTS = {
  // Primary: Azure App Service envs as provided
  key: process.env.azure_openai_key
    || process.env.AZURE_OPENAI_KEY
    || process.env.AZURE_OPENAI_API_KEY
    || process.env.OPENAI_API_KEY
    || '',
  // Primary: Azure App Service endpoint var
  baseUrl: process.env.azure_ai_endpoint
    || process.env.AZURE_AI_ENDPOINT
    || process.env.AZURE_OPENAI_ENDPOINT
    || '',
  // Hardcode API version and deployment; ignore .env for these
  azureApiVersion: apiVersion,
  azureDeployment: deployment,
  model: modelName,
};

async function getLLMConfig() {
  // Always derive from environment/hardcoded defaults for server-side
  // to ensure Azure Web App settings are authoritative.
  return {
    provider: 'azure_openai',
    key: OAI_DEFAULTS.key || '',
    baseUrl: OAI_DEFAULTS.baseUrl || '',
    azureApiVersion: OAI_DEFAULTS.azureApiVersion,
    azureDeployment: OAI_DEFAULTS.azureDeployment,
  };
}

// Azure-only chat helper
async function llmChat(messages, { temperature = 0, top_p = 0, max_tokens = 800, jsonMode = true } = {}) {
  const cfg = await getLLMConfig();
  // Azure OpenAI only — require base endpoint (no /openai/... path)
  const baseRaw = String(cfg.baseUrl || '').trim();
  if (!cfg.key || !baseRaw || !cfg.azureDeployment) throw new Error('Azure OpenAI not configured');
  if (/\/openai\//i.test(baseRaw)) {
    throw new Error('Invalid Azure endpoint: set azure_ai_endpoint to the resource base (e.g., https://<resource>.openai.azure.com), not a full /openai/deployments/... URL');
  }
  const base = baseRaw.replace(/\/$/, '');
  const url = `${base}/openai/deployments/${encodeURIComponent(cfg.azureDeployment)}/chat/completions?api-version=${encodeURIComponent(cfg.azureApiVersion || apiVersion)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': cfg.key,
    },
    body: JSON.stringify({ messages, temperature, top_p, max_tokens }),
  });
  if (!resp.ok) {
    let detail = '';
    try { detail = await resp.text(); } catch (_) {}
    throw new Error(`Azure OpenAI error ${resp.status}: ${String(detail || '').slice(0, 500)}`);
  }
  const data = await resp.json();
  return data?.choices?.[0]?.message?.content || '';
}

// Attempt to salvage partially valid JSON: extract objects from results array
function parseLenientResults(text) {
  try {
    const s = String(text || '');
    const keyIdx = s.indexOf('"results"');
    if (keyIdx === -1) return null;
    let i = s.indexOf('[', keyIdx);
    if (i === -1) return null;
    // Scan inside array to collect top-level objects { ... }
    const objs = [];
    let inString = false;
    let esc = false;
    let brace = 0;
    let startObj = -1;
    for (let pos = i + 1; pos < s.length; pos++) {
      const ch = s[pos];
      if (inString) {
        if (!esc && ch === '"') inString = false;
        esc = (!esc && ch === '\\');
        continue;
      }
      if (ch === '"') { inString = true; esc = false; continue; }
      if (ch === '{') {
        if (brace === 0) startObj = pos;
        brace++;
      } else if (ch === '}') {
        brace--;
        if (brace === 0 && startObj !== -1) {
          const slice = s.slice(startObj, pos + 1);
          try {
            const obj = JSON.parse(slice);
            objs.push(obj);
          } catch (_) { /* ignore bad object */ }
          startObj = -1;
        }
      } else if (ch === ']' && brace === 0) {
        break; // end of array
      }
    }
    if (objs.length) return { results: objs };
  } catch (_) {}
  return null;
}

async function callOpenAICompatible(rows) {
  const logs = [];
  const systemMsg = {
    role: 'system',
    content: [
      'You are a compliance assistant for FAR cost allowability. You will receive a JSON object with an array "rows". Each row may include:',
      'index (0-based), id (unique string), accountNumber, description, amount, date (YYYY-MM-DD), category, vendor, contractNumber, attachmentsCount (integer), hasReceipt (boolean).',
      '',
      'Return exactly one top-level JSON object and nothing else (no prose, no markdown, no code fences). Schema:',
      '{"results":[{"index":0,"id":"<same as input id>","classification":"ALLOWED|UNALLOWABLE|NEEDS_REVIEW|RECEIPT_REQUIRED","rationale":"…","farSection":"31.xxx or \"\""}]}',
      '',
      'Hard rules:',
      '- Output strictly JSON only (no prose/markdown/fences).',
      '- results.length == number of input rows.',
      '- Copy both index and id from each input row (if id present).',
      '- rationale ≤160 chars, factual, tied to the row.',
      '- farSection only when clearly applicable; else "".',
      '- If insufficient/ambiguous → NEEDS_REVIEW.',
      '- If travel/lodging/meals/airfare (or large purchases) lack receipts → RECEIPT_REQUIRED.',
      '- Amount ≥3000 and attachmentsCount==0 → RECEIPT_REQUIRED.',
      '',
      'Decision logic (first match wins):',
      '- Alcohol → UNALLOWABLE ("31.205-51").',
      '- Lobbying/political → UNALLOWABLE ("31.205-22").',
      '- Donations/charity → UNALLOWABLE ("31.205-8").',
      '- Fines/penalties → UNALLOWABLE ("31.205-15").',
      '- Interest/bank/finance fees → UNALLOWABLE ("31.205-20").',
      '- Entertainment/gifts/PR/morale → UNALLOWABLE ("31.205-14").',
      '- Airfare above coach (first/business/premium/seat upgrade) without clear justification → UNALLOWABLE (excess) ("31.205-46").',
      '- Travel/lodging/meals/airfare missing receipts/support → RECEIPT_REQUIRED (cite "31.205-46" only if clearly applicable).',
      '- Ordinary office/admin supplies, utilities/telecom, necessary software/cloud clearly allocable & reasonable → ALLOWED ("31.201-2").',
      '- Legal/professional/claims/litigation unclear → NEEDS_REVIEW unless a specific section applies.',
      '- Direct travel to client/government site with null contractNumber and allocability unclear → NEEDS_REVIEW.',
    ].join('\n')
  };
  // Helper to normalize row for the payload
  const normRow = (r, i) => {
    const obj = {
      index: (typeof r.index === 'number') ? r.index : i,
      accountNumber: r.accountNumber,
      description: r.description,
      amount: r.amount,
      date: r.date,
      category: r.category,
      vendor: r.vendor,
      contractNumber: r.contractNumber,
    };
    if (r.id) obj.id = r.id;
    if (typeof r.attachmentsCount === 'number') obj.attachmentsCount = r.attachmentsCount;
    if (typeof r.hasReceipt === 'boolean') obj.hasReceipt = r.hasReceipt;
    return obj;
  };
  const examples = rows.map(normRow);
  const userMsg = {
    role: 'user',
    content: `Classify these rows. Reply JSON only.\n${JSON.stringify({ rows: examples })}`,
  };

  // Heuristic: allocate more tokens for larger batches
  const est = Math.min(8000, Math.max(800, 60 * (examples.length || 1) + 300));
  logs.push(`initial_request: rows=${examples.length}, max_tokens=${est}`);
  const content = await llmChat([systemMsg, userMsg], { temperature: 0, top_p: 0, max_tokens: est });
  console.log('LLM raw response:', content);
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const match = content.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        parsed = JSON.parse(match[0]);
      } catch {}
    }
    if (!parsed) {
      // Try lenient extraction of results
      parsed = parseLenientResults(content);
    }
  }
  console.log('Parsed response:', parsed);
  const expected = examples.length;
  let warning = null;
  if (!parsed || !Array.isArray(parsed.results)) {
    console.error('Invalid response structure. Expected {results: [...]} but got:', parsed);
    warning = 'Invalid model response';
    logs.push('parse_error: initial');
    return { results: [], raw: content, parsed: null, error: warning, logs };
  }
  // Merge results by index
  const byIndex = new Map();
  for (const r of parsed.results) {
    if (r && typeof r.index === 'number' && !byIndex.has(r.index)) byIndex.set(r.index, r);
  }
  logs.push(`initial_parsed: results=${byIndex.size}/${expected}`);
  // If incomplete, request continuation iteratively
  let safety = 5;
  while (byIndex.size < expected && safety-- > 0) {
    const missing = [];
    for (let i = 0; i < expected; i++) {
      if (!byIndex.has(i)) missing.push(i);
    }
    if (missing.length === 0) break;
    const first = missing[0];
    const last = missing[missing.length - 1];
    console.log(`Continuation: requesting indices ${first}..${last} (${missing.length} rows)`);
    logs.push(`continue_request: from=${first} to=${last} count=${missing.length}`);
    const contSystem = {
      role: 'system',
      content: [
        'Continue classification with the same rules and schema. Return ONLY the remaining results for the rows provided below.',
        'Return exactly one JSON object and nothing else: {"results":[{...}]}',
        'Do not repeat indices already returned; include only the rows supplied in this message. Ensure indices and ids match input.'
      ].join('\n')
    };
    const contRows = missing.map(i => normRow(rows[i], i));
    const contUser = { role: 'user', content: `Continue from remaining rows. Reply JSON only.\n${JSON.stringify({ rows: contRows })}` };
    const contTokens = Math.min(8000, Math.max(600, 60 * contRows.length + 200));
    const contText = await llmChat([contSystem, contUser], { temperature: 0, top_p: 0, max_tokens: contTokens });
    let contParsed = null;
    try { contParsed = JSON.parse(contText); } catch {
      const m = contText.match(/\{[\s\S]*\}/); if (m) { try { contParsed = JSON.parse(m[0]); } catch {} }
      if (!contParsed) contParsed = parseLenientResults(contText);
    }
    if (contParsed && Array.isArray(contParsed.results)) {
      for (const r of contParsed.results) {
        if (r && typeof r.index === 'number' && !byIndex.has(r.index)) byIndex.set(r.index, r);
      }
      logs.push(`continue_parsed: added=${contParsed.results.length}, total=${byIndex.size}/${expected}`);
    } else {
      warning = 'Continuation parse failed';
      logs.push('parse_error: continuation');
      break;
    }
  }
  const merged = Array.from(byIndex.values()).sort((a,b) => a.index - b.index);
  if (merged.length < expected) warning = `Partial results: ${merged.length}/${expected}`;
  return { results: merged, raw: content, parsed, warning, logs };
}

app.post('/api/llm-review', async (req, res) => {
  try {
    console.log('=== LLM REVIEW REQUEST START ===');
    console.log('Request body:', JSON.stringify(req.body, null, 2));
    const rows = req.body?.rows;
    console.log('LLM Review - Received rows:', rows?.length, 'rows');
    if (rows?.length > 0) console.log('First row sample:', JSON.stringify(rows[0], null, 2));
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log('ERROR: Invalid rows array');
      return res.status(400).json({ error: 'rows must be a non-empty array' });
    }
    console.log('Calling Azure OpenAI with', rows.length, 'rows...');
    const out = await callOpenAICompatible(rows);
    const results = Array.isArray(out?.results) ? out.results : [];
    console.log('LLM Review - Results:', results.length, 'results', out?.error ? `(warning: ${out.error})` : '');
    console.log('=== LLM REVIEW REQUEST END ===');
    res.json({ results, llm_raw: out.raw, llm_parsed: out.parsed, warning: out.warning || out.error || null, llm_logs: out.logs || [] });
  } catch (e) {
    console.error('=== LLM REVIEW ERROR ===');
    console.error('Error:', e.message);
    console.error('Stack:', e.stack);
    console.error('=== END ERROR ===');
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/llm-config', async (req, res) => {
  try {
    const cfg = await getLLMConfig();
    res.json({ provider: 'azure_openai', endpoint: cfg.baseUrl, azureApiVersion: cfg.azureApiVersion, azureDeployment: cfg.azureDeployment, hasKey: !!cfg.key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// Note: PUT /api/llm-config removed. Env variables are the source of truth.

// ---------- Column Mapping via LLM ----------
async function callOpenAIForMapping(headers, sampleRows) {
  const system = {
    role: 'system',
    content: 'You map spreadsheet headers to standardized GL fields. Return strictly JSON: {"mapping":{"accountNumber":"<header or index>","description":"<header or index>","amount":"<header or index>","date":"<header or index>","category":"<header or index>","vendor":"<header or index>","contractNumber":"<header or index>","debit":"<header or index>","credit":"<header or index>"},"headerRowIndex":0}. If amount is not explicit, suggest debit/credit columns. If a field is absent, return "" for it. Never include extra text.'
  };
  const user = {
    role: 'user',
    content: JSON.stringify({ headers, sampleRows: (sampleRows || []).slice(0, 20) })
  };
  const content = await llmChat([system, user], { temperature: 0, top_p: 0, max_tokens: 600 });
  let parsed;
  try {
    parsed = JSON.parse(content);
  } catch {
    const m = content.match(/\{[\s\S]*\}/);
    if (m) {
      try { parsed = JSON.parse(m[0]); } catch {}
    }
  }
  if (!parsed || typeof parsed !== 'object' || typeof parsed.mapping !== 'object') {
    throw new Error('Invalid model response');
  }
  const mapping = parsed.mapping || {};
  const headerRowIndex = Number(parsed.headerRowIndex || 0) || 0;
  return { mapping, headerRowIndex };
}

app.post('/api/llm-map', async (req, res) => {
  try {
    const headers = req.body?.headers;
    const sampleRows = req.body?.sampleRows || [];
    if (!Array.isArray(headers) || headers.length === 0) {
      return res.status(400).json({ error: 'headers must be a non-empty array' });
    }
    const r = await callOpenAIForMapping(headers, sampleRows);
    res.json(r);
  } catch (e) {
    res.status(500).json({ error: e.message || 'Mapping failed' });
  }
});

// ---------- LLM Connectivity Test ----------
app.get('/api/llm-test', async (req, res) => {
  try {
    const cfg = await getLLMConfig();
    if (!cfg.key) return res.status(400).json({ ok: false, error: 'No API key configured' });
    const sys = { role: 'system', content: 'You are a health-check assistant. Respond with a short confirmation.' };
    const usr = { role: 'user', content: 'Reply with OK.' };
    const content = await llmChat([sys, usr], { temperature: 0, top_p: 0, max_tokens: 5, jsonMode: false });
    res.json({ ok: true, provider: 'azure_openai', endpoint: cfg.baseUrl, deployment: cfg.azureDeployment, apiVersion: cfg.azureApiVersion, response: String(content || '').slice(0, 80) });
  } catch (e) {
    res.status(500).json({ ok: false, error: e?.message || 'LLM test failed' });
  }
});

// ---------- Supplemental Documents Ingest ----------
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 20 * 1024 * 1024 } });

async function extractTextFromBuffer(buffer, mimeType, filename) {
  try {
    if ((mimeType || '').includes('pdf') || filename.toLowerCase().endsWith('.pdf')) {
      // PDF parsing temporarily disabled - return placeholder
      return 'PDF content parsing not available';
    }
    if (filename.toLowerCase().endsWith('.docx') || (mimeType || '').includes('officedocument')) {
      const r = await mammoth.extractRawText({ buffer });
      return r.value || '';
    }
  } catch (_) {}
  return '';
}

// ---------- Azure Document Intelligence (optional) ----------
function getDIConfig() {
  const v = memory.di || {};
  return {
    // Prefer your App Service env var names
    endpoint: v.endpoint
      || process.env.doc_intel_endpoint
      || process.env.DOC_INTEL_ENDPOINT
      || process.env.azure_di_endpoint
      || process.env.AZURE_DI_ENDPOINT
      || process.env.AZURE_COGNITIVE_SERVICES_ENDPOINT
      || process.env.COGNITIVE_SERVICES_ENDPOINT
      || '',
    key: v.key
      || process.env.doc_intel_key
      || process.env.DOC_INTEL_KEY
      || process.env.azure_di_key
      || process.env.AZURE_DI_KEY
      || process.env.AZURE_COGNITIVE_SERVICES_KEY
      || process.env.COGNITIVE_SERVICES_KEY
      || '',
    model: v.model || 'auto', // auto | prebuilt-receipt | prebuilt-invoice | layout
    apiVersion: v.apiVersion || '2024-07-31',
  };
}

async function analyzeWithAzureDI(buffer, mimeType, filename) {
  const cfg = getDIConfig();
  if (!cfg.endpoint || !cfg.key) return null;
  const base = cfg.endpoint.replace(/\/$/, '');
  function pickModel(name, mime) {
    const n = (name || '').toLowerCase();
    if (cfg.model && cfg.model !== 'auto') return cfg.model;
    if (n.includes('invoice')) return 'prebuilt-invoice';
    if (n.includes('receipt')) return 'prebuilt-receipt';
    if ((mime || '').includes('image')) return 'prebuilt-receipt';
    return 'prebuilt-receipt';
  }
  const model = pickModel(filename, mimeType);
  const url = `${base}/formrecognizer/documentModels/${encodeURIComponent(model)}:analyze?api-version=${encodeURIComponent(cfg.apiVersion)}`;
  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': mimeType || 'application/octet-stream', 'Ocp-Apim-Subscription-Key': cfg.key },
    body: buffer,
  });
  if (!resp.ok) throw new Error(`Azure DI analyze error ${resp.status}`);
  const opLoc = resp.headers.get('operation-location');
  if (!opLoc) throw new Error('Azure DI missing operation-location');
  let tries = 0;
  while (tries++ < 30) {
    await new Promise(r => setTimeout(r, 1000));
    const r = await fetch(opLoc, { headers: { 'Ocp-Apim-Subscription-Key': cfg.key } });
    if (!r.ok) throw new Error(`Azure DI poll error ${r.status}`);
    const j = await r.json();
    const status = j.status || j.analyzeResult?.status;
    if (status === 'succeeded') return j.analyzeResult || j.result || j;
    if (status === 'failed') throw new Error('Azure DI analysis failed');
  }
  throw new Error('Azure DI timeout');
}

function itemsFromAzureResult(az) {
  try {
    const docs = az?.documents || [];
    const out = [];
    for (const d of docs) {
      const fields = d.fields || {};
      const modelId = (az?.modelId || az?.modelVersion || d.docType || '').toString().toLowerCase();
      const get = (k) => {
        const f = fields[k];
        if (!f) return null;
        if (typeof f.valueString === 'string') return f.valueString;
        if (typeof f.content === 'string') return f.content;
        if (f.valueCurrency && typeof f.valueCurrency.amount === 'number') return f.valueCurrency.amount;
        if (typeof f.valueNumber === 'number') return f.valueNumber;
        if (typeof f.valueDate === 'string') return f.valueDate;
        return null;
      };
      const vendor = get('MerchantName') || get('VendorName') || get('MerchantAddress') || '';
      const date = get('TransactionDate') || get('InvoiceDate') || get('Date') || null;
      const total = get('Total') || get('TotalAmount') || get('GrandTotal') || get('Amount') || null;
      const items = [];
      const arr = fields.Items?.valueArray || [];
      for (const it of arr) {
        const p = it.valueObject || it.properties || {};
        const desc = p.Description?.valueString || p.Description?.content || p.ItemDescription?.valueString || '';
        const qty = p.Quantity?.valueNumber || null;
        const unit = p.UnitPrice?.valueCurrency?.amount || p.UnitPrice?.valueNumber || null;
        const lineTotal = p.TotalPrice?.valueCurrency?.amount || p.TotalPrice?.valueNumber || p.Amount?.valueCurrency?.amount || p.Amount?.valueNumber || null;
        items.push({ desc, qty, unit, total: lineTotal });
      }
      // Heuristic: decide between receipt vs invoice when using prebuilt models
      let kind = 'receipt';
      const hint = (d.docType || '').toString().toLowerCase();
      if (hint.includes('invoice') || modelId.includes('invoice') || fields.InvoiceId || fields.PurchaseOrder || fields.VendorName) {
        kind = 'invoice';
      }
      out.push({
        kind,
        vendor: vendor || undefined,
        date: date || undefined,
        amount: typeof total === 'number' ? total : undefined,
        currency: 'USD',
        details: { lines: items },
        textExcerpt: undefined,
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

function textFromAzureLayout(az) {
  try {
    // Best-effort text extraction from layout results
    // Prefer content; else concatenate lines
    if (typeof az?.content === 'string' && az.content.trim()) return az.content;
    const pages = az?.pages || [];
    const lines = [];
    for (const p of pages) {
      const lns = p.lines || [];
      for (const ln of lns) {
        if (ln.content) lines.push(ln.content);
      }
    }
    return lines.join('\n');
  } catch (_) {
    return '';
  }
}

// classifyByText moved to services/approvals.js

async function parseDocItemsWithLLM(rawText) {
  const system = {
    role: 'system',
    content: 'You extract receipts/invoices from provided content. Return strictly JSON: {"items":[{"kind":"receipt|invoice","vendor":"...","date":"YYYY-MM-DD","amount":123.45,"currency":"USD","details":{"lines":[{"desc":"...","qty":1,"unit":123.45,"total":123.45}]},"textExcerpt":"..."}]}'
  };
  const user = { role: 'user', content: `Content:\n${(rawText || '').slice(0, 25000)}` };
  const content = await llmChat([system, user], { temperature: 0, top_p: 0, max_tokens: 1000 });
  let parsed;
  try { 
    parsed = JSON.parse(content); 
  } catch { 
    const m = content.match(/\{[\s\S]*\}/); 
    if (m) {
      try {
        parsed = JSON.parse(m[0]);
      } catch {}
    }
  }
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  return items;
}

// extractApprovalsFromText moved to services/approvals.js

async function parseApprovalsWithLLM(rawText) {
  try {
    const system = {
      role: 'system',
      content: 'You extract approval decisions from provided document text. Return strictly JSON: {"approvals":[{"approver":"...","title":"...","date":"YYYY-MM-DD","decision":"approved|rejected|unknown","comments":"...","targetType":"invoice|receipt|timesheet|unknown"}]}'
    };
    const user = { role: 'user', content: `Content:\n${(rawText || '').slice(0, 25000)}` };
    const content = await llmChat([system, user], { temperature: 0, top_p: 0, max_tokens: 800 });
    let parsed;
    try { parsed = JSON.parse(content); } catch { const m = content.match(/\{[\s\S]*\}/); if (m) { try { parsed = JSON.parse(m[0]); } catch {} } }
    const arr = Array.isArray(parsed?.approvals) ? parsed.approvals : [];
    return arr;
  } catch (_) {
    return [];
  }
}

// scoreMatch and hasUnallowableKeyword moved to services/match.js

app.post('/api/docs/ingest', upload.array('files', 10), async (req, res) => {
  try {
    // Enforce GL-first: require at least one GL entry before accepting documents
    if (!Array.isArray(memory.glEntries) || memory.glEntries.length === 0) {
      return res.status(400).json({ error: 'Please import GL entries before adding receipts/invoices.' });
    }
    const files = req.files || [];
    if (!files.length) return res.status(400).json({ error: 'No files uploaded' });
    const results = [];
    for (const f of files) {
      let text = '';
      try { text = await extractTextFromBuffer(f.buffer, f.mimetype, f.originalname); } catch (_) {}
      const docId = crypto.randomUUID();
      // Persist original file for preview under /uploads/<docId>/<filename>
      let fileUrl = null;
      try {
        const safeName = path.basename(f.originalname || `doc-${docId}`);
        const dir = path.join(UPLOAD_DIR, docId);
        fs.mkdirSync(dir, { recursive: true });
        const dest = path.join(dir, safeName);
        fs.writeFileSync(dest, f.buffer);
        fileUrl = `/uploads/${encodeURIComponent(docId)}/${encodeURIComponent(safeName)}`;
      } catch (_) {}
      const docRecord = {
        id: docId,
        filename: f.originalname,
        mime_type: f.mimetype,
        text_content: text || null,
        meta: { size: f.size },
        created_at: new Date(),
        doc_type: 'unknown',
        approvals: [],
        file_url: fileUrl,
      };
      memory.documents.push(docRecord);
      let items = [];
      let codexResult = null;
      
      // Try enhanced Codex processing first (if image/pdf)
      const isImage = f.mimetype && f.mimetype.startsWith('image/');
      const isPDF = f.mimetype && f.mimetype.includes('pdf');
      
      if (isImage || isPDF) {
        try {
          // Convert GL entries to Codex format
          const codexGLEntries = memory.glEntries.map(entry => ({
            id: entry.id,
            amount: entry.amount,
            date: entry.date,
            vendor: entry.vendor,
            description: entry.description,
            account: entry.account_number
          }));
          
          codexResult = await processDocumentWorkflow(f.buffer, codexGLEntries);
          
          if (codexResult.processing_status === 'success' && codexResult.extracted_data) {
            // Convert Codex result to existing format
            items = [{
              kind: 'receipt', // Default, will be refined later
              vendor: codexResult.extracted_data.merchant,
              date: codexResult.extracted_data.date,
              amount: codexResult.extracted_data.amount,
              currency: 'USD',
              details: { 
                codex_confidence: codexResult.extracted_data.confidence_scores,
                processing_method: codexResult.processing_method 
              }
            }];
          }
        } catch (codexError) {
          console.warn('Codex processing failed, falling back to existing methods:', codexError.message);
        }
      }
      
      // Fallback to existing Azure DI if Codex didn't produce results
      if (!items.length) {
        try {
          const az = await analyzeWithAzureDI(f.buffer, f.mimetype, f.originalname);
          const parsed = itemsFromAzureResult(az);
          if (Array.isArray(parsed) && parsed.length) items = parsed;
          // Try to get text from layout output
          if (!text) {
            try { text = textFromAzureLayout(az); } catch (_) {}
            docRecord.text_content = text || docRecord.text_content;
          }
        } catch (_) {}
      }
      
      // Final fallback to LLM from raw text
      if (!items.length) {
        try { items = await parseDocItemsWithLLM(text); } catch (_) {}
      }
      // Classify document type and embedded approvals
      try {
        // Use items as strong hints
        let docType = 'unknown';
        if (items.some(i => i?.kind === 'invoice')) docType = 'invoice';
        else if (items.some(i => i?.kind === 'receipt')) docType = 'receipt';
        const { docType: t2, approvals } = classifyByText(text || '', f.originalname || '');
        if (docType === 'unknown') docType = t2;
        docRecord.doc_type = docType;
        if (Array.isArray(approvals) && approvals.length) docRecord.approvals = approvals;
        if ((!docRecord.approvals || docRecord.approvals.length === 0) && (text || '').trim()) {
          try {
            const llmAppr = await parseApprovalsWithLLM(text);
            if (Array.isArray(llmAppr) && llmAppr.length) {
              const norm = llmAppr.map(a => {
                const date = a.date && /\d/.test(a.date) ? a.date : undefined;
                const approver = a.approver || a.name || undefined;
                const decision = a.decision || 'unknown';
                const title = a.title || a.role || undefined;
                const summary = [decision === 'rejected' ? 'Rejected' : (decision === 'approved' ? 'Approved' : 'Approval'), approver ? `by ${approver}` : '', title ? `(${title})` : '', date ? `on ${date}` : ''].filter(Boolean).join(' ');
                return { approver, title, date, decision, comments: a.comments || undefined, targetType: a.targetType || undefined, summary, confidence: 0.5 };
              });
              docRecord.approvals = norm;
            }
          } catch (_) {}
        }
      } catch (_) {}
      const itemRows = items.map((it) => {
        const id = crypto.randomUUID();
        const row = {
          id,
          document_id: docId,
          kind: it.kind || null,
          vendor: it.vendor || null,
          date: it.date || null,
          amount: it.amount || null,
          currency: it.currency || null,
          details: it.details || {},
          text_excerpt: it.textExcerpt || null,
        };
        memory.docItems.push(row);
        return { id, ...it };
      });

      // Consider all GL entries for matching (no date filter)
      const gl = memory.glEntries;
      const links = [];
      const updatedGl = new Set();
      
      // If we have Codex matches, use them first
      if (codexResult && codexResult.gl_matches && codexResult.gl_matches.length > 0) {
        // Use Codex's primary match for the first item
        const primaryMatch = codexResult.gl_matches.find(m => m.match_type === 'primary') || codexResult.gl_matches[0];
        if (primaryMatch && itemRows.length > 0) {
          const it = itemRows[0];
          const matchedGL = gl.find(g => g.id === primaryMatch.gl_entry_id);
          if (matchedGL) {
            const descLines = Array.isArray(it?.details?.lines) ? it.details.lines.map(l => l?.desc).filter(Boolean) : [];
            const summary = [it.vendor, it.date, `$${it.amount}`, ...descLines].filter(Boolean).join(' | ');
            const unallowable = descLines.some(d => hasUnallowableKeyword(d));
            
            matchedGL.doc_summary = summary || null;
            matchedGL.doc_flag_unallowable = !!unallowable;
            
            links.push({ 
              document_item_id: String(it.id), 
              gl_entry_id: String(primaryMatch.gl_entry_id), 
              score: primaryMatch.match_score / 100, // Convert to 0-1 range
              doc_summary: summary, 
              doc_flag_unallowable: !!unallowable,
              codex_match: true,
              codex_discrepancies: primaryMatch.discrepancies || []
            });
            
            memory.glDocLinks.push({ 
              document_item_id: String(it.id), 
              gl_entry_id: String(primaryMatch.gl_entry_id), 
              score: primaryMatch.match_score / 100,
              doc_summary: summary, 
              doc_flag_unallowable: !!unallowable 
            });
            
            updatedGl.add(String(primaryMatch.gl_entry_id));
          }
        }
      } else {
        // Fall back to existing matching logic
        for (const it of itemRows) {
          const candidates = gl.map((g) => ({ g, sc: scoreMatch(g, it) }))
            .map(({ g, sc }) => {
              const d1 = it.date ? new Date(it.date) : null;
              const d2 = g.date ? new Date(g.date) : null;
              const deltaDays = (d1 && d2) ? Math.abs((d1 - d2) / (1000 * 60 * 60 * 24)) : Number.POSITIVE_INFINITY;
              return { g, sc, deltaDays };
            });
          // Pick best by score
          let best = { id: null, score: 0, flags: { vendorPresentBoth: false, vendorMatch: false, amountExact: false, dateClose: false } };
          for (const { g, sc } of candidates) {
            if ((sc?.score || 0) > best.score) {
              best = { id: g.id, score: sc.score || 0, flags: { vendorPresentBoth: !!sc.vendorPresentBoth, vendorMatch: !!sc.vendorMatch, amountExact: !!sc.amountExact, dateClose: !!sc.dateClose } };
            }
          }
        // Dynamic thresholding: stricter if vendor names present and mismatch
        let threshold = 0.6;
        if (best.flags.vendorPresentBoth) {
          threshold = 0.8;
          if (!best.flags.vendorMatch && best.flags.amountExact && best.flags.dateClose) {
            // Allow strong amount+date even if vendor tokens differ (e.g., Staples vs Staples Business)
            threshold = 0.7;
          }
        }
        // Fallbacks when below threshold: choose best candidate by unique/closest criteria
        let chosenId = best.id;
        let ok = !!(best.id && best.score >= threshold);
        if (!ok) {
          // Prefer exact amount; break ties by smallest date delta, then vendorMatch, then highest score
          const exact = candidates.filter(({ sc }) => !!sc.amountExact);
          if (exact.length >= 1) {
            exact.sort((a, b) => (a.deltaDays - b.deltaDays) || ((b.sc.vendorMatch?1:0) - (a.sc.vendorMatch?1:0)) || ((b.sc.score || 0) - (a.sc.score || 0)));
            chosenId = exact[0].g.id; ok = true;
          }
        }
        if (!ok) {
          // Close amount+date candidates
          const near = candidates.filter(({ sc }) => ((sc?.score || 0) >= 0.45) && !!sc.dateClose);
          if (near.length >= 1) {
            near.sort((a, b) => (a.deltaDays - b.deltaDays) || ((b.sc.vendorMatch?1:0) - (a.sc.vendorMatch?1:0)) || ((b.sc.score || 0) - (a.sc.score || 0)));
            chosenId = near[0].g.id; ok = true;
          }
        }
        if (ok && chosenId) {
          const descLines = Array.isArray(it?.details?.lines) ? it.details.lines.map(l => l?.desc).filter(Boolean) : [];
          const summary = [it.vendor, it.date, `$${it.amount}`, ...descLines].filter(Boolean).join(' | ');
          const unallowable = descLines.some(d => hasUnallowableKeyword(d));
          const gle = memory.glEntries.find(x => x.id === chosenId);
          if (gle) {
            gle.doc_summary = summary || null;
            gle.doc_flag_unallowable = !!unallowable;
            // attachments flags recomputed after batch
          }
          memory.glDocLinks.push({ document_item_id: String(it.id), gl_entry_id: String(chosenId), score: best.score, doc_summary: summary, doc_flag_unallowable: !!unallowable });
          links.push({ document_item_id: String(it.id), gl_entry_id: String(chosenId), score: best.score, doc_summary: summary, doc_flag_unallowable: !!unallowable });
          updatedGl.add(String(chosenId));
        }
        }
      }
      try {
        if (sqlite && updatedGl.size > 0) {
          const rows = Array.from(updatedGl).map((gid) => {
            const e = memory.glEntries.find(x => String(x.id) === gid);
            return e ? ({
              id: String(e.id),
              account_number: e.account_number,
              description: e.description,
              amount: e.amount,
              date: e.date ? new Date(e.date).toISOString() : null,
              category: e.category,
              vendor: e.vendor,
              contract_number: e.contract_number,
              created_at: e.created_at ? new Date(e.created_at).toISOString() : new Date().toISOString(),
              doc_summary: e.doc_summary || null,
              doc_flag_unallowable: e.doc_flag_unallowable ? 1 : 0,
            }) : null;
          }).filter(Boolean);
          if (rows.length) sqlite.insertGLEntries(rows);
        }
      } catch (_) {}
      try {
        if (sqlite) {
          sqlite.saveDocument({ id: String(docId), filename: f.originalname, mime_type: f.mimetype, text_content: text || '', created_at: new Date().toISOString(), doc_type: docRecord.doc_type || null }, docRecord.approvals || []);
          sqlite.saveDocItems(itemRows.map(i => ({ id: String(i.id), document_id: String(docId), kind: i.kind, vendor: i.vendor, date: i.date, amount: typeof i.amount === 'number' ? i.amount : null, currency: i.currency || 'USD', details: i.details || {}, text_excerpt: i.text_excerpt || null })));
          sqlite.saveLinks(links.map(l => ({ document_item_id: String(l.document_item_id), gl_entry_id: String(l.gl_entry_id), score: l.score || 0, doc_summary: l.doc_summary || null, doc_flag_unallowable: l.doc_flag_unallowable ? 1 : 0 })));
        }
      } catch (_) {}
      results.push({ 
        document_id: String(docId), 
        filename: f.originalname, 
        doc_type: docRecord.doc_type, 
        approvals: docRecord.approvals, 
        items: itemRows.map(i => ({ id: i.id, vendor: i.vendor, date: i.date, amount: i.amount, kind: i.kind })), 
        links,
        codex_processing: codexResult ? {
          processing_method: codexResult.processing_method,
          processing_time_ms: codexResult.processing_time_ms,
          confidence_scores: codexResult.extracted_data?.confidence_scores,
          matches_found: codexResult.gl_matches?.length || 0,
          primary_match_score: codexResult.gl_matches?.[0]?.match_score || null
        } : null
      });
    }
    // Refresh attachment counts on GL entries
    recomputeAttachmentFlags();
  res.json({ ok: true, results });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to ingest' });
  }
});

app.listen(port, () => console.log(`API listening on :${port}`));

// ---------- Document/Link management ----------
app.get('/api/docs/items', (req, res) => {
  try {
    res.json({ items: memory.docItems, links: memory.glDocLinks, documents: memory.documents });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.post('/api/docs/link', express.json(), (req, res) => {
  try {
    const dId = String(req.body?.document_item_id || '');
    const gId = String(req.body?.gl_entry_id || '');
    if (!dId || !gId) return res.status(400).json({ error: 'document_item_id and gl_entry_id required' });
    const exists = memory.glDocLinks.find(l => String(l.document_item_id) === dId && String(l.gl_entry_id) === gId);
    if (!exists) memory.glDocLinks.push({ document_item_id: dId, gl_entry_id: gId, score: 1.0 });
    recomputeAttachmentFlags();
    try { if (sqlite) sqlite.saveLinks([{ document_item_id: dId, gl_entry_id: gId, score: 1.0 }]); } catch (_) {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.delete('/api/docs/link', express.json(), (req, res) => {
  try {
    const dId = String(req.body?.document_item_id || '');
    const gId = String(req.body?.gl_entry_id || '');
    if (!dId || !gId) return res.status(400).json({ error: 'document_item_id and gl_entry_id required' });
    memory.glDocLinks = memory.glDocLinks.filter(l => !(String(l.document_item_id) === dId && String(l.gl_entry_id) === gId));
    recomputeAttachmentFlags();
    try { if (sqlite) sqlite.removeLink(dId, gId); } catch (_) {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Azure DI config ----------
app.get('/api/di-config', (req, res) => {
  try {
    const cfg = getDIConfig();
    res.json({ endpoint: cfg.endpoint, model: cfg.model, apiVersion: cfg.apiVersion, hasKey: !!cfg.key });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.put('/api/di-config', express.json(), (req, res) => {
  try {
    const body = req.body || {};
    memory.di = {
      endpoint: typeof body.endpoint === 'string' ? body.endpoint : (memory.di.endpoint || ''),
      model: typeof body.model === 'string' ? body.model : (memory.di.model || 'auto'),
      apiVersion: typeof body.apiVersion === 'string' && body.apiVersion ? body.apiVersion : (memory.di.apiVersion || '2024-07-31'),
      key: body.clearKey === true ? '' : (typeof body.key === 'string' ? body.key : (memory.di.key || '')),
    };
    try {
      if (sqlite) sqlite.saveConfig('di_config', memory.di);
      else saveFileConfig('di_config', memory.di);
    } catch (_) {}
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// ---------- Admin: Clear Data ----------
function safeClearUploadsDir() {
  try {
    const entries = fs.readdirSync(UPLOAD_DIR, { withFileTypes: true });
    for (const ent of entries) {
      // Only remove subfolders/files; keep UPLOAD_DIR itself mounted
      const p = path.join(UPLOAD_DIR, ent.name);
      try { fs.rmSync(p, { recursive: true, force: true }); } catch (_) {}
    }
  } catch (_) {}
}

app.delete('/api/admin/clear-gl', (req, res) => {
  try {
    memory.glEntries = [];
    memory.glDocLinks = [];
    recomputeAttachmentFlags();
    try {
      if (sqlite?.db) {
        sqlite.db.exec('DELETE FROM gl_doc_links; DELETE FROM gl_entries;');
      }
    } catch (_) {}
    res.json({ ok: true, cleared: ['gl_entries', 'gl_doc_links'] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to clear GL' });
  }
});

app.delete('/api/admin/clear-docs', (req, res) => {
  try {
    memory.documents = [];
    memory.docItems = [];
    memory.glDocLinks = [];
    safeClearUploadsDir();
    recomputeAttachmentFlags();
    try {
      if (sqlite?.db) {
        sqlite.db.exec('DELETE FROM gl_doc_links; DELETE FROM document_approvals; DELETE FROM doc_items; DELETE FROM documents;');
      }
    } catch (_) {}
    res.json({ ok: true, cleared: ['documents', 'doc_items', 'document_approvals', 'gl_doc_links', 'uploads'] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to clear documents' });
  }
});

app.delete('/api/admin/clear-all', (req, res) => {
  try {
    memory.glEntries = [];
    memory.documents = [];
    memory.docItems = [];
    memory.glDocLinks = [];
    safeClearUploadsDir();
    recomputeAttachmentFlags();
    try {
      if (sqlite?.db) {
        sqlite.db.exec([
          'DELETE FROM gl_doc_links;',
          'DELETE FROM document_approvals;',
          'DELETE FROM doc_items;',
          'DELETE FROM documents;',
          'DELETE FROM gl_entries;'
        ].join('\n'));
      }
    } catch (_) {}
    res.json({ ok: true, cleared: ['gl_entries', 'documents', 'doc_items', 'document_approvals', 'gl_doc_links', 'uploads'] });
  } catch (e) {
    res.status(500).json({ error: e.message || 'Failed to clear all data' });
  }
});

// ---------- Receipt/Approval Requirements ----------
const DEFAULT_POLICY = {
  low_dollar_waiver: { enabled: true, threshold: 25 },
  general: { receipt_threshold: 0, approval_threshold: 0 },
  categories: {
    travel: { receipt_threshold: 75, approval_threshold: 0 }, // FAR 31.205-46 often uses $75 receipt practice; configurable
    meals: { receipt_threshold: 75, approval_threshold: 0 },
    supplies: { receipt_threshold: 0, approval_threshold: 0 },
  }
};

function pickPolicyFor(entry, policy) {
  const p = policy || DEFAULT_POLICY;
  const cat = String(entry.category || entry.account_number || '').toLowerCase();
  const desc = String(entry.description || '').toLowerCase();
  const text = cat + ' ' + desc;
  if (/(airfare|flight|hotel|lodging|travel|uber|taxi|lyft|mileage)/.test(text)) return p.categories.travel || {};
  if (/(meal|dining|restaurant|food)/.test(text)) return p.categories.meals || {};
  return p.categories.supplies || {};
}

function determineRequirements(entry, policy) {
  const p = policy || DEFAULT_POLICY;
  const catPol = pickPolicyFor(entry, p);
  const amt = Number(entry.amount || 0);
  const recTh = Number(catPol.receipt_threshold || p.general.receipt_threshold || 0);
  const apprTh = Number(catPol.approval_threshold || p.general.approval_threshold || 0);

  let receiptRequired = recTh > 0 ? amt >= recTh : false;
  if (p.low_dollar_waiver?.enabled && amt > 0 && amt <= Number(p.low_dollar_waiver.threshold || 0)) {
    receiptRequired = false;
  }
  const approvalRequired = apprTh > 0 ? amt >= apprTh : false;

  const reasons = [];
  if (receiptRequired) {
    if (/travel|airfare|hotel|lodging/.test((entry.category || entry.description || '').toLowerCase())) {
      reasons.push('Receipt required (travel policy; see FAR 31.205-46)');
    } else {
      reasons.push(`Receipt required (>= $${recTh})`);
    }
  } else {
    reasons.push('Receipt not required by policy threshold');
  }
  if (approvalRequired) reasons.push(`Approval required (>= $${apprTh})`);

  return { receiptRequired, approvalRequired, reasons };
}

app.get('/api/requirements', (req, res) => {
  try {
    const cfg = memory.appConfig || {};
    const policy = cfg.policy || DEFAULT_POLICY;
    recomputeAttachmentFlags();
    const rows = memory.glEntries.map(e => {
      const r = determineRequirements(e, policy);
      const attachmentsCount = Number(e.attachmentsCount || 0);
      const hasReceipt = !!e.hasReceipt;
      const approvalsCount = Number(e.approvalsCount || 0);
      const hasApproval = !!e.hasApproval;
      return {
        id: e.id,
        receiptRequired: r.receiptRequired,
        approvalRequired: r.approvalRequired,
        hasReceipt,
        attachmentsCount,
        hasApproval,
        approvalsCount,
        reasons: r.reasons
      };
    });
    res.json({ rows, policy });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});
