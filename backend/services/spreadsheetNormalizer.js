/**
 * Spreadsheet Normalizer for GL data
 *
 * Features
 * - Accepts CSV/XLSX buffers – header row may be anywhere
 * - Uses Azure GPT-4o (via Azure OpenAI Chat Completions) to detect header row and map to a standard schema
 * - Robust local fallbacks for header detection and mapping when LLM unavailable
 * - Normalizes dates to ISO (yyyy-MM-dd) and amounts to floats with international format handling
 * - Exposes modular functions and an end-to-end normalizeSpreadsheet() workflow
 * - Export helpers for CSV, XLSX, JSON
 *
 * Minimal Usage
 *   import { normalizeSpreadsheet, exportToCSV } from './backend/services/spreadsheetNormalizer.js';
 *   const { rows, mapping, headerRowIndex, logs } = await normalizeSpreadsheet(buffer, { filename: 'gl.xlsx' });
 *   const csv = exportToCSV(rows);
 */

import { parse as parseCSV } from 'csv-parse/sync';
import ExcelJS from 'exceljs';
import { parse as parseDateFns, isValid as isValidDate, format as formatDate } from 'date-fns';
import currency from 'currency.js';

// ============== Config / Azure LLM helper =================
function getAzureConfig() {
  const baseUrl = (process.env.AZURE_OPENAI_ENDPOINT || process.env.azure_ai_endpoint || '').trim().replace(/\/$/, '');
  const apiKey = process.env.OPENAI_API_KEY || process.env.AZURE_OPENAI_API_KEY || process.env.AZURE_OPENAI_KEY || '';
  const deployment = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4o';
  const apiVersion = process.env.AZURE_OPENAI_API_VERSION || '2025-01-01-preview';
  return { baseUrl, apiKey, deployment, apiVersion };
}

