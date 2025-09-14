import axios from 'axios';

/**
 * Microsoft Content Understanding Service
 * Replaces Azure Document Intelligence with more advanced document analysis capabilities
 */

const API_VERSION = process.env.CONTENT_UNDERSTANDING_API_VERSION || '2025-05-01-preview';

/**
 * Build headers for Content Understanding. Per Microsoft docs some samples use
 * 'api-key' (Project endpoint) while others show 'Ocp-Apim-Subscription-Key'.
 * We prefer 'api-key' but can fall back to Ocp header if 401 is returned, or
 * force a header via CONTENT_UNDERSTANDING_AUTH_HEADER=api-key|ocp.
 */
function buildCUHeaders(contentType = 'application/json', prefer) {
  const key = process.env.CONTENT_UNDERSTANDING_KEY;
  const mode = (prefer || process.env.CONTENT_UNDERSTANDING_AUTH_HEADER || 'api-key').toLowerCase();
  const base = { Accept: 'application/json', 'Content-Type': contentType };
  if (mode === 'ocp') return { ...base, 'Ocp-Apim-Subscription-Key': key };
  return { ...base, 'api-key': key };
}

/**
 * Detect MIME type from buffer content
 */
function detectMimeType(buffer) {
  if (!buffer || buffer.length === 0) return 'application/octet-stream';
  
  const header = buffer.subarray(0, 8);
  
  // PDF signature
  if (header[0] === 0x25 && header[1] === 0x50 && header[2] === 0x44 && header[3] === 0x46) {
    return 'application/pdf';
  }
  
  // PNG signature
  if (header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47) {
    return 'image/png';
  }
  
  // JPEG signature
  if (header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF) {
    return 'image/jpeg';
  }
  
  // TIFF signatures
  if ((header[0] === 0x49 && header[1] === 0x49 && header[2] === 0x2A && header[3] === 0x00) ||
      (header[0] === 0x4D && header[1] === 0x4D && header[2] === 0x00 && header[3] === 0x2A)) {
    return 'image/tiff';
  }
  
  // BMP signature
  if (header[0] === 0x42 && header[1] === 0x4D) {
    return 'image/bmp';
  }
  
  // Default fallback
  return 'application/pdf'; // Default to PDF for document analysis
}

/**
 * Validate required parameters for analyzer operations
 */
function validateAnalyzerParams(analyzerId) {
  if (!analyzerId || typeof analyzerId !== 'string' || analyzerId.trim() === '') {
    throw new Error('analyzerId is required and must be a non-empty string');
  }
  
  if (!process.env.CONTENT_UNDERSTANDING_ENDPOINT) {
    throw new Error('CONTENT_UNDERSTANDING_ENDPOINT environment variable is required');
  }
  
  if (!process.env.CONTENT_UNDERSTANDING_KEY) {
    throw new Error('CONTENT_UNDERSTANDING_KEY environment variable is required');
  }
}

/**
 * Create or update a Content Understanding analyzer
 */
async function createAnalyzer(analyzerId, config) {
  validateAnalyzerParams(analyzerId);
  
  if (!config || typeof config !== 'object') {
    throw new Error('config is required and must be an object');
  }

  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT.replace(/\/$/, '');
  const url = `${endpoint}/contentunderstanding/analyzers/${analyzerId}`;

  try {
    console.log(`Creating/updating analyzer: ${analyzerId}`);
    
    const response = await axios.put(url, config, {
      headers: buildCUHeaders('application/json'),
      params: {
        'api-version': API_VERSION,
        ...(process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION
          ? { processingLocation: process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION }
          : {})
      },
      timeout: 30000 // 30 second timeout
    });

    console.log(`Analyzer ${analyzerId} created/updated successfully`);
    return response.data;
  } catch (error) {
    const status = error?.response?.status;
    const body = error?.response?.data || error.message;
    // Retry once with alternate header if 401 and we initially used api-key
    if (status === 401 && (process.env.CONTENT_UNDERSTANDING_AUTH_HEADER || '').toLowerCase() !== 'ocp') {
      try {
        console.warn(`Create analyzer ${analyzerId}: 401 with api-key; retrying with Ocp-Apim-Subscription-Key header...`);
        const response = await axios.put(url, config, {
          headers: buildCUHeaders('application/json', 'ocp'),
          params: {
            'api-version': API_VERSION,
            ...(process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION
              ? { processingLocation: process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION }
              : {})
          },
          timeout: 30000
        });
        console.log(`Analyzer ${analyzerId} created/updated successfully (fallback header)`);
        return response.data;
      } catch (e2) {
        // fall through to detailed log below
      }
    }

    // Enhanced error messaging
    if (status === 401) {
      console.error(`Failed to create analyzer ${analyzerId}: 401 Unauthorized. Check CONTENT_UNDERSTANDING_KEY and endpoint configuration.`);
    } else if (status === 400) {
      console.error(`Failed to create analyzer ${analyzerId}: 400 Bad Request. Invalid analyzer configuration:`, body);
    } else if (status === 409) {
      console.error(`Failed to create analyzer ${analyzerId}: 409 Conflict. Analyzer may already exist with different configuration.`);
    } else {
      console.error(`Failed to create analyzer ${analyzerId}: ${status}`, body);
    }
    throw error;
  }
}

