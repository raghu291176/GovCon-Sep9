import DocumentIntelligence, { getLongRunningPoller, isUnexpected } from "@azure-rest/ai-document-intelligence";

/**
 * Azure Document Intelligence Service
 * Uses prebuilt models for receipt and invoice analysis
 */

/**
 * Create Document Intelligence client
 */
function createClient() {
  const endpoint = process.env.DOCUMENT_INTELLIGENCE_ENDPOINT || process.env.AZURE_DOCUMENT_INTELLIGENCE_ENDPOINT;
  const key = process.env.DOCUMENT_INTELLIGENCE_KEY || process.env.AZURE_DOCUMENT_INTELLIGENCE_KEY;

  if (!endpoint || !key) {
    throw new Error('DOCUMENT_INTELLIGENCE_ENDPOINT and DOCUMENT_INTELLIGENCE_KEY environment variables are required');
  }

  return DocumentIntelligence(endpoint.replace(/\/$/, ''), { key });
}

/**
 * Retrieve Document Intelligence model metadata (existence/ready check)
 */
async function getModelInfo(modelId) {
  try {
    const client = createClient();
    const resp = await client.path("/documentModels/{modelId}", modelId).get();
    if (isUnexpected(resp)) {
      return { ok: false, status: resp.status, error: resp.body?.error?.message || 'unexpected_response' };
    }
    return { ok: true, data: resp.body };
  } catch (err) {
    const status = err?.response?.status;
    const error = err?.response?.data || err?.message;
    return { ok: false, status, error };
  }
}

/**
 * Analyze document using Document Intelligence prebuilt models
 */
async function analyzeDocument(modelId, imageBuffer, options = {}) {
  try {
    if (!imageBuffer || !Buffer.isBuffer(imageBuffer) || imageBuffer.length === 0) {
      throw new Error('imageBuffer is required and must be a non-empty Buffer');
    }

    const client = createClient();

    console.log(`Analyzing document with model: ${modelId}`);

    // Convert buffer to base64 for Document Intelligence
    const base64Data = imageBuffer.toString('base64');

    const initialResponse = await client
      .path("/documentModels/{modelId}:analyze", modelId)
      .post({
        contentType: "application/json",
        body: {
          base64Source: base64Data
        },
      });

    if (isUnexpected(initialResponse)) {
      throw new Error(`Document Intelligence API error: ${initialResponse.body.error?.message || 'Unknown error'}`);
    }

    console.log('Analysis started, polling for results...');

    const poller = getLongRunningPoller(client, initialResponse);
    const result = await poller.pollUntilDone();
    const analyzeResult = result.body.analyzeResult;

    console.log('Document analysis completed successfully');

    return {
      method: 'document_intelligence',
      success: true,
      data: await extractDocumentIntelligenceData(analyzeResult, modelId),
      rawResult: analyzeResult
    };

  } catch (error) {
    console.error('Document Intelligence Analysis Error:', error.message);

    return {
      method: 'document_intelligence',
      success: false,
      error: error.message || 'Document Intelligence analyze failed'
    };
  }
}

/**
 * Extract standardized data from Document Intelligence results
 */
