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
        'Ocp-Apim-Subscription-Key': process.env.CONTENT_UNDERSTANDING_KEY,
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
    
    // Start the analysis
    const analyzeResponse = await axios.post(analyzeUrl, {
      data: imageBuffer.toString('base64')
    }, {
      headers: {
        'Ocp-Apim-Subscription-Key': process.env.CONTENT_UNDERSTANDING_KEY,
        'Content-Type': 'application/json'
      },
      params: {
        'api-version': API_VERSION,
        ...options
      }
    });

    // Get the operation location for polling
    const operationLocation = analyzeResponse.headers['operation-location'];
    if (!operationLocation) {
      throw new Error('No operation location returned from Content Understanding');
    }

    console.log(`Analysis started, polling for results...`);
    
    // Poll for results
    let result;
    let attempts = 0;
    const maxAttempts = 30;

    while (attempts < maxAttempts) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds
      
      const resultResponse = await axios.get(operationLocation, {
        headers: {
          'Ocp-Apim-Subscription-Key': process.env.CONTENT_UNDERSTANDING_KEY
        }
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
      throw new Error('Analysis timed out or failed');
    }

    console.log(`Document analysis completed successfully`);
    
    return {
      method: 'content_understanding',
      success: true,
      data: await extractContentUnderstandingData(result),
      rawResult: result
    };

  } catch (error) {
    console.error('Content Understanding Analysis Error:', error);
    return {
      method: 'content_understanding',
      success: false,
      error: error.message
    };
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
        // Amount field
        const numericValue = parseFloat(String(value).replace(/[^0-9.-]/g, ''));
        if (!isNaN(numericValue)) {
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
  
  try {
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
  } catch (error) {
    console.warn('Date normalization failed:', error);
  }
  
  return null;
}

/**
 * Default analyzer configurations for receipts and invoices
 */
const DEFAULT_RECEIPT_ANALYZER_CONFIG = {
  description: "Receipt analyzer for extracting amount, date, and merchant",
  fieldSchema: [
    {
      name: "Total",
      type: "number",
      description: "Total amount on receipt",
      method: "extract"
    },
    {
      name: "Date", 
      type: "date",
      description: "Transaction date",
      method: "extract"
    },
    {
      name: "Merchant",
      type: "string", 
      description: "Merchant name",
      method: "extract"
    }
  ]
};

const DEFAULT_INVOICE_ANALYZER_CONFIG = {
  description: "Invoice analyzer for extracting amount, date, and vendor",
  fieldSchema: [
    {
      name: "TotalAmount",
      type: "number",
      description: "Total invoice amount",
      method: "extract"
    },
    {
      name: "InvoiceDate",
      type: "date", 
      description: "Invoice date",
      method: "extract"
    },
    {
      name: "VendorName",
      type: "string",
      description: "Vendor or supplier name",
      method: "extract"
    }
  ]
};

/**
 * Initialize default analyzers
 */
async function initializeAnalyzers() {
  try {
    console.log('Content Understanding credentials detected - analyzer initialization temporarily disabled');
    console.log('Server running with Content Understanding API configured for document analysis');
    // TODO: Fix analyzer configuration format and re-enable
    // const receiptAnalyzerId = process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID || 'receipt-analyzer';
    // const invoiceAnalyzerId = process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID || 'invoice-analyzer';
    // await createAnalyzer(receiptAnalyzerId, DEFAULT_RECEIPT_ANALYZER_CONFIG);
    // await createAnalyzer(invoiceAnalyzerId, DEFAULT_INVOICE_ANALYZER_CONFIG);
  } catch (error) {
    console.error('Failed to initialize analyzers:', error.message);
    // Don't throw - let the application continue with degraded functionality
  }
}

export {
  createAnalyzer,
  analyzeDocument,
  extractContentUnderstandingData,
  initializeAnalyzers,
  DEFAULT_RECEIPT_ANALYZER_CONFIG,
  DEFAULT_INVOICE_ANALYZER_CONFIG
};