/**
 * Analyze a document using Content Understanding
 */
async function analyzeDocument(analyzerId, imageBuffer, options = {}) {
  try {
    validateAnalyzerParams(analyzerId);
    
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error('imageBuffer is required and must be a non-empty Buffer');
    }
  } catch (error) {
    return {
      method: 'content_understanding',
      success: false,
      error: error.message
    };
  }

  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT.replace(/\/$/, '');
  const analyzeUrl = `${endpoint}/contentunderstanding/analyzers/${analyzerId}:analyze`;

  try {
    console.log(`Analyzing document with analyzer: ${analyzerId}`);

    // Detect MIME type if not provided
    const mimeType = options.mimeType || detectMimeType(imageBuffer);
    
    // Build request headers
    let headers = buildCUHeaders('application/json');

    // Build request parameters
    const params = {
      'api-version': API_VERSION,
      ...(process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION
        ? { processingLocation: process.env.CONTENT_UNDERSTANDING_PROCESSING_LOCATION }
        : {}),
      ...(options.query || {})
    };

    // Build request body
    const body = options.documentUrl
      ? { input: { document: { url: options.documentUrl } } }
      : { 
          input: { 
            document: { 
              data: imageBuffer.toString('base64'), 
              mimeType: mimeType 
            } 
          } 
        };

    // Start analysis
    let analyzeResponse;
    try {
      analyzeResponse = await axios.post(analyzeUrl, body, { headers, params, timeout: getPollTimeoutMs() });
    } catch (e1) {
      const st = e1?.response?.status;
      if (st === 401 && (process.env.CONTENT_UNDERSTANDING_AUTH_HEADER || '').toLowerCase() !== 'ocp') {
        // Retry with alternate header
        console.warn('Analyze: 401 with api-key; retrying with Ocp-Apim-Subscription-Key header...');
        headers = buildCUHeaders('application/json', 'ocp');
        analyzeResponse = await axios.post(analyzeUrl, body, { headers, params, timeout: getPollTimeoutMs() });
      } else {
        throw e1;
      }
    }

    // Get the operation location for polling
    const operationLocation = analyzeResponse.headers['operation-location'] || 
                              analyzeResponse.headers['Operation-Location'];
    
    if (!operationLocation) {
      const responseBody = analyzeResponse?.data ? JSON.stringify(analyzeResponse.data).slice(0, 500) : '';
      throw new Error(`No operation-location header from Content Understanding. Response: ${responseBody}`);
    }

    console.log(`Analysis started, polling for results at: ${operationLocation}`);
    
    // Poll for results with improved error handling
    const result = await pollForResults(operationLocation);
    
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
 * Poll for analysis results with improved error handling
 */
async function pollForResults(operationLocation) {
  let attempts = 0;
  const maxAttempts = getMaxAttempts();
  const intervalMs = getPollIntervalMs();

  while (attempts < maxAttempts) {
    await new Promise(resolve => setTimeout(resolve, intervalMs));
    
    try {
      let pollHeaders = buildCUHeaders(undefined);
      let resultResponse;
      try {
        resultResponse = await axios.get(operationLocation, { headers: pollHeaders, timeout: getPollTimeoutMs() });
      } catch (e1) {
        if (e1?.response?.status === 401 && (process.env.CONTENT_UNDERSTANDING_AUTH_HEADER || '').toLowerCase() !== 'ocp') {
          console.warn('Poll: 401 with api-key; retrying with Ocp-Apim-Subscription-Key header...');
          pollHeaders = buildCUHeaders(undefined, 'ocp');
          resultResponse = await axios.get(operationLocation, { headers: pollHeaders, timeout: getPollTimeoutMs() });
        } else {
          throw e1;
        }
      }

      const status = resultResponse.data.status;
      
      if (status === 'succeeded') {
        return resultResponse.data;
      } else if (status === 'failed') {
        const errorMsg = resultResponse.data.error?.message || 'Unknown error';
        throw new Error(`Analysis failed: ${errorMsg}`);
      } else if (status === 'canceled' || status === 'cancelled') {
        throw new Error('Analysis was canceled');
      }
      
      // Continue polling for 'running' or other statuses
      console.log(`Analysis status: ${status}, attempt ${attempts + 1}/${maxAttempts}`);
      
    } catch (error) {
      // Handle HTTP errors during polling
      if (error?.response?.status === 404) {
        throw new Error('Analysis operation not found or expired');
      } else if (error?.response?.status >= 500) {
        // Server errors - continue polling but log the error
        console.warn(`Server error during polling (attempt ${attempts + 1}): ${error.message}`);
      } else if (!error.message.includes('Analysis failed') && !error.message.includes('canceled')) {
        // Network or other errors - continue polling
        console.warn(`Network error during polling (attempt ${attempts + 1}): ${error.message}`);
      } else {
        // Analysis-specific errors - don't continue polling
        throw error;
      }
    }

    attempts++;
  }

  throw new Error(`Analysis timed out after ${maxAttempts} attempts (${(maxAttempts * intervalMs) / 1000}s)`);
}

/**
 * Retrieve analyzer metadata (existence/ready check)
 */
async function getAnalyzerInfo(analyzerId) {
  try {
    validateAnalyzerParams(analyzerId);
  } catch (error) {
    return { ok: false, error: error.message };
  }

  const endpoint = process.env.CONTENT_UNDERSTANDING_ENDPOINT.replace(/\/$/, '');
  const url = `${endpoint}/contentunderstanding/analyzers/${analyzerId}`;

  try {
    const resp = await axios.get(url, {
      headers: { 'api-key': process.env.CONTENT_UNDERSTANDING_KEY },
      params: { 'api-version': API_VERSION },
      timeout: 15000 // 15 second timeout
    });
    return { ok: true, data: resp.data };
  } catch (err) {
    const status = err?.response?.status;
    const error = err?.response?.data || err?.message;
    
    if (status === 404) {
      return { ok: false, status, error: 'Analyzer not found' };
    }
    
    return { ok: false, status, error };
  }
}

/**
 * Extract standardized data from Content Understanding results
 */
async function extractContentUnderstandingData(result) {
  try {
    // Handle different possible response structures
    const analyzedDocument = result?.result?.analyzedDocument || 
                              result?.analyzedDocument || 
                              result?.results?.[0]?.analyzedDocument;
    
    if (!analyzedDocument) {
      console.warn('No analyzedDocument found in result structure');
      return createEmptyResult();
    }

    // Extract fields from Content Understanding response
    const fields = analyzedDocument.fields || {};
    
    // Amount extraction with multiple field name attempts
    const amount = extractFieldValue(fields, [
      'Total', 'Amount', 'TotalAmount', 'SubTotal', 'GrandTotal', 
      'total', 'amount', 'totalAmount', 'subTotal'
    ]);
    
    // Date extraction with multiple field name attempts
    const date = extractFieldValue(fields, [
      'Date', 'TransactionDate', 'InvoiceDate', 'ReceiptDate', 'PurchaseDate',
      'date', 'transactionDate', 'invoiceDate', 'receiptDate'
    ]);
    
    // Merchant/Vendor extraction with multiple field name attempts
    const merchant = extractFieldValue(fields, [
      'Merchant', 'Vendor', 'MerchantName', 'VendorName', 'Supplier', 'Company', 
      'Store', 'Shop', 'merchant', 'vendor', 'merchantName', 'vendorName'
    ]);

    // Calculate overall confidence
    const confidences = [amount.confidence, date.confidence, merchant.confidence].filter(c => c > 0);
    const overallConfidence = confidences.length > 0 ? 
      confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0;

    return {
      amount: amount,
      date: date,
      merchant: merchant,
      confidence: overallConfidence
    };

  } catch (error) {
    console.error('Error extracting Content Understanding data:', error);
    return createEmptyResult();
  }
}

/**
 * Create empty result structure
 */
function createEmptyResult() {
  return {
    amount: { value: null, confidence: 0 },
    date: { value: null, confidence: 0 },
    merchant: { value: null, confidence: 0 },
    confidence: 0
  };
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

      // Handle different field structures
      if (field.content !== undefined) {
        value = field.content;
        confidence = field.confidence || 0.8;
      } else if (field.value !== undefined) {
        value = field.value;
        confidence = field.confidence || 0.8;
      } else if (field.valueCurrency && typeof field.valueCurrency.amount === 'number') {
        value = field.valueCurrency.amount;
        confidence = field.confidence || 0.8;
      } else if (typeof field.valueNumber === 'number') {
        value = field.valueNumber;
        confidence = field.confidence || 0.8;
      } else if (field.valueString !== undefined) {
        value = field.valueString;
        confidence = field.confidence || 0.8;
      } else if (field.text !== undefined) {
        value = field.text;
        confidence = field.confidence || 0.7;
      } else if (typeof field === 'string' || typeof field === 'number') {
        value = field;
        confidence = 0.6; // Lower confidence for simple values
      }

      if (value === null || value === undefined) continue;

      // Post-process based on field type
      if (possibleNames.some(name => name.toLowerCase().includes('amount') || name.toLowerCase().includes('total'))) {
        // Amount field
        const numericValue = parseAmountLocaleAware(value);
        if (numericValue !== null && isFinite(numericValue) && numericValue >= 0) {
          return { value: numericValue, confidence: Math.min(confidence, 1.0) };
        }
      } else if (possibleNames.some(name => name.toLowerCase().includes('date'))) {
        // Date field
        const dateValue = normalizeDate(value);
        if (dateValue) {
          return { value: dateValue, confidence: Math.min(confidence, 1.0) };
        }
      } else {
        // Text field (merchant, vendor, etc.)
        const textValue = String(value).trim();
        if (textValue.length > 0 && textValue.length <= 200) { // Increased max length
          return { value: textValue, confidence: Math.min(confidence, 1.0) };
        }
      }
    }
  }

  return { value: null, confidence: 0 };
}