async function extractDocumentIntelligenceData(analyzeResult, modelId) {
  try {
    const documents = analyzeResult?.documents;
    const document = documents && documents[0];

    if (!document) {
      console.warn('No document found in analysis result');
      return createEmptyResult();
    }

    const fields = document.fields || {};

    // Extract core required fields
    let amount = { value: null, confidence: 0 };
    let date = { value: null, confidence: 0 };
    let merchant = { value: null, confidence: 0 };
    let description = { value: null, confidence: 0 };
    let summary = { value: null, confidence: 0 };

    if (modelId === 'prebuilt-receipt') {
      // Receipt-specific field extraction
      amount = extractReceiptTotal(fields);
      date = extractReceiptDate(fields);
      merchant = extractReceiptMerchant(fields);
      description = extractReceiptDescription(fields);
      summary = extractReceiptSummary(fields);

      // Additional receipt-specific fields
      const receiptType = extractField(fields.ReceiptType);
      const merchantPhone = extractField(fields.MerchantPhoneNumber);
      const merchantAddress = extractField(fields.MerchantAddress);
      const transactionTime = extractField(fields.TransactionTime);
      const subtotal = extractField(fields.Subtotal, 'currency');
      const tax = extractField(fields.Tax, 'currency');
      const tip = extractField(fields.Tip, 'currency');

      // Calculate confidence including additional fields
      const allFields = [amount, date, merchant, description, summary, receiptType, merchantPhone, merchantAddress, transactionTime, subtotal, tax, tip];
      const confidences = allFields.map(f => f.confidence).filter(c => c > 0);
      const overallConfidence = confidences.length > 0 ?
        confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0;

      return {
        amount: amount,
        date: date,
        merchant: merchant,
        description: description,
        summary: summary,
        // Additional receipt fields
        receiptType: receiptType,
        merchantPhone: merchantPhone,
        merchantAddress: merchantAddress,
        transactionTime: transactionTime,
        subtotal: subtotal,
        tax: tax,
        tip: tip,
        confidence: overallConfidence
      };
    } else if (modelId === 'prebuilt-invoice') {
      // Invoice-specific field extraction
      amount = extractInvoiceTotal(fields);
      date = extractInvoiceDate(fields);
      merchant = extractInvoiceVendor(fields);
      description = extractInvoiceDescription(fields);
      summary = extractInvoiceSummary(fields);

      // Additional invoice-specific fields
      const invoiceId = extractField(fields.InvoiceId);
      const customerName = extractField(fields.CustomerName);
      const billingAddress = extractField(fields.BillingAddress);
      const subTotal = extractField(fields.SubTotal, 'currency');
      const tax = extractField(fields.Tax, 'currency');
      const dueDate = extractField(fields.DueDate, 'date');

      // Calculate confidence including additional fields
      const allFields = [amount, date, merchant, description, summary, invoiceId, customerName, billingAddress, subTotal, tax, dueDate];
      const confidences = allFields.map(f => f.confidence).filter(c => c > 0);
      const overallConfidence = confidences.length > 0 ?
        confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0;

      return {
        amount: amount,
        date: date,
        merchant: merchant,
        description: description,
        summary: summary,
        // Additional invoice fields
        invoiceId: invoiceId,
        customerName: customerName,
        billingAddress: billingAddress,
        subTotal: subTotal,
        tax: tax,
        dueDate: dueDate,
        confidence: overallConfidence
      };
    }

    // Calculate overall confidence for receipts
    const confidences = [amount.confidence, date.confidence, merchant.confidence, description.confidence, summary.confidence].filter(c => c > 0);
    const overallConfidence = confidences.length > 0 ?
      confidences.reduce((sum, c) => sum + c, 0) / confidences.length : 0;

    return {
      amount: amount,
      date: date,
      merchant: merchant,
      description: description,
      summary: summary,
      confidence: overallConfidence
    };

  } catch (error) {
    console.error('Error extracting Document Intelligence data:', error);
    return createEmptyResult();
  }
}

/**
 * Extract receipt total amount
 */
function extractReceiptTotal(fields) {
  const totalField = fields.Total;
  if (totalField && totalField.valueCurrency) {
    return {
      value: totalField.valueCurrency.amount,
      confidence: totalField.confidence || 0.8
    };
  }
  return { value: null, confidence: 0 };
}

/**
 * Extract receipt date
 */
function extractReceiptDate(fields) {
  const dateField = fields.TransactionDate;
  if (dateField && dateField.valueDate) {
    return {
      value: dateField.valueDate,
      confidence: dateField.confidence || 0.8
    };
  }
  return { value: null, confidence: 0 };
}

/**
 * Extract receipt merchant name
 */
function extractReceiptMerchant(fields) {
  const merchantField = fields.MerchantName;
  if (merchantField && merchantField.valueString) {
    return {
      value: merchantField.valueString.trim(),
      confidence: merchantField.confidence || 0.8
    };
  }
  return { value: null, confidence: 0 };
}

/**
 * Extract invoice total amount
 */
function extractInvoiceTotal(fields) {
  const totalField = fields.TotalAmount || fields.SubTotal;
  if (totalField && totalField.valueCurrency) {
    return {
      value: totalField.valueCurrency.amount,
      confidence: totalField.confidence || 0.8
    };
  }
  return { value: null, confidence: 0 };
}

