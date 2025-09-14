import axios from 'axios';
import { analyzeDocument as analyzeWithContentUnderstanding } from './contentUnderstandingService.js';

/**
 * Enhanced document processing with Azure AI Vision object detection
 * 
 * NEW FLOW INTEGRATION:
 * 1. First, detect receipt objects in the image using Azure AI Vision
 * 2. If bounding boxes are found, crop each detected receipt region
 * 3. Process each cropped image through existing classification pipeline
 * 4. Aggregate results from all detected receipts
 * 5. If no detections, fall back to processing original image as before
 */

async function processDocument(imageBuffer, tesseractResult, options = {}) {
    const processingStartTime = Date.now();
    const extractedText = String(tesseractResult?.rawText || tesseractResult?.extractedText || '').toLowerCase();
    
    console.log('Starting basic document processing with classification...');
    
    try {
        // Step 1: Classify document using Tesseract OCR result
        const { classifyOCRContent } = await import('./ocrService.js');
        let classification = classifyOCRContent({ success: !!tesseractResult?.success, rawText: extractedText });
        // If OCR failed or is empty (common for PDFs), infer by filename keywords
        if ((!classification || classification.documentType === 'other' || classification.documentType === 'unknown') && options.filename) {
            const inferred = inferDocTypeByFilename(options.filename);
            if (inferred) classification = { ...classification, documentType: inferred };
        }
        
        console.log(`Document classified as: ${classification.documentType} (confidence: ${classification.confidence})`);
        
        // Step 2: Process based on classification using Content Understanding
        let result;
        // Routing rules:
        // - Invoice -> Content Understanding Invoice analyzer
        // - Receipt -> Content Understanding Receipt analyzer
        // - Other -> If Tesseract failed (low text/conf), use Mistral; else extract via regex from OCR text
        const tesseractFailed = isTesseractFailed(tesseractResult);
        const isPDF = options.fileType && /pdf/i.test(options.fileType || '');
        if (classification.documentType === 'receipt') {
            console.log('Processing as Receipt with Content Understanding...');
            const receiptAnalyzerId = process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID || 'receipt-analyzer';
            result = await analyzeWithContentUnderstanding(receiptAnalyzerId, imageBuffer, { mimeType: options.fileType, preferBinary: true });
        } else if (classification.documentType === 'invoice') {
            console.log('Processing as Invoice with Content Understanding...');
            const invoiceAnalyzerId = process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID || 'invoice-analyzer';
            result = await analyzeWithContentUnderstanding(invoiceAnalyzerId, imageBuffer, { mimeType: options.fileType, preferBinary: true });
        } else {
            if (tesseractFailed && !isPDF) {
                console.log('Tesseract failed/weak; using Azure Foundry Mistral OCR...');
                result = await processWithMistralOCR(imageBuffer, { mimeType: options.fileType });
            } else {
                console.log('Using Content Understanding fallback for unknown type or OCR text regex extraction...');
                if (isPDF) {
                    // For PDFs, avoid Mistral; default to receipt analyzer if unknown
                    const fallbackAnalyzerId = (inferDocTypeByFilename(options.filename) === 'invoice')
                      ? (process.env.CONTENT_UNDERSTANDING_INVOICE_ANALYZER_ID || 'invoice-analyzer')
                      : (process.env.CONTENT_UNDERSTANDING_RECEIPT_ANALYZER_ID || 'receipt-analyzer');
                    result = await analyzeWithContentUnderstanding(fallbackAnalyzerId, imageBuffer, { mimeType: options.fileType, preferBinary: true });
                } else {
                    result = extractFromTextRegex(extractedText);
                }
            }
        }
        
        // Add classification metadata to result
        if (result.success) {
            result.classification = classification;
            result.processing_time_ms = Date.now() - processingStartTime;
        }
        
        return result;
        
    } catch (error) {
        const processingTime = Date.now() - processingStartTime;
        console.error('Document processing failed:', error.message);
        
        return {
            method: 'classification_processing_failed',
            success: false,
            error: error.message,
            processing_time_ms: processingTime
        };
    }
}

// Note: Image cropping/detections support is deferred. We process the original
// uploaded image/document as-is with OCR + Content Understanding/Mistral.

/**
 * Original document processing logic (unchanged for backward compatibility)
 */