/**
 * Enhanced date normalization with better error handling
 */
function normalizeDate(dateValue) {
  if (!dateValue) return null;

  try {
    // Already a Date object
    if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
      return dateValue.toISOString().split('T')[0];
    }

    const s = String(dateValue).trim();
    if (!s) return null;

    // ISO-like formats: 2024-03-15, 2024/03/15, 2024.03.15
    let match = s.match(/^\s*(\d{4})[\-\/.](\d{1,2})[\-\/.](\d{1,2})\s*$/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1; // JavaScript months are 0-based
      const day = parseInt(match[3], 10);
      
      if (year >= 1900 && year <= 2100 && month >= 0 && month <= 11 && day >= 1 && day <= 31) {
        const date = new Date(Date.UTC(year, month, day));
        if (!isNaN(date.getTime())) {
          return date.toISOString().slice(0, 10);
        }
      }
    }

    // US/EU date formats: MM/DD/YYYY or DD/MM/YYYY
    match = s.match(/^\s*(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s*$/);
    if (match) {
      let first = parseInt(match[1], 10);
      let second = parseInt(match[2], 10);
      let year = parseInt(match[3], 10);
      
      // Handle 2-digit years
      if (year < 100) {
        year += year < 50 ? 2000 : 1900;
      }
      
      // Heuristic: if first number > 12, assume DD/MM format
      let month, day;
      if (first > 12 && second <= 12) {
        day = first;
        month = second;
      } else if (second > 12 && first <= 12) {
        day = second;
        month = first;
      } else {
        // Default to MM/DD for US format when ambiguous
        month = first;
        day = second;
      }
      
      if (year >= 1900 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        const date = new Date(Date.UTC(year, month - 1, day));
        if (!isNaN(date.getTime())) {
          return date.toISOString().slice(0, 10);
        }
      }
    }

    // Try parsing month names: "March 15, 2024", "15 Mar 2024", etc.
    if (/\b[a-zA-Z]{3,9}\b/.test(s)) {
      const date = new Date(s);
      if (!isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
        return date.toISOString().slice(0, 10);
      }
    }

    // Final fallback attempt
    const date = new Date(s);
    if (!isNaN(date.getTime()) && date.getFullYear() >= 1900 && date.getFullYear() <= 2100) {
      return date.toISOString().slice(0, 10);
    }

  } catch (error) {
    console.warn('Date parsing error:', error.message, 'for value:', dateValue);
  }

  return null;
}