/**
 * Extract invoice date
 */
function extractInvoiceDate(fields) {
  const dateField = fields.InvoiceDate || fields.DueDate;
  if (dateField && dateField.valueDate) {
    return {
      value: dateField.valueDate,
      confidence: dateField.confidence || 0.8
    };
  }
  return { value: null, confidence: 0 };
}

/**
 * Extract invoice vendor name
 */
function extractInvoiceVendor(fields) {
  const vendorField = fields.VendorName;
  if (vendorField && vendorField.valueString) {
    return {
      value: vendorField.valueString.trim(),
      confidence: vendorField.confidence || 0.8
    };
  }
  return { value: null, confidence: 0 };
}

/**
 * Extract receipt description from items with detailed information
 */
function extractReceiptDescription(fields) {
  // Extract detailed items from Items field
  const itemsField = fields.Items;
  if (itemsField && itemsField.valueArray && itemsField.valueArray.length > 0) {
    const itemDescriptions = itemsField.valueArray
      .map(item => {
        const itemObj = item.valueObject;
        if (!itemObj) return null;

        const description = itemObj.Description?.valueString || 'Item';
        const quantity = itemObj.Quantity?.valueNumber || 1;
        const unitPrice = itemObj.UnitPrice?.valueCurrency?.amount || null;
        const totalPrice = itemObj.TotalPrice?.valueCurrency?.amount || null;

        let itemDesc = description.trim();
        if (quantity > 1) itemDesc += ` (x${quantity})`;
        if (unitPrice) itemDesc += ` @ $${unitPrice}`;
        if (totalPrice) itemDesc += ` = $${totalPrice}`;

        return itemDesc;
      })
      .filter(Boolean);

    if (itemDescriptions.length > 0) {
      return {
        value: itemDescriptions.join('; '),
        confidence: itemsField.confidence || 0.8
      };
    }
  }

  return { value: null, confidence: 0 };
}

/**
 * Extract receipt summary using correct Document Intelligence field names
 */
function extractReceiptSummary(fields) {
  const merchantField = fields.MerchantName;
  const totalField = fields.Total;
  const dateField = fields.TransactionDate;
  const timeField = fields.TransactionTime;
  const receiptTypeField = fields.ReceiptType;
  const subtotalField = fields.Subtotal;
  const taxField = fields.Tax;
  const tipField = fields.Tip;

  let summaryParts = [];

  if (receiptTypeField && receiptTypeField.valueString) {
    summaryParts.push(`${receiptTypeField.valueString.trim()} Receipt`);
  }

  if (merchantField && merchantField.valueString) {
    summaryParts.push(`from ${merchantField.valueString.trim()}`);
  }

  if (totalField && totalField.valueCurrency) {
    summaryParts.push(`Total: $${totalField.valueCurrency.amount}`);
  }

  if (subtotalField && subtotalField.valueCurrency) {
    summaryParts.push(`Subtotal: $${subtotalField.valueCurrency.amount}`);
  }

  if (taxField && taxField.valueCurrency) {
    summaryParts.push(`Tax: $${taxField.valueCurrency.amount}`);
  }

  if (tipField && tipField.valueCurrency) {
    summaryParts.push(`Tip: $${tipField.valueCurrency.amount}`);
  }

  if (dateField && (dateField.valueDate || dateField.valueString)) {
    const dateValue = dateField.valueDate || dateField.valueString;
    let dateTimeStr = `Date: ${dateValue}`;

    if (timeField && timeField.valueString) {
      dateTimeStr += ` ${timeField.valueString}`;
    }

    summaryParts.push(dateTimeStr);
  }

  if (summaryParts.length > 0) {
    const allFields = [merchantField, totalField, dateField, timeField, receiptTypeField, subtotalField, taxField, tipField]
      .filter(f => f && f.confidence > 0);

    const avgConfidence = allFields.length > 0 ?
      allFields.reduce((sum, f) => sum + f.confidence, 0) / allFields.length : 0;

    return {
      value: summaryParts.join(' | '),
      confidence: avgConfidence || 0.7
    };
  }

  return { value: null, confidence: 0 };
}

/**
 * Extract invoice description from line items
 */