async function processOriginalImage(imageBuffer, extractedText, options = {}) {
    console.log('Processing with original method...');
    
    const startTime = Date.now();
    let result;
    
    if (extractedText.includes('receipt')) {
        result = await processWithDocumentIntelligenceReceipt(imageBuffer);
    } else if (extractedText.includes('invoice')) {
        result = await processWithDocumentIntelligenceInvoice(imageBuffer);
    } else {
        result = await processWithMistralOCR(imageBuffer);
    }
    
    // Add fallback metadata if this was a fallback operation
    if (options.fallback_reason) {
        result.fallback_info = {
            reason: options.fallback_reason,
            detection_attempted: options.detection_attempted || false,
            cropping_error: options.cropping_error,
            processing_time_detection_ms: options.processing_time_detection_ms
        };
    }
    
    const processingTime = Date.now() - startTime;
    result.processing_time_ms = processingTime;
    
    return result;
}

// Removed: processWithDocumentIntelligenceReceipt - replaced with Content Understanding

// Removed: processWithDocumentIntelligenceInvoice - replaced with Content Understanding

async function processWithMistralOCR(imageBuffer, options = {}) {
    if (!process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT || !process.env.AZURE_FOUNDRY_MISTRAL_KEY) {
        return {
            method: 'azure_foundry_mistral_ocr',
            success: false,
            error: 'Azure Foundry Mistral OCR not configured (AZURE_FOUNDRY_MISTRAL_ENDPOINT and AZURE_FOUNDRY_MISTRAL_KEY required)'
        };
    }
    
    try {
        console.log('Processing with Azure Foundry Mistral OCR...');

        // Azure Foundry API call format - OpenAI compatible
        const response = await axios.post(process.env.AZURE_FOUNDRY_MISTRAL_ENDPOINT, {
            model: process.env.AZURE_FOUNDRY_MISTRAL_MODEL || "mistral-document-ai-2505",
            messages: [{
                role: "user",
                content: [
                    {
                        type: "text",
                        text: "Extract the amount, date, and merchant/vendor name from this document. Return in JSON format with fields: amount, date, merchant."
                    },
                    {
                        type: "image_url",
                        image_url: {
                            url: `data:${options.mimeType || 'image/jpeg'};base64,${imageBuffer.toString('base64')}`
                        }
                    }
                ]
            }],
            max_tokens: 500,
            temperature: 0.1,
            stream: false
        }, {
            headers: (() => {
                const key = process.env.AZURE_FOUNDRY_MISTRAL_KEY;
                const scheme = String(process.env.AZURE_FOUNDRY_MISTRAL_AUTH_SCHEME || 'api-key').toLowerCase();
                const base = {
                    'Content-Type': 'application/json',
                    'Accept': 'application/json'
                };
                if (scheme === 'bearer') {
                    return { ...base, 'Authorization': `Bearer ${key}` };
                }
                // Default to Azure-style api-key header
                return { ...base, 'api-key': key };
            })(),
            timeout: 60000
        });
        
        console.log('Azure Foundry Mistral OCR completed successfully');
        
        return {
            method: 'azure_foundry_mistral_ocr',
            success: true,
            data: extractMistralData(response.data)
        };
    } catch (error) {
        console.error('Azure Foundry Mistral OCR Processing Error:', error);
        return {
            method: 'azure_foundry_mistral_ocr',
            success: false,
            error: error.message
        };
    }
}

// Removed: extractReceiptData and extractInvoiceData - Content Understanding handles extraction internally

function extractMistralData(mistralResponse) {
    try {
        // Azure Foundry Mistral returns response in OpenAI format
        const content = mistralResponse?.choices?.[0]?.message?.content;
        if (!content) {
            console.warn('No content found in Mistral response');
            return {
                amount: { value: null, confidence: 0 },
                date: { value: null, confidence: 0 },
                merchant: { value: null, confidence: 0 },
                confidence: 0
            };
        }

        // Try to parse JSON from the response
        let extractedData;
        try {
            extractedData = JSON.parse(content);
        } catch (parseError) {
            // If not valid JSON, try to extract information with regex
            console.log('Failed to parse JSON, attempting regex extraction');
            extractedData = extractWithRegex(content);
        }

        // Normalize the extracted data
        const normalizedAmount = normalizeAmount(extractedData.amount);
        const normalizedDate = normalizeDate(extractedData.date);
        const normalizedMerchant = normalizeMerchant(extractedData.merchant);

        // Calculate confidence based on how many fields were successfully extracted
        const extractedFields = [normalizedAmount.value, normalizedDate.value, normalizedMerchant.value].filter(v => v !== null).length;
        const overallConfidence = extractedFields / 3; // 3 fields total

        return {
            amount: normalizedAmount,
            date: normalizedDate, 
            merchant: normalizedMerchant,
            confidence: overallConfidence
        };

    } catch (error) {
        console.error('Error extracting Mistral data:', error);
        return {
            amount: { value: null, confidence: 0 },
            date: { value: null, confidence: 0 },
            merchant: { value: null, confidence: 0 },
            confidence: 0
        };
    }
}