/**
 * Enhanced amount parsing with better locale support and error handling
 */
function parseAmountLocaleAware(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') return isFinite(val) ? Math.abs(val) : null;
  
  let s = String(val).trim();
  if (!s) return null;
  
  try {
    // Handle negative amounts in parentheses: (123.45)
    let isNegative = false;
    if (/^\(.*\)$/.test(s)) {
      isNegative = true;
      s = s.slice(1, -1).trim();
    }
    
    // Handle explicit negative signs
    if (s.startsWith('-')) {
      isNegative = true;
      s = s.slice(1).trim();
    }
    
    // Remove currency symbols and extra spaces
    s = s.replace(/[\$€£¥₹¢\s]/g, '');
    
    // Remove any trailing text like "USD", "EUR", etc.
    s = s.replace(/[A-Za-z]+$/g, '').trim();
    
    if (!s) return null;
    
    const hasComma = s.includes(',');
    const hasDot = s.includes('.');
    
    if (hasComma && hasDot) {
      // Both separators present - determine which is decimal
      const lastComma = s.lastIndexOf(',');
      const lastDot = s.lastIndexOf('.');
      
      if (lastComma > lastDot) {
        // Comma is decimal separator (EU format): 1.234.567,89
        s = s.replace(/\./g, ''); // Remove thousands separators
        s = s.replace(',', '.'); // Convert decimal comma to dot
      } else {
        // Dot is decimal separator (US format): 1,234,567.89
        s = s.replace(/,/g, ''); // Remove thousands separators
      }
    } else if (hasComma && !hasDot) {
      // Only comma present - could be thousands or decimal
      const commaMatch = s.match(/,\d+$/);
      if (commaMatch && commaMatch[0].length === 3) {
        // Likely decimal comma (EU format): 123,45
        s = s.replace(',', '.');
      } else {
        // Likely thousands separator: 1,234
        s = s.replace(/,/g, '');
      }
    }
    // If only dot present, assume it's correct (US format)
    
    const num = parseFloat(s);
    if (!isFinite(num)) return null;
    
    // Reasonable bounds check
    if (num > 1000000000) return null; // Over 1 billion seems unrealistic
    
    // For GL matching totals, return absolute value consistently
    return Math.abs(num);
    
  } catch (error) {
    console.warn('Amount parsing error:', error.message, 'for value:', val);
    return null;
  }
}

