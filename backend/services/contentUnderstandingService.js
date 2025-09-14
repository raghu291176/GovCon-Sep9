import axios from 'axios';

/**
 * Microsoft Content Understanding Service
 * Replaces Azure Document Intelligence with more advanced document analysis capabilities
 */

const API_VERSION = process.env.CONTENT_UNDERSTANDING_API_VERSION || '2025-05-01-preview';

/**
 * Create or update a Content Understanding analyzer
 */
async function createAnalyzer(analyzerId, config) {
  if (!process.env.CONTENT_UNDERSTANDING_ENDPOINT || !process.env.CONTENT_UNDERSTANDING_KEY) {
    throw new Error('Content Understanding not configured (CONTENT_UNDERSTANDING_ENDPOINT and CONTENT_UNDERSTANDING_KEY required)');
  }

  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT.replace(/\/$/, '');
  const url = `${endpoint}/contentunderstanding/analyzers/${analyzerId}`;

  try {
    console.log(`Creating/updating analyzer: ${analyzerId}`);
    
    const response = await axios.put(url, config, {
      headers: {
        // Azure AI (services.ai.azure.com) uses 'api-key' header
        'api-key': process.env.CONTENT_UNDERSTANDING_KEY,
        'Content-Type': 'application/json'
      },
      params: {
        'api-version': API_VERSION
      }
    });

    console.log(`Analyzer ${analyzerId} created/updated successfully`);
    return response.data;
  } catch (error) {
    console.error(`Failed to create analyzer ${analyzerId}:`, error.response?.data || error.message);
    throw error;
  }
}

/**
 * Analyze a document using Content Understanding
 */
async function analyzeDocument(analyzerId, imageBuffer, options = {}) {
  if (!process.env.CONTENT_UNDERSTANDING_ENDPOINT || !process.env.CONTENT_UNDERSTANDING_KEY) {
    return {
      method: 'content_understanding',
      success: false,
      error: 'Content Understanding not configured (CONTENT_UNDERSTANDING_ENDPOINT and CONTENT_UNDERSTANDING_KEY required)'
    };
  }

  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT.replace(/\/$/, '');
  const analyzeUrl = `${endpoint}/contentunderstanding/analyzers/${analyzerId}:analyze`;

  try {
    console.log(`Analyzing document with analyzer: ${analyzerId}`);

    // Build request per Quickstart spec (JSON only)
    const headers = {
      'api-key': process.env.CONTENT_UNDERSTANDING_KEY,
      'Accept': 'application/json',
      'Content-Type': 'application/json'
    };

    const params = {
      'api-version': API_VERSION,
      ...(process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION
        ? { processingLocation: process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION }
        : {}),
      ...(options.query || {})
    };

    const body = options.documentUrl
      ? { input: { document: { url: options.documentUrl } } }
      : { input: { document: { data: imageBuffer.toString('base64'), mimeType: options.mimeType || 'application/octet-stream' } } };

    const analyzeResponse = await axios.post(analyzeUrl, body, { headers, params, timeout: getPollTimeoutMs() });

    // Get the operation location for polling
    const operationLocation = analyzeResponse.headers['operation-location'] || analyzeResponse.headers['Operation-Location'];
    if (!operationLocation) {
      const body = analyzeResponse?.data ? JSON.stringify(analyzeResponse.data).slice(0, 500) : '';
      throw new Error(`No operation-location header from Content Understanding. Body: ${body}`);
    }

    console.log(`Analysis started, polling for results...`);
    
    // Poll for results
    let result;
    let attempts = 0;
    const maxAttempts = getMaxAttempts();
    const intervalMs = getPollIntervalMs();

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, intervalMs));
      
      const resultResponse = await axios.get(operationLocation, {
        headers: {
          // Azure AI (services.ai.azure.com) uses 'api-key' header
          'api-key': process.env.CONTENT_UNDERSTANDING_KEY
        },
        timeout: getPollTimeoutMs()
      });

      if (resultResponse.data.status === 'succeeded') {
        result = resultResponse.data;
        break;
      } else if (resultResponse.data.status === 'failed') {
        throw new Error(`Analysis failed: ${resultResponse.data.error?.message || 'Unknown error'}`);
      }

      attempts++;
    }

    if (!result || result.status !== 'succeeded') {
      throw new Error(`Analysis timed out after ${maxAttempts} attempts`);
    }

    console.log(`Document analysis completed successfully`);
    
    return {
      method: 'content_understanding',
      success: true,
      data: await extractContentUnderstandingData(result),
      rawResult: result
    };

  } catch (error) {
    const status = error?.response?.status;
    const data = error?.response?.data;
    console.error('Content Understanding Analysis Error:', status, data || error?.message || error);
    return {
      method: 'content_understanding',
      success: false,
      error: error?.message || 'Content Understanding analyze failed',
      status,
      details: data
    };
  }
}

/**
 * Retrieve analyzer metadata (existence/ready check)
 */