async function azureChat(messages, { temperature = 0, max_tokens = 600, jsonMode = true } = {}) {
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

// ============== Parsing helpers =================

function detectFileKind(filename = '') {
  const lower = String(filename || '').toLowerCase();
  if (lower.endsWith('.csv')) return 'csv';
  if (lower.endsWith('.xlsx') || lower.endsWith('.xls')) return 'xlsx';
  return 'unknown';
}

async function bufferToRows(buffer, { filename } = {}) {
  const kind = detectFileKind(filename);
  if (kind === 'csv') {
    const text = new TextDecoder().decode(buffer);
    const records = parseCSV(text, { relaxColumnCount: true, skip_empty_lines: true });
    return records; // AOA
  }
  // Default to XLSX parsing with ExcelJS
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const worksheet = workbook.worksheets[0];
  if (!worksheet) return [];

  const rows = [];
  worksheet.eachRow((row, rowIndex) => {
    const values = [];
    row.eachCell((cell, colIndex) => {
      values[colIndex - 1] = cell.value;
    });
    rows.push(values);
  });
  return rows; // AOA
}

// ============== Header detection =================

const STANDARD_FIELDS = [
  'date', 'accountNumber', 'description', 'amount', 'category', 'vendor', 'contractNumber'
];

const SYNONYMS = {
  date: ['date', 'posting date', 'txn date', 'transaction date', 'post date', 'invoice date']
    .map(s => s.toLowerCase()),
  accountNumber: ['account number', 'account', 'account no', 'acct', 'acct number', 'gl account', 'glaccount']
    .map(s => s.toLowerCase()),
  description: ['description', 'memo', 'details', 'detail', 'item description', 'narration']
    .map(s => s.toLowerCase()),
  amount: ['amount', 'amount$', 'amountusd', 'total', 'totalamount', 'lineamount', 'extendedamount',
    'netamount', 'grossamount', 'amt', 'transactionamount', 'amountus$', 'amount($)', 'debit', 'credit']
    .map(s => s.toLowerCase()),
  category: ['category', 'gl category', 'account type', 'type', 'expense type']
    .map(s => s.toLowerCase()),
  vendor: ['vendor', 'vendor name', 'supplier', 'payee', 'merchant']
    .map(s => s.toLowerCase()),
  contractNumber: ['contract number', 'contract', 'contract #', 'contract#', 'contractno', 
    'contract_number', 'contract_no', 'contract num', 'contract_num', 'contractnum',
    'contract id', 'contract_id', 'contract identifier', 'job number', 'job_number',
    'project number', 'project_number', 'award number', 'award_number']
    .map(s => s.toLowerCase()),
};

const LOWER_ALNUM = s => String(s || '').toLowerCase().replace(/[^a-z0-9]/g, '');

function detectHeaderRowLocal(aoa, maxScan = 20) {
  const set = new Set(Object.values(SYNONYMS).flat().map(LOWER_ALNUM));
  const limit = Math.min(aoa.length, Math.max(5, maxScan));
  let bestIdx = 0, bestScore = -Infinity;
  for (let r = 0; r < limit; r++) {
    const row = aoa[r] || [];
    let score = 0;
    for (const cell of row) {
      const norm = LOWER_ALNUM(cell);
      if (!norm) continue;
      if (set.has(norm)) score += 3;
      if (/[a-z]/i.test(String(cell || ''))) score += 1;
      if (/(amount|date|vendor|account|description|category|contract)/i.test(String(cell || ''))) score += 2;
    }
    const numericish = row.filter(v => String(v || '').trim() && !(/[a-z]/i.test(String(v)))).length;
    const nonEmpty = row.filter(v => String(v || '').trim()).length;
    if (numericish > nonEmpty / 2) score -= 3;
    if (score > bestScore) { bestScore = score; bestIdx = r; }
  }
  return bestIdx;
}

async function detectHeaderRowWithGPT(aoa) {
  const head = aoa.slice(0, 30);
  const preview = head.map(r => r.map(c => String(c)).join('\t')).join('\n');
  const system = { role: 'system', content: 'You identify header rows in CSV/XLSX data.' };
  const user = { role: 'user', content: `Given the following table preview, return JSON {"headerRowIndex": <number starting at 0>}.
${preview}` };
  try {
    const content = await azureChat([system, user], { jsonMode: true, max_tokens: 200 });
    if (!content) return null;
    const j = JSON.parse(content);
    const idx = Number(j.headerRowIndex);
    if (Number.isFinite(idx) && idx >= 0 && idx < aoa.length) return idx;
  } catch (_) {}
  return null;
}

// ============== Header mapping =================

function mapHeadersLocal(headers) {
  const idx = {};
  const hnorm = headers.map(h => LOWER_ALNUM(h));
  for (const field of STANDARD_FIELDS) {
    const syn = SYNONYMS[field].map(LOWER_ALNUM);
    let i = hnorm.findIndex(h => syn.includes(h));
    // amount fallback for separate debit/credit
    if (i < 0 && field === 'amount') {
      const di = hnorm.findIndex(h => SYNONYMS.amount.includes('debit') && h.includes('debit'));
      const ci = hnorm.findIndex(h => SYNONYMS.amount.includes('credit') && h.includes('credit'));
      if (di >= 0 || ci >= 0) i = Math.max(di, ci);
    }
    idx[field] = i;
  }
  return idx; // e.g., {date: 2, amount: 5, ...}
}

async function mapHeadersWithGPT(headers) {
  const system = { role: 'system', content: 'You map spreadsheet headers to a fixed schema.' };
  const user = { role: 'user', content: `Headers: ${JSON.stringify(headers)}
Return JSON: {"mapping": {"date": <idx or -1>, "accountNumber": <idx or -1>, "description": <idx or -1>, "amount": <idx or -1>, "category": <idx or -1>, "vendor": <idx or -1>, "contractNumber": <idx or -1>}}` };
  try {
    const content = await azureChat([system, user], { jsonMode: true, max_tokens: 300 });
    if (!content) return null;
    const j = JSON.parse(content);
    const m = j.mapping || {};
    const mapping = {};
    for (const f of STANDARD_FIELDS) mapping[f] = Number(m[f] ?? -1);
    return mapping;
  } catch (_) { return null; }
}

// ============== Value normalization =================

const DATE_PATTERNS = [
  'MM/dd/yyyy', 'M/d/yyyy', 'MM-dd-yyyy', 'dd/MM/yyyy', 'd/M/yyyy', 'dd-MM-yyyy',
  'yyyy-MM-dd', 'yyyy/MM/dd', 'MMM d, yyyy', 'MMMM d, yyyy', 'd MMM yyyy', 'd MMMM yyyy',
  'MM/dd/yy', 'dd/MM/yy', 'yyyy-M-d', 'M/d/yy'
];

function normalizeDateValue(val) {
  if (!val && val !== 0) return null;
  if (val instanceof Date && !isNaN(val)) return formatDate(val, 'yyyy-MM-dd');
  // Excel serial
  if (typeof val === 'number' && Number.isFinite(val) && val > 20000 && val < 60000) {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    const d = new Date(epoch.getTime() + val * 86400000);
    return formatDate(d, 'yyyy-MM-dd');
  }
  const s = String(val).trim();
  for (const pat of DATE_PATTERNS) {
    const d = parseDateFns(s, pat, new Date());
    if (isValidDate(d)) return formatDate(d, 'yyyy-MM-dd');
  }
  const d2 = new Date(s);
  if (!isNaN(d2)) return formatDate(d2, 'yyyy-MM-dd');
  return null;
}

function normalizeAmountValue(val) {
  if (val === null || val === undefined || val === '') return null;
  if (typeof val === 'number' && Number.isFinite(val)) return Number(val);
  let s = String(val).trim();
  if (!s) return null;
  let negative = false;
  
  // Handle parentheses for negative amounts (including with currency symbols)
  // Check for patterns like ($123.45), $(123.45), (123.45$), etc.
  if (/^\(.*\)$/.test(s)) { 
    negative = true; 
    s = s.slice(1, -1).trim(); 
  }
  
  // Remove currency symbols and apostrophes/space separators
  s = s.replace(/[\$€£¥₹₩₽₺¢ CHFUSDINRJPYKRWSEKEURGBP]|[\s\']+/gi, '');
  
  // Try currency.js tolerant parse by cleaning separators heuristically
  // Detect comma+dot vs single type
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  if (hasComma && hasDot) {
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) { s = s.replace(/\./g, ''); s = s.replace(',', '.'); }
    else { s = s.replace(/,/g, ''); }
  } else if (hasComma && !hasDot) {
    const m = s.match(/,\d{2}$/); s = m ? s.replace(',', '.') : s.replace(/,/g, '');
  }
  try {
    const c = currency(s);
    const n = c.value;
    return negative ? -Math.abs(n) : Math.abs(n);
  } catch { return null; }
}

// ============== Core normalization =================

function normalizeRow(row, mapping) {
  const out = {
    date: null,
    accountNumber: null,
    description: null,
    amount: null,
    category: null,
    vendor: null,
    contractNumber: null,
  };
  const pick = (idx) => (Number.isInteger(idx) && idx >= 0 && idx < row.length) ? row[idx] : null;
  out.date = normalizeDateValue(pick(mapping.date));
  out.accountNumber = pick(mapping.accountNumber) != null ? String(pick(mapping.accountNumber)).trim() : null;
  out.description = pick(mapping.description) != null ? String(pick(mapping.description)).trim() : null;
  const amtRaw = pick(mapping.amount);
  out.amount = normalizeAmountValue(amtRaw != null ? amtRaw : ( // fallback debit - credit
    (mapping.debit >= 0 || mapping.credit >= 0)
      ? (normalizeAmountValue(pick(mapping.debit)) || 0) - (normalizeAmountValue(pick(mapping.credit)) || 0)
      : null
  ));
  out.category = pick(mapping.category) != null ? String(pick(mapping.category)).trim() : null;
  out.vendor = pick(mapping.vendor) != null ? String(pick(mapping.vendor)).trim() : null;
  out.contractNumber = pick(mapping.contractNumber) != null ? String(pick(mapping.contractNumber)).trim() : null;
  return out;
}

/**
 * Normalize an uploaded spreadsheet buffer into standard GL schema.
 * @param {Buffer|Uint8Array} buffer
 * @param {{ filename?: string, useLLM?: boolean }} options
 * @returns {Promise<{rows: Array, mapping: Object, headerRowIndex: number, logs: Array<string>, warnings: Array<string>, errors: Array<string>}>>
 */
export async function normalizeSpreadsheet(buffer, { filename = 'upload.xlsx', useLLM = true } = {}) {
  const logs = []; const warnings = []; const errors = [];
  const aoa = await bufferToRows(buffer, { filename });
  if (!Array.isArray(aoa) || aoa.length === 0) return { rows: [], mapping: {}, headerRowIndex: 0, logs, warnings, errors: ['Empty spreadsheet'] };

  let headerRowIndex = null;
  if (useLLM) {
    try { headerRowIndex = await detectHeaderRowWithGPT(aoa); logs.push('LLM header detection attempted'); } catch (e) { warnings.push('LLM header detection failed'); }
  }
  if (headerRowIndex == null) { headerRowIndex = detectHeaderRowLocal(aoa); logs.push(`Local header detection used: row ${headerRowIndex}`); }

  const headers = (aoa[headerRowIndex] || []).map(v => String(v || ''));
  let mapping = null;
  if (useLLM) { mapping = await mapHeadersWithGPT(headers).catch(() => null); }
  if (!mapping) { mapping = mapHeadersLocal(headers); logs.push('Local header mapping used'); }
  // Include debit/credit indices if present for fallback math
  mapping.debit = headers.findIndex(h => /(^|\b)(debit|dr)(\b|$)/i.test(h));
  mapping.credit = headers.findIndex(h => /(^|\b)(credit|cr)(\b|$)/i.test(h));

  const dataRows = aoa.slice(headerRowIndex + 1);
  const normalized = [];
  for (const row of dataRows) {
    const out = normalizeRow(row, mapping);
    // skip empty rows with no core data
    const hasAny = Object.values(out).some(v => v !== null && String(v).trim() !== '');
    if (hasAny) normalized.push(out);
  }

  return { rows: normalized, mapping, headerRowIndex, logs, warnings, errors };
}

// ============== Export helpers =================

export function exportToCSV(rows) {
  if (!Array.isArray(rows) || rows.length === 0) return '';
  const headers = Object.keys(rows[0]);
  const escape = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  const lines = [headers.join(',')];
  for (const r of rows) lines.push(headers.map(h => escape(r[h])).join(','));
  return lines.join('\n');
}

export async function exportToXLSX(rows) {
  const workbook = new ExcelJS.Workbook();
  const worksheet = workbook.addWorksheet('Normalized');

  if (!Array.isArray(rows) || rows.length === 0) {
    return await workbook.xlsx.writeBuffer();
  }

  // Add headers
  const headers = Object.keys(rows[0]);
  worksheet.addRow(headers);

  // Add data rows
  rows.forEach(row => {
    const values = headers.map(header => row[header]);
    worksheet.addRow(values);
  });

  return await workbook.xlsx.writeBuffer();
}

export function exportToJSON(rows) {
  return Buffer.from(JSON.stringify(rows || [], null, 2));
}

// ============== Public, composable parts =================
export const header = {
  detectLocal: detectHeaderRowLocal,
  detectWithGPT: detectHeaderRowWithGPT,
  mapLocal: mapHeadersLocal,
  mapWithGPT: mapHeadersWithGPT,
};

export const normalize = {
  date: normalizeDateValue,
  amount: normalizeAmountValue,
  row: normalizeRow,
};

export default {
  normalizeSpreadsheet,
  exportToCSV,
  exportToXLSX,
  exportToJSON,
  header,
  normalize,
};