/**
 * Default analyzer configurations for receipts and invoices
 */
const DEFAULT_RECEIPT_ANALYZER_CONFIG = {
  description: "GL-matching receipt analyzer: extracts Amount, Date, and MerchantName from receipts",
  fieldSchema: [
    { name: "Amount", type: "number", description: "Total receipt amount including tax", method: "extract" },
    { name: "Date", type: "date", description: "Transaction or receipt date", method: "extract" },
    { name: "MerchantName", type: "string", description: "Name of the merchant, store, or business", method: "extract" }
  ]
};

const DEFAULT_INVOICE_ANALYZER_CONFIG = {
  description: "GL-matching invoice analyzer: extracts Amount, Date, and MerchantName from invoices",
  fieldSchema: [
    { name: "Amount", type: "number", description: "Total invoice amount including tax", method: "extract" },
    { name: "Date", type: "date", description: "Invoice date or due date", method: "extract" },
    { name: "MerchantName", type: "string", description: "Name of the vendor, supplier, or service provider", method: "extract" }
  ]
};

/**
 * Initialize default analyzers with better error handling
 */
async function initializeAnalyzers() {
  try {
    // Check if initialization should be skipped
    if (String(process.env.CONTENT_UNDERSTANDING_SKIP_INITIALIZE || '').toLowerCase() === 'true') {
      console.log('Skipping Content Understanding analyzer initialization (CONTENT_UNDERSTANDING_SKIP_INITIALIZE=true)');
      return { success: true, message: 'Initialization skipped by configuration' };
    }
    
    // Check if required configuration is present
    if (!process.env.CONTENT_UNDERSTANDING_ENDPOINT || !process.env.CONTENT_UNDERSTANDING_KEY) {
      console.log('Content Understanding not configured; skipping analyzer initialization');
      return { success: false, message: 'Configuration missing' };
    }

    console.log('Initializing Content Understanding analyzers...');
    
    const receiptAnalyzerId = process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID || 'receipt-analyzer';
    const invoiceAnalyzerId = process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID || 'invoice-analyzer';

    const results = {};

    // Initialize receipt analyzer
    try {
      await createAnalyzer(receiptAnalyzerId, DEFAULT_RECEIPT_ANALYZER_CONFIG);
      results.receiptAnalyzer = { success: true, id: receiptAnalyzerId };
      console.log(`Receipt analyzer initialized successfully: ${receiptAnalyzerId}`);
    } catch (error) {
      results.receiptAnalyzer = { success: false, id: receiptAnalyzerId, error: error.message };
      console.warn('Receipt analyzer initialization failed:', error.message);
    }

    // Initialize invoice analyzer
    try {
      await createAnalyzer(invoiceAnalyzerId, DEFAULT_INVOICE_ANALYZER_CONFIG);
      results.invoiceAnalyzer = { success: true, id: invoiceAnalyzerId };
      console.log(`Invoice analyzer initialized successfully: ${invoiceAnalyzerId}`);
    } catch (error) {
      results.invoiceAnalyzer = { success: false, id: invoiceAnalyzerId, error: error.message };
      console.warn('Invoice analyzer initialization failed:', error.message);
    }

    const successCount = Object.values(results).filter(r => r.success).length;
    const totalCount = Object.keys(results).length;
    
    console.log(`Analyzer initialization completed: ${successCount}/${totalCount} successful`);
    
    return { 
      success: successCount > 0, 
      results, 
      message: `${successCount}/${totalCount} analyzers initialized successfully` 
    };
    
  } catch (error) {
    console.error('Failed to initialize analyzers:', error.message);
    return { 
      success: false, 
      error: error.message, 
      message: 'Initialization failed' 
    };
  }
}

// Configuration helpers with validation
function getPollIntervalMs() {
  const envValue = process.env.CONTENT_UNDERSTANDING_POLL_INTERVAL_MS || '2000';
  const value = parseInt(envValue, 10);
  return Number.isFinite(value) && value >= 1000 ? value : 2000; // Minimum 1 second
}

function getMaxAttempts() {
  const envValue = process.env.CONTENT_UNDERSTANDING_MAX_ATTEMPTS || '60'; // Increased default
  const value = parseInt(envValue, 10);
  return Number.isFinite(value) && value > 0 ? value : 60;
}

function getPollTimeoutMs() {
  const envValue = process.env.CONTENT_UNDERSTANDING_REQUEST_TIMEOUT_MS || '120000'; // Increased default
  const value = parseInt(envValue, 10);
  return Number.isFinite(value) && value >= 10000 ? value : 120000; // Minimum 10 seconds
}

export {
  createAnalyzer,
  analyzeDocument,
  extractContentUnderstandingData,
  initializeAnalyzers,
  getAnalyzerInfo,
  detectMimeType,
  validateAnalyzerParams,
  DEFAULT_RECEIPT_ANALYZER_CONFIG,
  DEFAULT_INVOICE_ANALYZER_CONFIG
};