async function getAnalyzerInfo(analyzerId) {
  if (!process.env.CONTENT_UNDERSTANDING_ENDPOINT || !process.env.CONTENT_UNDERSTANDING_KEY) {
    return { ok: false, error: 'Not configured' };
  }

  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT.replace(/\/$/, '');
  const url = `${endpoint}/contentunderstanding/analyzers/${analyzerId}`;

  try {
    const resp = await axios.get(url, {
      headers: { 'api-key': process.env.CONTENT_UNDERSTANDING_KEY },
      params: { 'api-version': API_VERSION },
      timeout: 10000
    });
    return { ok: true, data: resp.data };
  } catch (err) {
    return { ok: false, status: err?.response?.status, error: err?.response?.data || err?.message };
  }
}

/**
 * Extract standardized data from Content Understanding results
 */
async function extractContentUnderstandingData(result) {
  try {
    const analyzedDocument = result.result?.analyzedDocument;
    if (!analyzedDocument) {
      return {
        amount: { value: null, confidence: 0 },
        date: { value: null, confidence: 0 },
        merchant: { value: null, confidence: 0 },
        confidence: 0
      };
    }

    // Extract fields from Content Understanding response
    const fields = analyzedDocument.fields || {};
    
    // Amount extraction
    const amount = extractFieldValue(fields, ['Total', 'Amount', 'TotalAmount', 'SubTotal', 'total', 'amount']);
    
    // Date extraction  
    const date = extractFieldValue(fields, ['Date', 'TransactionDate', 'InvoiceDate', 'ReceiptDate', 'date']);
    
    // Merchant/Vendor extraction
    const merchant = extractFieldValue(fields, ['Merchant', 'Vendor', 'MerchantName', 'VendorName', 'Supplier', 'Company', 'merchant', 'vendor']);

    // Calculate overall confidence
    const confidences = [amount.confidence, date.confidence, merchant.confidence].filter(c => c > 0);
    const overallConfidence = confidences.length > 0 ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0;

    return {
      amount: amount,
      date: date,
      merchant: merchant,
      confidence: overallConfidence
    };

  } catch (error) {
    console.error('Error extracting Content Understanding data:', error);
    return {
      amount: { value: null, confidence: 0 },
      date: { value: null, confidence: 0 },
      merchant: { value: null, confidence: 0 },
      confidence: 0
    };
  }
}

/**
 * Extract field value with fallback to multiple possible field names
 */
function extractFieldValue(fields, possibleNames) {
  for (const fieldName of possibleNames) {
    const field = fields[fieldName];
    if (field) {
      let value = null;
      let confidence = 0;

      if (field.content || field.value || field.valueString) {
        value = field.content || field.value || field.valueString;
        confidence = field.confidence || 0.8; // Default confidence if not provided
      } else if (typeof field === 'string' || typeof field === 'number') {
        value = field;
        confidence = 0.7; // Lower confidence for simple values
      }

      // Post-process based on field type
      if (possibleNames.some(name => name.toLowerCase().includes('amount') || name.toLowerCase().includes('total'))) {
        // Amount field (locale-aware parsing)
        const numericValue = parseAmountLocaleAware(value);
        if (numericValue !== null && isFinite(numericValue)) {
          return { value: numericValue, confidence: confidence };
        }
      } else if (possibleNames.some(name => name.toLowerCase().includes('date'))) {
        // Date field
        const dateValue = normalizeDate(value);
        if (dateValue) {
          return { value: dateValue, confidence: confidence };
        }
      } else {
        // Text field (merchant, vendor, etc.)
        const textValue = String(value).trim();
        if (textValue.length > 0 && textValue.length < 100) {
          return { value: textValue, confidence: confidence };
        }
      }
    }
  }

  return { value: null, confidence: 0 };
}

/**
 * Normalize date to YYYY-MM-DD format
 */
function normalizeDate(dateValue) {
  if (!dateValue) return null;

  // Already a Date
  if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
    return dateValue.toISOString().split('T')[0];
  }

  const s = String(dateValue).trim();

  // ISO-like: 2024-03-15 or 2024/03/15 or 2024.03.15
  let m = s.match(/^\s*(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})\s*$/);
  if (m) {
    const y = parseInt(m[1], 10);
    const mo = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const dt = new Date(Date.UTC(y, mo, d));
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }

  // US or EU: 03/15/2024 or 15/03/2024
  m = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/);
  if (m) {
    let a = parseInt(m[1], 10);
    let b = parseInt(m[2], 10);
    let y = parseInt(m[3], 10);
    if (y < 100) y += 2000;
    // Heuristic: if first > 12, treat as DD/MM; else treat as MM/DD
    let mm, dd;
    if (a > 12 && b <= 12) { dd = a; mm = b; }
    else { mm = a; dd = b; }
    const dt = new Date(Date.UTC(y, mm - 1, dd));
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }

  // Month name variants: Mar 15, 2024 / March 15, 2024
  if (/\b[a-zA-Z]{3,9}\b/.test(s)) {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  }

  // Fallback
  try {
    const dt = new Date(s);
    if (!isNaN(dt.getTime())) return dt.toISOString().slice(0, 10);
  } catch (_) {}

  return null;
}