function extractInvoiceDescription(fields) {
  // Extract from Items field (line items)
  const itemsField = fields.Items;
  if (itemsField && itemsField.valueArray && itemsField.valueArray.length > 0) {
    const descriptions = itemsField.valueArray
      .map(item => {
        const desc = item.valueObject?.Description;
        return desc && desc.valueString ? desc.valueString.trim() : null;
      })
      .filter(Boolean);

    if (descriptions.length > 0) {
      return {
        value: descriptions.join('; '),
        confidence: itemsField.confidence || 0.8
      };
    }
  }

  return { value: null, confidence: 0 };
}

/**
 * Extract invoice summary using correct Document Intelligence field names
 */
function extractInvoiceSummary(fields) {
  const vendorField = fields.VendorName;
  const totalField = fields.TotalAmount;
  const invoiceIdField = fields.InvoiceId;
  const dateField = fields.InvoiceDate;
  const customerField = fields.CustomerName;
  const taxField = fields.Tax;
  const dueDateField = fields.DueDate;

  let summaryParts = [];

  if (vendorField && vendorField.valueString) {
    summaryParts.push(`Invoice from ${vendorField.valueString.trim()}`);
  }

  if (invoiceIdField && invoiceIdField.valueString) {
    summaryParts.push(`#${invoiceIdField.valueString.trim()}`);
  }

  if (customerField && customerField.valueString) {
    summaryParts.push(`To: ${customerField.valueString.trim()}`);
  }

  if (totalField && totalField.valueCurrency) {
    summaryParts.push(`Total: $${totalField.valueCurrency.amount}`);
  }

  if (taxField && taxField.valueCurrency) {
    summaryParts.push(`Tax: $${taxField.valueCurrency.amount}`);
  }

  if (dateField && (dateField.valueDate || dateField.valueString)) {
    const dateValue = dateField.valueDate || dateField.valueString;
    summaryParts.push(`Invoice Date: ${dateValue}`);
  }

  if (dueDateField && (dueDateField.valueDate || dueDateField.valueString)) {
    const dueDateValue = dueDateField.valueDate || dueDateField.valueString;
    summaryParts.push(`Due: ${dueDateValue}`);
  }

  if (summaryParts.length > 0) {
    const fields_with_confidence = [vendorField, totalField, invoiceIdField, dateField, customerField, taxField, dueDateField]
      .filter(f => f && f.confidence > 0);

    const avgConfidence = fields_with_confidence.length > 0 ?
      fields_with_confidence.reduce((sum, f) => sum + f.confidence, 0) / fields_with_confidence.length : 0;

    return {
      value: summaryParts.join(' | '),
      confidence: avgConfidence || 0.7
    };
  }

  return { value: null, confidence: 0 };
}

/**
 * Generic field extractor helper
 */
function extractField(field, type = 'string') {
  if (!field) return { value: null, confidence: 0 };

  let value = null;
  const confidence = field.confidence || 0.7;

  switch (type) {
    case 'currency':
      if (field.valueCurrency) {
        value = field.valueCurrency.amount;
      }
      break;
    case 'date':
      value = field.valueDate || field.valueString;
      break;
    case 'string':
    default:
      value = field.valueString;
      break;
  }

  return {
    value: value ? String(value).trim() : null,
    confidence: value ? confidence : 0
  };
}

/**
 * Create empty result structure
 */
function createEmptyResult() {
  return {
    amount: { value: null, confidence: 0 },
    date: { value: null, confidence: 0 },
    merchant: { value: null, confidence: 0 },
    description: { value: null, confidence: 0 },
    summary: { value: null, confidence: 0 },
    confidence: 0
  };
}

/**
 * Analyze receipt using prebuilt model
 */
async function analyzeReceipt(imageBuffer) {
  return analyzeDocument('prebuilt-receipt', imageBuffer);
}

/**
 * Analyze invoice using prebuilt model
 */
async function analyzeInvoice(imageBuffer) {
  return analyzeDocument('prebuilt-invoice', imageBuffer);
}

export {
  analyzeDocument,
  analyzeReceipt,
  analyzeInvoice,
  extractDocumentIntelligenceData,
  createClient,
  getModelInfo
};