function extractWithRegex(content) {
    // Fallback regex extraction if JSON parsing fails
    const amountMatch = content.match(/(?:amount|total|sum)[:\s]*\$?([0-9]+\.?[0-9]*)/i);
    const dateMatch = content.match(/(?:date)[:\s]*([0-9]{1,2}[\/\-][0-9]{1,2}[\/\-][0-9]{2,4})/i);
    const merchantMatch = content.match(/(?:merchant|vendor|company)[:\s]*([a-zA-Z0-9\s]+)/i);

    return {
        amount: amountMatch ? amountMatch[1] : null,
        date: dateMatch ? dateMatch[1] : null,
        merchant: merchantMatch ? merchantMatch[1].trim() : null
    };
}

function inferDocTypeByFilename(name) {
    try {
        const n = String(name || '').toLowerCase();
        if (/(invoice|inv[-_\s]?\d+)/i.test(n)) return 'invoice';
        if (/(receipt|rcpt|pos[-_\s]?\d+)/i.test(n)) return 'receipt';
        return null;
    } catch (_) { return null; }
}

function isTesseractFailed(ocr) {
    try {
        if (!ocr || !ocr.success) return true;
        const len = String(ocr.rawText || ocr.extractedText || '').trim().length;
        if (len < 50) return true; // too little text
        const conf = Number(ocr.confidence || 0);
        if (conf > 0 && conf < 50) return true; // confidence is 0-100 for tesseract.js
        return false;
    } catch (_) {
        return true;
    }
}

function extractFromTextRegex(text) {
    try {
        const extracted = extractWithRegex(String(text || ''));
        const normalizedAmount = normalizeAmount(extracted.amount);
        const normalizedDate = normalizeDate(extracted.date);
        const normalizedMerchant = normalizeMerchant(extracted.merchant);
        const extractedFields = [normalizedAmount.value, normalizedDate.value, normalizedMerchant.value].filter(v => v !== null).length;
        const overallConfidence = extractedFields / 3;
        return {
            method: 'tesseract_regex',
            success: true,
            data: {
                amount: normalizedAmount,
                date: normalizedDate, 
                merchant: normalizedMerchant,
                confidence: overallConfidence
            }
        };
    } catch (error) {
        return {
            method: 'tesseract_regex',
            success: false,
            error: error.message
        };
    }
}

function normalizeAmount(amount) {
    if (!amount) return { value: null, confidence: 0 };
    
    const numericAmount = parseFloat(amount.toString().replace(/[^0-9.]/g, ''));
    if (isNaN(numericAmount)) return { value: null, confidence: 0 };
    
    return { value: numericAmount, confidence: 0.7 }; // Medium confidence for Mistral extractions
}

function normalizeDate(date) {
    if (!date) return { value: null, confidence: 0 };
    
    try {
        const parsedDate = new Date(date);
        if (isNaN(parsedDate)) return { value: null, confidence: 0 };
        
        return { value: parsedDate.toISOString().split('T')[0], confidence: 0.6 }; // Lower confidence for dates
    } catch (error) {
        return { value: null, confidence: 0 };
    }
}

function normalizeMerchant(merchant) {
    if (!merchant) return { value: null, confidence: 0 };
    
    const cleanMerchant = merchant.toString().trim().replace(/[^\w\s]/g, '').substring(0, 50);
    if (cleanMerchant.length === 0) return { value: null, confidence: 0 };
    
    return { value: cleanMerchant, confidence: 0.5 }; // Lower confidence for merchant names from OCR
}

// Removed: calculateConfidence - Content Understanding provides confidence internally

export {
    processDocument,
    processWithMistralOCR
};