// Parse amounts robustly across common locales
function parseAmountLocaleAware(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return val;
  let s = String(val).trim();
  if (!s) return null;
  // Handle negatives in parentheses
  let negative = false;
  if (/^\(.*\)$/.test(s)) { negative = true; s = s.slice(1, -1); }
  // Remove currency symbols and spaces
  s = s.replace(/[\$€£¥\s]/g, '');
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');
  // Both separators present: decide decimal as the rightmost
  if (hasComma && hasDot) {
    const lastComma = s.lastIndexOf(',');
    const lastDot = s.lastIndexOf('.');
    const decIsComma = lastComma > lastDot;
    // Remove all group separators, keep decimal separator as '.'
    if (decIsComma) {
      s = s.replace(/\./g, ''); // remove thousands dots
      s = s.replace(/,/g, '.');
    } else {
      s = s.replace(/,/g, ''); // remove thousands commas
    }
  } else if (hasComma && !hasDot) {
    // Likely EU decimal comma if exactly two decimals
    if (/\d+,\d{2}$/.test(s)) {
      s = s.replace(/\./g, '');
      s = s.replace(/,/g, '.');
    } else {
      s = s.replace(/,/g, ''); // treat comma as thousands
    }
  } else {
    // Only dot or none: remove stray commas
    s = s.replace(/,/g, '');
  }
  const num = parseFloat(s);
  if (isNaN(num)) return null;
  return negative ? -num : num;
}

/**
 * Default analyzer configurations for receipts and invoices
 */
const DEFAULT_RECEIPT_ANALYZER_CONFIG = {
  description: "GL-matching receipt analyzer: outputs Amount, Date, MerchantName",
  fieldSchema: [
    { name: "Amount", type: "number", description: "Total receipt amount", method: "extract" },
    { name: "Date", type: "date", description: "Transaction date", method: "extract" },
    { name: "MerchantName", type: "string", description: "Merchant or vendor name", method: "extract" }
  ]
};

const DEFAULT_INVOICE_ANALYZER_CONFIG = {
  description: "GL-matching invoice analyzer: outputs Amount, Date, MerchantName",
  fieldSchema: [
    { name: "Amount", type: "number", description: "Total invoice amount", method: "extract" },
    { name: "Date", type: "date", description: "Invoice date", method: "extract" },
    { name: "MerchantName", type: "string", description: "Vendor or supplier name", method: "extract" }
  ]
};

/**
 * Initialize default analyzers
 */
async function initializeAnalyzers() {
  try {
    if (!process.env.CONTENT_UNDERSTANDING_ENDPOINT || !process.env.CONTENT_UNDERSTANDING_KEY) {
      console.log('Content Understanding not configured; skipping analyzer initialization');
      return;
    }
    const receiptAnalyzerId = process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID || 'receipt-analyzer';
    const invoiceAnalyzerId = process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID || 'invoice-analyzer';

    // Ensure analyzers exist with GL-aligned fields
    await createAnalyzer(receiptAnalyzerId, DEFAULT_RECEIPT_ANALYZER_CONFIG).catch(e => {
      console.warn('Receipt analyzer create/update failed:', e?.response?.status, e?.response?.data || e?.message);
    });
    await createAnalyzer(invoiceAnalyzerId, DEFAULT_INVOICE_ANALYZER_CONFIG).catch(e => {
      console.warn('Invoice analyzer create/update failed:', e?.response?.status, e?.response?.data || e?.message);
    });
  } catch (error) {
    console.error('Failed to initialize analyzers:', error.message);
    // Don't throw - let the application continue with degraded functionality
  }
}

// Polling configuration helpers
function getPollIntervalMs() {
  const v = parseInt(process.env.CONTENT_UNDERSTANDING_POLL_INTERVAL_MS || '2000', 10);
  return Number.isFinite(v) && v > 0 ? v : 2000;
}

function getMaxAttempts() {
  const v = parseInt(process.env.CONTENT_UNDERSTANDING_MAX_ATTEMPTS || '45', 10); // ~90s default
  return Number.isFinite(v) && v > 0 ? v : 45;
}

function getPollTimeoutMs() {
  const v = parseInt(process.env.CONTENT_UNDERSTANDING_REQUEST_TIMEOUT_MS || '90000', 10);
  return Number.isFinite(v) && v >= 10000 ? v : 90000;
}

export {
  createAnalyzer,
  analyzeDocument,
  extractContentUnderstandingData,
  initializeAnalyzers,
  getAnalyzerInfo,
  DEFAULT_RECEIPT_ANALYZER_CONFIG,
  DEFAULT_INVOICE_ANALYZER_CONFIG
};
